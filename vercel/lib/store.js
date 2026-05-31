// Upstash Redis 接続と共通定数。
// クレジット台帳・ジョブ・キューを Redis の atomic プリミティブで扱い、
// サーバレスの並行実行下でも double-spend / double-claim を起こさない。
import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";

// Upstash marketplace 統合は環境変数名が2系統ある:
//   - UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（Redis.fromEnv() 既定）
//   - KV_REST_API_URL / KV_REST_API_TOKEN（旧 Vercel KV 互換の注入名）
// どちらでも動くよう明示生成。fromEnv() 決め打ちだと KV_* 注入時に起動時失敗する。
const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export const redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });

export const COST = 1;     // ジョブ投稿コスト（requester から引く）
export const REWARD = 1;   // ジョブ完了報酬（provider に与える）

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

const DEBIT_SCRIPT = `
local bucket_key = KEYS[1]
local legacy_key = KEYS[2]
local credit_tier = ARGV[1]
local cost = ARGV[2]
local debit_key = bucket_key
if credit_tier == "open" and redis.call("EXISTS", bucket_key) == 0 and redis.call("EXISTS", legacy_key) == 1 then
  debit_key = legacy_key
end
local bal = redis.call("DECRBY", debit_key, cost)
if bal < 0 then
  redis.call("INCRBY", debit_key, cost)
end
return bal
`;

// claude系モデルかどうか。これらは金銭流出点なので requester allowlist で守る。
export function isClaudeModel(model) {
  return /^claude/i.test(model || "");
}

export function tier(model) {
  return isClaudeModel(model) ? "premium" : "open";
}

export function accountKey(account, creditTier = "open") {
  return `acct:${account}:${creditTier}`;
}

// claude系ジョブを投稿してよい requester の許可リスト（カンマ区切り環境変数）。
// 例: COMPUTE_POOL_CLAUDE_ALLOWLIST="alice,bob"
export function claudeAllowlist() {
  return (process.env.COMPUTE_POOL_CLAUDE_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function modelFromLiveKey(key) {
  const parts = key.split(":");
  if (parts.length < 3 || parts[0] !== "live") return null;
  return parts.slice(1, -1).join(":");
}

export async function liveModels() {
  let cursor = "0";
  const counts = {};

  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: "live:*", count: 100 });
    cursor = String(nextCursor);
    for (const key of keys) {
      const model = modelFromLiveKey(key);
      if (model) counts[model] = (counts[model] || 0) + 1;
    }
  } while (cursor !== "0");

  return {
    counts,
    models: Object.keys(counts).sort(),
  };
}

function rateLimitPerMinute() {
  const n = Number(process.env.COMPUTE_POOL_RATE_PER_MIN || 30);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

async function debitCredits(account, creditTier) {
  const bal = Number(await redis.eval(
    DEBIT_SCRIPT,
    [accountKey(account, creditTier), `acct:${account}`],
    [creditTier, String(COST)],
  ));
  return bal;
}

async function checkRateLimit(account) {
  const now = Date.now();
  const bucket = Math.floor(now / 60000);
  const limit = rateLimitPerMinute();
  const count = Number(await redis.eval(RATE_LIMIT_SCRIPT, [`rl:${account}:${bucket}`], ["120"]));
  return {
    limited: count > limit,
    retryAfter: 60 - Math.floor((now % 60000) / 1000),
  };
}

export async function submitJob({ model, prompt, account }) {
  if (!model || !prompt || !account) {
    return {
      status: 400,
      body: { error: "model, prompt, account are required" },
    };
  }

  // ★金銭流出ガード★ claude系モデルのジョブは allowlist の requester のみ投稿可。
  // これにより、公開プールの野良 requester は claude バックエンドを呼べず、
  // 主の claude provider が拾うジョブは必ず信頼アカウント発になる。
  if (isClaudeModel(model) && !claudeAllowlist().includes(account)) {
    return {
      status: 403,
      body: { error: "claude models are restricted to allowlisted accounts" },
    };
  }

  const rate = await checkRateLimit(account);
  if (rate.limited) {
    return {
      status: 429,
      body: { error: "rate limit exceeded", retry_after: rate.retryAfter },
    };
  }

  const creditTier = tier(model);

  // atomic: 対象tierからまず引き、負残高ならLua内でロールバック。
  const bal = await debitCredits(account, creditTier);
  if (bal < 0) {
    return {
      status: 402,
      body: { error: "insufficient credits", credits: bal + COST },
    };
  }

  const id = randomUUID().replace(/-/g, "");
  await redis.hset(`job:${id}`, {
    id,
    model,
    prompt,
    tier: creditTier,
    status: "pending",
    requester: account,
    provider: "",
    result: "",
    created_at: Date.now(),
  });
  await redis.rpush(`queue:${model}`, id); // モデル別キューに atomic 追加

  return {
    status: 200,
    body: { id, status: "pending", credits: bal },
  };
}

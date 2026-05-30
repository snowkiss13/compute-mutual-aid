// POST /api/jobs — requester がジョブ投稿。
import { randomUUID } from "crypto";
import { redis, COST, isClaudeModel, claudeAllowlist } from "../../lib/store.js";
import { authOk } from "../../lib/auth.js";

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

function rateLimitPerMinute() {
  const n = Number(process.env.COMPUTE_POOL_RATE_PER_MIN || 30);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
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

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const { model, prompt, account } = req.body || {};
  if (!model || !prompt || !account) {
    return res.status(400).json({ error: "model, prompt, account are required" });
  }

  // ★金銭流出ガード★ claude系モデルのジョブは allowlist の requester のみ投稿可。
  // これにより、公開プールの野良 requester は claude バックエンドを呼べず、
  // 主の claude provider が拾うジョブは必ず信頼アカウント発になる。
  if (isClaudeModel(model) && !claudeAllowlist().includes(account)) {
    return res.status(403).json({
      error: "claude models are restricted to allowlisted accounts",
    });
  }

  const rate = await checkRateLimit(account);
  if (rate.limited) {
    return res.status(429).json({ error: "rate limit exceeded", retry_after: rate.retryAfter });
  }

  // atomic: まず引いてから負残高ならロールバック（read-modify-write レース回避）。
  const bal = await redis.decrby(`acct:${account}`, COST);
  if (bal < 0) {
    await redis.incrby(`acct:${account}`, COST);
    return res.status(402).json({ error: "insufficient credits", credits: bal + COST });
  }

  const id = randomUUID().replace(/-/g, "");
  await redis.hset(`job:${id}`, {
    id,
    model,
    prompt,
    status: "pending",
    requester: account,
    provider: "",
    result: "",
    created_at: Date.now(),
  });
  await redis.rpush(`queue:${model}`, id); // モデル別キューに atomic 追加
  return res.status(200).json({ id, status: "pending", credits: bal });
}

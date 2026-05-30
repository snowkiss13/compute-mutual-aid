// Upstash Redis 接続と共通定数。
// クレジット台帳・ジョブ・キューを Redis の atomic プリミティブで扱い、
// サーバレスの並行実行下でも double-spend / double-claim を起こさない。
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

// claude系モデルかどうか。これらは金銭流出点なので requester allowlist で守る。
export function isClaudeModel(model) {
  return /^claude/i.test(model || "");
}

// claude系ジョブを投稿してよい requester の許可リスト（カンマ区切り環境変数）。
// 例: COMPUTE_POOL_CLAUDE_ALLOWLIST="alice,bob"
export function claudeAllowlist() {
  return (process.env.COMPUTE_POOL_CLAUDE_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

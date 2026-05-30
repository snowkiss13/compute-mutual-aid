// GET /api/jobs/claim?account=&model= — provider が pending ジョブを1件取得。
import { redis } from "../../lib/store.js";
import { resolveAccount } from "../../lib/auth.js";

export default async function handler(req, res) {
  const provider = await resolveAccount(req, req.query.account);
  const model = req.query.model;
  if (!provider) return res.status(401).json({ error: "unauthorized" });
  if (!model) return res.status(400).json({ error: "model query param required" });

  // atomic pop（select-then-update のレースを避ける）。
  const id = await redis.lpop(`queue:${model}`);
  if (!id) return res.status(204).end();

  const job = await redis.hgetall(`job:${id}`);
  if (!job || !job.id) return res.status(204).end();

  // 自己claim防止: 自分のジョブならキュー末尾へ戻して取らない（クレジット自己増殖防止）。
  if (job.requester === provider) {
    await redis.rpush(`queue:${model}`, id);
    return res.status(204).end();
  }

  await redis.hset(`job:${id}`, {
    status: "claimed",
    provider,
    claimed_at: Date.now(),
  });
  return res.status(200).json({ id: job.id, model: job.model, prompt: job.prompt });
}

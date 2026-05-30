// GET /api/jobs/:id — requester が結果をポーリングする。
import { redis } from "../../../lib/store.js";
import { authOk } from "../../../lib/auth.js";

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });

  const { id } = req.query;
  const job = await redis.hgetall(`job:${id}`);
  if (!job || !job.id) return res.status(404).json({ error: "job not found" });

  return res.status(200).json({
    id: job.id,
    model: job.model,
    status: job.status,
    result: job.result || null,
    provider: job.provider || null,
  });
}

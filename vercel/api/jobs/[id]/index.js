// GET /api/jobs/:id — requester が結果をポーリングする。
import { redis } from "../../../lib/store.js";
import { resolveAccount } from "../../../lib/auth.js";

export default async function handler(req, res) {
  const { id } = req.query;
  const job = await redis.hgetall(`job:${id}`);
  if (!job || !job.id) return res.status(404).json({ error: "job not found" });

  const account = await resolveAccount(req, job.requester);
  if (!account) return res.status(401).json({ error: "unauthorized" });
  if (job.requester !== account && job.provider !== account) {
    return res.status(403).json({ error: "job is not visible to this account" });
  }

  return res.status(200).json({
    id: job.id,
    model: job.model,
    status: job.status,
    result: job.result || null,
    provider: job.provider || null,
  });
}

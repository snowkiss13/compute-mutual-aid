// POST /api/jobs/:id/result — provider が結果を提出し、報酬を受け取る。
import { redis, REWARD } from "../../../lib/store.js";
import { authOk } from "../../../lib/auth.js";

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const { id } = req.query;
  const { result, account } = req.body || {};
  if (result == null || !account) {
    return res.status(400).json({ error: "result and account are required" });
  }

  const job = await redis.hgetall(`job:${id}`);
  if (!job || !job.id) return res.status(404).json({ error: "job not found" });
  if (job.status !== "claimed") {
    return res.status(409).json({ error: `job not claimable for result (status=${job.status})` });
  }
  if (job.provider !== account) {
    return res.status(403).json({ error: "only the claiming provider may submit the result" });
  }

  await redis.hset(`job:${id}`, { status: "done", result, done_at: Date.now() });
  const credits = await redis.incrby(`acct:${account}`, REWARD);
  return res.status(200).json({ ok: true, credits });
}

// POST /api/jobs/:id/result — provider が結果を提出し、報酬を受け取る。
import { completeJobResult, redis, tier } from "../../../lib/store.js";
import { resolveAccount } from "../../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const { id } = req.query;
  const { result, account: explicitAccount } = req.body || {};
  const account = await resolveAccount(req, explicitAccount);
  if (!account) return res.status(401).json({ error: "unauthorized" });
  if (result == null) {
    return res.status(400).json({ error: "result is required" });
  }

  const job = await redis.hgetall(`job:${id}`);
  if (!job || !job.id) return res.status(404).json({ error: "job not found" });
  if (job.status !== "claimed") {
    return res.status(409).json({ error: `job not claimable for result (status=${job.status})` });
  }
  if (job.provider !== account) {
    return res.status(403).json({ error: "only the claiming provider may submit the result" });
  }

  const creditTier = job.tier || tier(job.model);
  const completed = await completeJobResult({
    id,
    model: job.model,
    account,
    result,
    creditTier,
  });
  if (!completed.ok) {
    if (completed.credits === -2) {
      return res.status(403).json({ error: "only the claiming provider may submit the result" });
    }
    return res.status(409).json({ error: "job not claimable for result (status changed)" });
  }

  return res.status(200).json({ ok: true, credits: completed.credits, tier: creditTier });
}

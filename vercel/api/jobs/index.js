// POST /api/jobs — requester がジョブ投稿。
import { submitJob } from "../../lib/store.js";
import { resolveAccount } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const { model, prompt, account: explicitAccount } = req.body || {};
  const account = await resolveAccount(req, explicitAccount);
  if (!account) return res.status(401).json({ error: "unauthorized" });

  const result = await submitJob({ model, prompt, account });
  return res.status(result.status).json(result.body);
}

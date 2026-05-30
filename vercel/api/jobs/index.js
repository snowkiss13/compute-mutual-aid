// POST /api/jobs — requester がジョブ投稿。
import { submitJob } from "../../lib/store.js";
import { authOk } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const { model, prompt, account } = req.body || {};
  const result = await submitJob({ model, prompt, account });
  return res.status(result.status).json(result.body);
}

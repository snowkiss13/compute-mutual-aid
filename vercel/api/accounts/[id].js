// GET /api/accounts/:id — クレジット残高照会。
import { redis } from "../../lib/store.js";
import { authOk } from "../../lib/auth.js";

export default async function handler(req, res) {
  if (!authOk(req)) return res.status(401).json({ error: "unauthorized" });

  const { id } = req.query;
  const v = await redis.get(`acct:${id}`);
  // 公開モードでは未登録アカウントは 0（初期付与なし＝Sybil耐性）。
  return res.status(200).json({ account: id, credits: v == null ? 0 : Number(v) });
}

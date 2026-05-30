// GET /api/accounts/:id — クレジット残高照会。
import { redis, accountKey } from "../../lib/store.js";
import { resolveAccount } from "../../lib/auth.js";

export default async function handler(req, res) {
  const { id } = req.query;
  const account = await resolveAccount(req, id);
  if (!account) return res.status(401).json({ error: "unauthorized" });
  if (account !== id) return res.status(403).json({ error: "account is not visible to this key" });

  const [legacy, openBucket, premiumBucket] = await Promise.all([
    redis.get(`acct:${id}`),
    redis.get(accountKey(id, "open")),
    redis.get(accountKey(id, "premium")),
  ]);
  const open = Number(legacy || 0) + Number(openBucket || 0);
  const premium = Number(premiumBucket || 0);
  // 公開モードでは未登録アカウントは 0（初期付与なし＝Sybil耐性）。
  return res.status(200).json({ account: id, open, premium, total: open + premium });
}

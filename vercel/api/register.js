// POST /api/register — accountごとのAPIキーを一度だけ発行。
import { randomUUID } from "crypto";
import { redis } from "../lib/store.js";

const REGISTER_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return 0
end
redis.call("SET", KEYS[1], "1")
redis.call("SET", KEYS[2], ARGV[1])
return 1
`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const { account } = req.body || {};
  if (!account) return res.status(400).json({ error: "account is required" });

  const apiKey = randomUUID().replace(/-/g, "");
  const ok = Number(await redis.eval(
    REGISTER_SCRIPT,
    [`acct-registered:${account}`, `apikey:${apiKey}`],
    [account],
  ));

  if (!ok) return res.status(409).json({ error: "account already registered" });
  return res.status(200).json({ account, api_key: apiKey });
}

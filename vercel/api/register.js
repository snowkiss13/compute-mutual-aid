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

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

function registerLimitPerHour() {
  const n = Number(process.env.COMPUTE_POOL_REGISTER_PER_HOUR || 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10;
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
}

async function checkRegisterRateLimit(req) {
  const now = Date.now();
  const bucket = Math.floor(now / 3600000);
  const limit = registerLimitPerHour();
  const count = Number(await redis.eval(
    RATE_LIMIT_SCRIPT,
    [`rl-reg:${clientIp(req)}:${bucket}`],
    ["7200"],
  ));
  return {
    limited: count > limit,
    retryAfter: 3600 - Math.floor((now % 3600000) / 1000),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const rate = await checkRegisterRateLimit(req);
  if (rate.limited) {
    return res.status(429).json({ error: "rate limit exceeded", retry_after: rate.retryAfter });
  }

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

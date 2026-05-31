// GET /api/stats — unauthenticated aggregate pool health.
import { liveModels, redis, reputationStats } from "../lib/store.js";

function modelFromQueueKey(key) {
  if (!key.startsWith("queue:")) return null;
  return key.slice("queue:".length);
}

async function queueDepths() {
  let cursor = "0";
  const queues = {};

  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: "queue:*", count: 100 });
    cursor = String(nextCursor);
    for (const key of keys) {
      const model = modelFromQueueKey(key);
      if (model) queues[model] = await redis.llen(key);
    }
  } while (cursor !== "0");

  return queues;
}

async function countKeys(match) {
  let cursor = "0";
  let count = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match, count: 100 });
    cursor = String(nextCursor);
    count += keys.length;
  } while (cursor !== "0");

  return count;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(404).json({ error: "not found" });

  const [queues, live, registeredAccounts, reputation] = await Promise.all([
    queueDepths(),
    liveModels(),
    countKeys("acct-registered:*"),
    reputationStats(),
  ]);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    queues,
    live_providers: live,
    registered_accounts: registeredAccounts,
    reputation,
    ts: Date.now(),
  });
}

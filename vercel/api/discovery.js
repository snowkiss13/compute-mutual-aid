// GET /api/discovery — dynamic copy of the public compute-pool manifest.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { redis } from "../lib/store.js";

const manifestPath = fileURLToPath(new URL("../public/.well-known/compute-pool.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function modelFromLiveKey(key) {
  const parts = key.split(":");
  if (parts.length < 3 || parts[0] !== "live") return null;
  return parts.slice(1, -1).join(":");
}

async function liveModels() {
  let cursor = "0";
  const counts = {};

  do {
    const [nextCursor, keys] = await redis.scan(cursor, { match: "live:*", count: 100 });
    cursor = String(nextCursor);
    for (const key of keys) {
      const model = modelFromLiveKey(key);
      if (model) counts[model] = (counts[model] || 0) + 1;
    }
  } while (cursor !== "0");

  return {
    counts,
    models: Object.keys(counts).sort(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(404).json({ error: "not found" });
  const live = await liveModels();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ...manifest,
    live_models: live,
  });
}

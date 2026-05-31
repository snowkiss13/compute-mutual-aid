// GET /api/discovery — dynamic copy of the public compute-pool manifest.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { liveModels } from "../lib/store.js";

const manifestPath = fileURLToPath(new URL("../public/.well-known/compute-pool.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(404).json({ error: "not found" });
  const live = await liveModels();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ...manifest,
    live_models: live,
  });
}

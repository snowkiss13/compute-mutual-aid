// GET /api/discovery — dynamic copy of the public compute-pool manifest.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const manifestPath = fileURLToPath(new URL("../public/.well-known/compute-pool.json", import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

export default function handler(req, res) {
  if (req.method !== "GET") return res.status(404).json({ error: "not found" });
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json(manifest);
}

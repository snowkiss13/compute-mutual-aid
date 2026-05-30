import { redis } from "./store.js";

function bearer(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}

function adminAccount(req, explicitAccount) {
  const adminToken = process.env.COMPUTE_POOL_ADMIN_TOKEN || "";
  if (!adminToken || bearer(req) !== adminToken) return null;
  return explicitAccount || null;
}

export async function resolveAccount(req, explicitAccount = null) {
  const admin = adminAccount(req, explicitAccount);
  if (admin) return admin;

  const key = bearer(req);
  if (!key) return null;

  const account = await redis.get(`apikey:${key}`);
  return account || null;
}

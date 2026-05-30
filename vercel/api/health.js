// GET /api/health — 認証不要の死活確認。
export default function handler(req, res) {
  res.status(200).json({ ok: true, ts: Date.now() });
}

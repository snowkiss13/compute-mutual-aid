// 共有Bearerトークン認証（provider/requester 詐称防止）。
// ★コーディネータは認証情報（APIキー等）を一切扱わない。
//   このトークンはプール参加用の入場券であって、各自のLLM認証情報ではない。
export function authOk(req) {
  const expected = `Bearer ${process.env.COMPUTE_POOL_TOKEN || "dev-shared-token"}`;
  return req.headers.authorization === expected;
}

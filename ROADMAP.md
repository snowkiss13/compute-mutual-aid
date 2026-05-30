# compute-mutual-aid ROADMAP

役割分担(CLAUDE.md準拠): Claude=設計・優先度・DoD定義・統合・Accept/Reject判断 / Codex=実装・デバッグ・テスト。
委譲経路: agmsg team `goraku`（`/agmsg send codex ...`）。実装は1タスクずつ直列（前タスクをレビューしてから次）。

本番: https://vercel-nine-sigma-62.vercel.app （Vercel + Upstash Redis、E2E実証済）

## 優先度付きバックログ

| P | 項目 | 目的 | 担当 | 状態 |
|---|------|------|------|------|
| 1 | rate-limit | ジョブspam DoS防止（初期0でもRedis/queue枯渇） | Codex | ✅完了(本番実証30→429) |
| 2 | arbitrage防御 | echo/ollama由来creditをclaude等高コストへ移転不可（model/provider別bucket） | Codex | ✅完了(本番実証 open→claude=402/premium=200) |
| 3 | OpenAI互換ゲートウェイ | `/v1/chat/completions`で既存SDK/ツールから直叩き→採用障壁↓ | Codex | ✅完了(本番実証 実provider経由choices返却) |
| 4 | MCPサーバ公開 | エージェントがネイティブに発見・利用できる「正しい形」 | Codex | **委譲予定** |
| 5 | account登録/reputation | 濫用耐性の成熟（自己申告ID→検証・評価） | Codex | 設計待ち |
| 6 | E2E暗号化 | coordinatorにプロンプト/結果を平文で見せない | Codex | 設計待ち |

## 直列実装規約（Codexへ毎回明示）
変更最小 / 関係ないファイル触らない / 不要依存追加しない / 既存挙動壊さない / 不確実点はリスク明記 / 差分要点3行で返す。

## P2 設計メモ（rate-limit完了後に委譲）
- 台帳キーを `acct:{id}` 単一から **tier別** に分離: `acct:{id}:open`（echo/ollama由来）/ `acct:{id}:premium`（claude由来）。
- submit時、claude系モデルは `:premium` 残高のみ消費可。open creditはpremiumへ流用不可。
- 後方互換: 既存 `acct:{id}` は `:open` 扱いへ移行 or 二重読み。移行リスクをCodexに明記させる。

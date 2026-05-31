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
| 4 | MCPサーバ公開 | エージェントがネイティブに発見・利用できる「正しい形」 | Codex | ✅完了(MCP e2e実証: compute_complete実provider成功) |
| 5 | 身元束縛(per-account key) | ★security核心。account詐称・クレジット窃取・claudeガード破りを封じる | Codex | ✅完了(本番なりすまし実証クリア) |
| 5.1 | register rate-limit | /api/register の storage-spam(0creditキー量産)抑止 | Codex | 未着手(優先低・非ブロッカー) |
| 5.2 | クライアント移行 | provider/requester/MCP を per-account key 認証へ(P5副作用修正) | Codex | ✅完了(本番e2e: provider/requester/GW全経路で結果返却・grep共有token0) |
| 6 | E2E暗号化 | coordinatorにプロンプト/結果を平文で見せない | Codex | 設計待ち |
| - | reputation | provider成功率/遅延の評価・claim優先度 | Codex | 構想 |

---

## Phase 2: 流動性 & 運用（2026-05-31 設計・advisor整合）

コアP1-P5は完成・public(github.com/snowkiss13/compute-mutual-aid)・prod稼働。だが**流動性ゼロ**(provider不在→requesterは504)・discovery未公開。Phase 2の目的=「生きた系として実際に動く」。

**確定したセキュリティ運用(2026-05-31 実施済)**:
- allowlist名 `snowkiss13` は先取り防止のため即登録済。key=`.operator-credentials.json`(gitignore)。
  → claudeガードはaccount**名**をkeyにするため、未登録allowlist名は第三者にregister可=ガード無効化リスク。登録で確保。

**依存順(各ステップが次を解禁)**:
1. **P5.2 クライアント移行**(再委譲中)。これ無しでは常駐providerが認証できない=最優先。
2. ✅**discovery自己完結化**(完了): Vercel が `/.well-known/compute-pool.json` + `/api/discovery` 配信。本番200・local-first整合。Lolipop任意ミラー降格。FTP物理依存除去。
3. ✅**常駐seed provider**(完了): scripts/seed-provider.sh + launchd plist。本番e2e実証=実ジョブをollama qwen3-coder:30bがclaim→ローカル推論→結果返却(認証情報不通過)。**残: 主が launchctl load して永続常駐化**(手動実行は検証済)。
4. **P5.1 register rate-limit**: 公開後の storage-spam 抑止。
5. (後続) P6 E2E暗号化・reputation・P2P。

スコープ拡大しない。allowlist名確保=最小正解(再設計不要)。

## 方針決定: local-first ピボット & P2P判断（2026-05-31・主GO）

**ピボット**: 「API/サブスク枠の融通」→「ローカル計算資源の融通」を主役に。OpenAI Codex for Open Source program 申請と整合（benefit/サブスク再提供をしない）。READMEを申請向けに再構成済。

**P2P判断: 完全P2Pは採らない。現行=hybrid relay queue が最適解。**
- クレジット台帳は二重支払防止で中央集権必須→「完全P2P」は原理的に不可能。論点は実質 payload を peer 直送するか否かのみ。
- 現状は小さいテキストjob→Vercel中継で十分。P2P直送が効くのは大payload(画像/大ファイル)のみ→現状メリット無し。
- 現構成(Vercel/Redis=control plane: discovery/ledger/auth/queue、provider=ローカル実行、prompt+resultのみ通過)を維持。新規実装不要。

**local-first 実体（コード変更小）**:
- ollama/llama.cpp/Apple Silicon backend を既定・主役に。
- 有料API backend(claude等)は opt-in かつ project-owned/authorized key 限定。サブスク/benefit再提供しない。

**将来オプション（需要が出たら）**: ①coordinator-assisted P2P（中央=discovery/ledger/auth、大payloadのみpeer直送） ②libp2p/QUIC。今は着手しない。

## Phase 3: 公開ハードニング & 信頼 & DX（2026-05-31 設計）

Phase2で「生きた系」に到達(発見自己完結・供給常駐可)。公開済ゆえ Phase3 は「安全に・信頼でき・参加しやすい公共財」へ。

| # | 項目 | 目的 | 状態 |
|---|------|------|------|
| 3.1 | register rate-limit | 公開の /api/register を IP単位で制限。0-creditキー量産(storage spam)抑止 | ✅完了(本番1-10=200/11=429) |
| 3.2 | provider heartbeat + live models | providerが生存ping→discovery/manifestに「現在稼働中のmodel」を出す。requesterの504空振りを防ぐ | ✅完了(本番: 起動3秒でlive表示・停止35秒で消滅) |
| 3.3 | stats/observability | GET /api/stats: queue深さ・登録数・稼働provider数。健全性可視化 | **委譲中** |
| 3.4 | reputation | provider成功率/遅延→claim優先度・信頼表示 | 構想 |
| 3.5 | E2E暗号化(旧P6) | coordinatorにprompt/result平文を見せない | 後続 |

**3.2 設計メモ**: provider claim時に `live:{model}:{account}` を SETEX(TTL~30s) で更新。discovery/stats は `live:*` を集計し models ごとの稼働provider数を返す。manifestの models.open に live フラグ or 別フィールド `live_models` を追加。requesterは投げる前に生存確認可。

**3.1 設計メモ**: register は無認証ゆえ IP(x-forwarded-for)単位 fixed-window(例 10/hour) を rl-reg:{ip}:{hour} で。超過429。既存の RATE_LIMIT_SCRIPT 流用可。

依存順: 3.1(安全・最優先) → 3.2(DX・504回避) → 3.3(可視化) → 3.4/3.5。

## 直列実装規約（Codexへ毎回明示）
変更最小 / 関係ないファイル触らない / 不要依存追加しない / 既存挙動壊さない / 不確実点はリスク明記 / 差分要点3行で返す。

## P2 設計メモ（rate-limit完了後に委譲）
- 台帳キーを `acct:{id}` 単一から **tier別** に分離: `acct:{id}:open`（echo/ollama由来）/ `acct:{id}:premium`（claude由来）。
- submit時、claude系モデルは `:premium` 残高のみ消費可。open creditはpremiumへ流用不可。
- 後方互換: 既存 `acct:{id}` は `:open` 扱いへ移行 or 二重読み。移行リスクをCodexに明記させる。

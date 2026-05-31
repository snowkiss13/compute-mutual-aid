# Lolipop 配置物（AI向け discovery）

> 正本は Vercel 配信の `https://<prod>/.well-known/compute-pool.json`。Lolipop は任意ミラー。

> ✅ **公開可（2026-05-30・P5反映）**: per-account APIキー身元束縛が本番稼働。manifest は共有トークンではなく `/api/register` での自己発行キーを案内するため、公開してもなりすまし不可。アップロード手順は下記。


Vercel = 動的コーディネータ（台帳・ジョブ）。Lolipop = 静的な「AI向け案内板」。

## 中身
- `index.html` — 人間/クローラ用の薄いポインタ。manifest へ誘導。
- `.well-known/compute-pool.json` — エージェントが読む機械可読 manifest。

## アップロード手順（FTP / ロリポップ! ファイルマネージャ）
1. Vercel 本番デプロイ後、発行された URL を控える。
2. `.well-known/compute-pool.json` の `coordinator.base_url` を
   `https://<vercel-prod>/api` に置換（現在は `REPLACE_WITH_VERCEL_PROD_URL`）。
3. 公開ディレクトリ直下へ次の構成でアップロード:
   ```
   /index.html
   /.well-known/compute-pool.json
   ```
4. `https://<your-domain>/.well-known/compute-pool.json` が JSON を返すか確認。
   - `.well-known` が 403/404 の場合、ロリポップの `.htaccess` でドット始まり
     ディレクトリ配信を許可するか、`/compute-pool.json`（直下）にも複製して回避。

## なぜ Lolipop と Vercel を分けるか
- 即応性: 静的 manifest は CDN/レンタル鯖で常時即返答。
- 関心分離: 認証・課金ロジックは Vercel に閉じ、公開案内は静的化して攻撃面を最小化。

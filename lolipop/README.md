# Lolipop 配置物（AI向け discovery）

> ⚠️ **公開保留中（2026-05-30）**: P5（per-account APIキー身元束縛）が本番に入るまで、この manifest を公開アップロードしないこと。
> 現状は `account` が未認証のため、manifest 公開＝トークン拡散＝なりすまし可能になる。詳細はプロジェクト README のセキュリティ状態節。


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

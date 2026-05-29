#!/usr/bin/env python3
"""
Coordinator — AI計算資源融通のジョブボード兼クレジット台帳。

役割は3つだけ:
  1. ジョブの受付・保管・受け渡し（JSONのみ、HTMLは返さない＝機械優先）
  2. クレジット台帳の管理（提供側メリットの源泉。requester -1 / provider +1）
  3. 認証（共有Bearerトークンによる provider 詐称防止）

重要: コーディネータは「認証情報（APIキー等）を一切扱わない」。
扱うのはプロンプト文字列・結果文字列・クレジット残高のみ。
各 provider は自分のマシン内で自分の認証情報を使ってジョブを実行する。

依存ゼロ（Python標準ライブラリのみ）。共有レンタルサーバへの移植を見据え、
状態は SQLite ファイル1個に集約する。
"""

import json
import os
import sqlite3
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

# --- 設定（環境変数で上書き可） ---
AUTH_TOKEN = os.environ.get("COMPUTE_POOL_TOKEN", "dev-shared-token")
DB_PATH = os.environ.get("COMPUTE_POOL_DB", os.path.join(os.path.dirname(__file__), "pool.db"))
HOST = os.environ.get("COMPUTE_POOL_HOST", "127.0.0.1")
PORT = int(os.environ.get("COMPUTE_POOL_PORT", "8787"))

# 新規アカウントへの初期付与。
# ローカル/信頼グループでは 10 で即開始できて便利だが、
# ★公開デプロイでは必ず 0 にすること★（COMPUTE_POOL_INITIAL_CREDITS=0）。
# 自己申告のaccount IDに無料クレジットを配ると、偽アカ量産(Sybil)で
# claudeバックエンドの実費/枠を盗まれる。初期0なら「先に提供して稼がないと使えない」
# 構造になり、無限偽アカ攻撃が無効化される。
INITIAL_CREDITS = int(os.environ.get("COMPUTE_POOL_INITIAL_CREDITS", "10"))
JOB_COST = 1           # ジョブ投稿コスト（requester から引く）
JOB_REWARD = 1         # ジョブ完了報酬（provider に与える）


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS jobs (
            id          TEXT PRIMARY KEY,
            model       TEXT NOT NULL,
            prompt      TEXT NOT NULL,
            status      TEXT NOT NULL,        -- pending / claimed / done
            result      TEXT,
            requester   TEXT NOT NULL,
            provider    TEXT,
            created_at  REAL NOT NULL,
            claimed_at  REAL,
            done_at     REAL
        );
        CREATE TABLE IF NOT EXISTS accounts (
            id      TEXT PRIMARY KEY,
            credits INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, model, created_at);
        """
    )
    conn.commit()
    conn.close()


def ensure_account(conn, account_id):
    """アカウントが無ければ初期クレジット付きで作る。残高を返す。"""
    row = conn.execute("SELECT credits FROM accounts WHERE id=?", (account_id,)).fetchone()
    if row is None:
        conn.execute("INSERT INTO accounts(id, credits) VALUES (?, ?)", (account_id, INITIAL_CREDITS))
        return INITIAL_CREDITS
    return row["credits"]


class Handler(BaseHTTPRequestHandler):
    # --- 共通ユーティリティ ---
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _auth_ok(self):
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {AUTH_TOKEN}"

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def log_message(self, fmt, *args):
        pass  # アクセスログ抑制（必要なら有効化）

    # --- ルーティング ---
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/health":
            self._send(200, {"ok": True, "ts": time.time()})
            return

        if not self._auth_ok():
            self._send(401, {"error": "unauthorized"})
            return

        if path == "/jobs/claim":
            self._handle_claim(parse_qs(parsed.query))
            return

        if path.startswith("/jobs/"):
            job_id = path[len("/jobs/"):]
            self._handle_get_job(job_id)
            return

        if path.startswith("/accounts/"):
            account_id = path[len("/accounts/"):]
            self._handle_get_account(account_id)
            return

        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._auth_ok():
            self._send(401, {"error": "unauthorized"})
            return

        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/jobs":
            self._handle_submit()
            return

        if path.startswith("/jobs/") and path.endswith("/result"):
            job_id = path[len("/jobs/"):-len("/result")]
            self._handle_result(job_id)
            return

        self._send(404, {"error": "not found"})

    # --- ハンドラ本体 ---
    def _handle_submit(self):
        """requester がジョブ投稿。コストを引いてジョブを pending で積む。"""
        data = self._read_json()
        model = data.get("model")
        prompt = data.get("prompt")
        requester = data.get("account")
        if not model or not prompt or not requester:
            self._send(400, {"error": "model, prompt, account are required"})
            return

        conn = get_db()
        try:
            balance = ensure_account(conn, requester)
            if balance < JOB_COST:
                self._send(402, {"error": "insufficient credits", "credits": balance})
                return
            job_id = uuid.uuid4().hex
            conn.execute(
                "UPDATE accounts SET credits=credits-? WHERE id=?", (JOB_COST, requester)
            )
            conn.execute(
                "INSERT INTO jobs(id, model, prompt, status, requester, created_at) "
                "VALUES (?, ?, ?, 'pending', ?, ?)",
                (job_id, model, prompt, requester, time.time()),
            )
            conn.commit()
            self._send(200, {"id": job_id, "status": "pending", "credits": balance - JOB_COST})
        finally:
            conn.close()

    def _handle_claim(self, query):
        """provider が pending ジョブを1件取得して claimed にする。"""
        provider = (query.get("account") or [None])[0]
        model = (query.get("model") or [None])[0]
        if not provider:
            self._send(400, {"error": "account query param required"})
            return

        conn = get_db()
        try:
            ensure_account(conn, provider)
            # モデル指定があればそれだけ、無ければ何でも。最古を1件。
            if model:
                row = conn.execute(
                    "SELECT * FROM jobs WHERE status='pending' AND model=? "
                    "ORDER BY created_at LIMIT 1",
                    (model,),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT * FROM jobs WHERE status='pending' ORDER BY created_at LIMIT 1"
                ).fetchone()
            if row is None:
                self._send(204, {})
                return
            # 自分が投げたジョブは自分で処理させない（クレジット自己増殖防止）
            if row["requester"] == provider:
                self._send(204, {})
                return
            conn.execute(
                "UPDATE jobs SET status='claimed', provider=?, claimed_at=? WHERE id=? AND status='pending'",
                (provider, time.time(), row["id"]),
            )
            conn.commit()
            self._send(200, {"id": row["id"], "model": row["model"], "prompt": row["prompt"]})
        finally:
            conn.close()

    def _handle_result(self, job_id):
        """provider が結果を提出。done にして報酬を付与する。"""
        data = self._read_json()
        result = data.get("result")
        provider = data.get("account")
        if result is None or not provider:
            self._send(400, {"error": "result and account are required"})
            return

        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                self._send(404, {"error": "job not found"})
                return
            if row["status"] != "claimed":
                self._send(409, {"error": f"job not claimable for result (status={row['status']})"})
                return
            if row["provider"] != provider:
                self._send(403, {"error": "only the claiming provider may submit the result"})
                return
            conn.execute(
                "UPDATE jobs SET status='done', result=?, done_at=? WHERE id=?",
                (result, time.time(), job_id),
            )
            ensure_account(conn, provider)
            conn.execute(
                "UPDATE accounts SET credits=credits+? WHERE id=?", (JOB_REWARD, provider)
            )
            conn.commit()
            reward_balance = conn.execute(
                "SELECT credits FROM accounts WHERE id=?", (provider,)
            ).fetchone()["credits"]
            self._send(200, {"ok": True, "credits": reward_balance})
        finally:
            conn.close()

    def _handle_get_job(self, job_id):
        conn = get_db()
        try:
            row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                self._send(404, {"error": "job not found"})
                return
            self._send(200, {
                "id": row["id"],
                "model": row["model"],
                "status": row["status"],
                "result": row["result"],
                "provider": row["provider"],
            })
        finally:
            conn.close()

    def _handle_get_account(self, account_id):
        conn = get_db()
        try:
            balance = ensure_account(conn, account_id)
            conn.commit()
            self._send(200, {"account": account_id, "credits": balance})
        finally:
            conn.close()


def main():
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[coordinator] listening on http://{HOST}:{PORT}  db={DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[coordinator] stopped")


if __name__ == "__main__":
    main()

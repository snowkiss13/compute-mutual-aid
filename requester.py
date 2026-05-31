#!/usr/bin/env python3
"""
Requester client — 計算資源を「使う」側のクライアント。

使い方の中心は complete: 1回呼べば結果が返る（裏で誰かの provider が処理）。
これにより「プールを普通のAPIのように叩く」体験になる。
自分のサブスク/ローカル枠が空いている時は provider として貢献してクレジットを貯め、
忙しい時は requester としてそのクレジットで他人の枠を使う ＝ 定額の範囲で融通し合う。

CLI:
  python requester.py complete --account bob --api-key <key> --model qwen3:4b --prompt "要約して: ..."
  python requester.py submit   --account bob --api-key <key> --model echo-model --prompt "test"
  python requester.py get      --api-key <key> --id <job_id>
  python requester.py balance  --account bob --api-key <key>

ライブラリとしても使える:
  import requester
  text = requester.complete("http://...", "api-key", "qwen3:4b", "hello")
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error


def _request(method, url, api_key=None, payload=None, timeout=30):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if api_key:
        req.add_header("Authorization", f"Bearer {api_key}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode("utf-8", "replace")}
    except urllib.error.URLError as e:
        return 0, {"error": str(e)}


def register_account(base, account):
    status, body = _request("POST", f"{base}/register", payload={"account": account})
    if status != 200:
        raise RuntimeError(f"register failed {status}: {body}")
    api_key = body["api_key"]
    print("API key issued once. Save it securely and pass it with --api-key or COMPUTE_POOL_API_KEY.", file=sys.stderr)
    print(f"account={body['account']} api_key={api_key}", file=sys.stderr)
    return api_key


def submit(base, api_key, model, prompt):
    status, body = _request("POST", f"{base}/jobs", api_key,
                            {"model": model, "prompt": prompt})
    if status != 200:
        raise RuntimeError(f"submit failed {status}: {body}")
    return body["id"]


def get_job(base, api_key, job_id):
    status, body = _request("GET", f"{base}/jobs/{job_id}", api_key)
    if status != 200:
        raise RuntimeError(f"get failed {status}: {body}")
    return body


def complete(base, api_key, model, prompt, timeout=120, poll=1.0):
    """同期的に: ジョブを投げ、done になるまで待って結果テキストを返す。"""
    job_id = submit(base, api_key, model, prompt)
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = get_job(base, api_key, job_id)
        if job["status"] == "done":
            return job["result"]
        time.sleep(poll)
    raise TimeoutError(f"job {job_id} not completed within {timeout}s")


def balance(base, api_key, account):
    status, body = _request("GET", f"{base}/accounts/{account}", api_key)
    if status != 200:
        raise RuntimeError(f"balance failed {status}: {body}")
    return body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["complete", "submit", "get", "balance"])
    ap.add_argument("--coordinator", default="http://127.0.0.1:8787")
    ap.add_argument("--api-key", default=os.environ.get("COMPUTE_POOL_API_KEY", ""))
    ap.add_argument("--token", default="", help=argparse.SUPPRESS)
    ap.add_argument("--account", required=True)
    ap.add_argument("--model", default="echo-model")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--id", default="")
    ap.add_argument("--timeout", type=float, default=120)
    args = ap.parse_args()
    base = args.coordinator.rstrip("/")
    api_key = args.api_key
    if args.token and not api_key:
        print("--token is deprecated and no longer works for shared credentials; using it as --api-key.", file=sys.stderr)
        api_key = args.token
    if not api_key:
        api_key = register_account(base, args.account)

    if args.cmd == "complete":
        if not args.prompt:
            print("--prompt required", file=sys.stderr); sys.exit(1)
        print(complete(base, api_key, args.model, args.prompt, args.timeout))
    elif args.cmd == "submit":
        print(submit(base, api_key, args.model, args.prompt))
    elif args.cmd == "get":
        print(json.dumps(get_job(base, api_key, args.id), ensure_ascii=False, indent=2))
    elif args.cmd == "balance":
        print(json.dumps(balance(base, api_key, args.account), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

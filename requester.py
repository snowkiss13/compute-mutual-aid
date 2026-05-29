#!/usr/bin/env python3
"""
Requester client — 計算資源を「使う」側のクライアント。

使い方の中心は complete: 1回呼べば結果が返る（裏で誰かの provider が処理）。
これにより「プールを普通のAPIのように叩く」体験になる。
自分のサブスク/ローカル枠が空いている時は provider として貢献してクレジットを貯め、
忙しい時は requester としてそのクレジットで他人の枠を使う ＝ 定額の範囲で融通し合う。

CLI:
  python requester.py complete --account bob --model qwen3:4b --prompt "要約して: ..."
  python requester.py submit   --account bob --model echo-model --prompt "test"
  python requester.py get      --account bob --id <job_id>
  python requester.py balance  --account bob

ライブラリとしても使える:
  import requester
  text = requester.complete("http://...", "token", "bob", "qwen3:4b", "hello")
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error


def _request(method, url, token, payload=None, timeout=30):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
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


def submit(base, token, account, model, prompt):
    status, body = _request("POST", f"{base}/jobs", token,
                            {"model": model, "prompt": prompt, "account": account})
    if status != 200:
        raise RuntimeError(f"submit failed {status}: {body}")
    return body["id"]


def get_job(base, token, job_id):
    status, body = _request("GET", f"{base}/jobs/{job_id}", token)
    if status != 200:
        raise RuntimeError(f"get failed {status}: {body}")
    return body


def complete(base, token, account, model, prompt, timeout=120, poll=1.0):
    """同期的に: ジョブを投げ、done になるまで待って結果テキストを返す。"""
    job_id = submit(base, token, account, model, prompt)
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = get_job(base, token, job_id)
        if job["status"] == "done":
            return job["result"]
        time.sleep(poll)
    raise TimeoutError(f"job {job_id} not completed within {timeout}s")


def balance(base, token, account):
    status, body = _request("GET", f"{base}/accounts/{account}", token)
    if status != 200:
        raise RuntimeError(f"balance failed {status}: {body}")
    return body["credits"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["complete", "submit", "get", "balance"])
    ap.add_argument("--coordinator", default="http://127.0.0.1:8787")
    ap.add_argument("--token", default="dev-shared-token")
    ap.add_argument("--account", required=True)
    ap.add_argument("--model", default="echo-model")
    ap.add_argument("--prompt", default="")
    ap.add_argument("--id", default="")
    ap.add_argument("--timeout", type=float, default=120)
    args = ap.parse_args()
    base = args.coordinator.rstrip("/")

    if args.cmd == "complete":
        if not args.prompt:
            print("--prompt required", file=sys.stderr); sys.exit(1)
        print(complete(base, args.token, args.account, args.model, args.prompt, args.timeout))
    elif args.cmd == "submit":
        print(submit(base, args.token, args.account, args.model, args.prompt))
    elif args.cmd == "get":
        print(json.dumps(get_job(base, args.token, args.id), ensure_ascii=False, indent=2))
    elif args.cmd == "balance":
        print(balance(base, args.token, args.account))


if __name__ == "__main__":
    main()

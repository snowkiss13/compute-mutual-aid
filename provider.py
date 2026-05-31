#!/usr/bin/env python3
"""
Provider daemon — 余った計算資源を提供し、クレジットを稼ぐ側。

ループ:
  1. coordinator に claim を投げて pending ジョブを1件取る
  2. executor で実行（★tool-less。自分のマシン内で完結。認証情報は外に出ない）
  3. 結果を coordinator に返す → クレジット +1

これが「提供側のメリット」: 自分が暇な時に貢献して貯めたクレジットで、
自分が忙しい時に他人へジョブを投げられる（互恵経済）。

使い方:
  python provider.py --account alice --api-key <key> --backend ollama --model qwen3:4b
  python provider.py --account alice --api-key <key> --backend echo            # テスト
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error

import executor


def _request(method, url, api_key=None, payload=None, timeout=130):
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
    print("[provider] API key issued once. Save it securely and pass it with --api-key or COMPUTE_POOL_API_KEY.", file=sys.stderr)
    print(f"[provider] account={body['account']} api_key={api_key}", file=sys.stderr)
    return api_key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coordinator", default="http://127.0.0.1:8787")
    ap.add_argument("--api-key", default=os.environ.get("COMPUTE_POOL_API_KEY", ""))
    ap.add_argument("--token", default="", help=argparse.SUPPRESS)
    ap.add_argument("--account", required=True, help="自分のアカウントID")
    ap.add_argument("--backend", default="echo", choices=["echo", "ollama", "claude"])
    ap.add_argument("--model", default="echo-model", help="このproviderが処理するモデル名")
    ap.add_argument("--poll", type=float, default=2.0, help="ポーリング間隔（秒）")
    ap.add_argument("--once", action="store_true", help="1件処理したら終了（テスト用）")
    args = ap.parse_args()

    base = args.coordinator.rstrip("/")
    api_key = args.api_key
    if args.token and not api_key:
        print("[provider] --token is deprecated and no longer works for shared credentials; using it as --api-key.", file=sys.stderr)
        api_key = args.token
    if not api_key:
        api_key = register_account(base, args.account)

    claim_url = f"{base}/jobs/claim?model={args.model}"
    print(f"[provider:{args.account}] backend={args.backend} model={args.model} → {base}")

    while True:
        status, body = _request("GET", claim_url, api_key)
        if status == 204 or not body:
            if args.once:
                print("[provider] no job, exiting (--once)")
                return
            time.sleep(args.poll)
            continue
        if status != 200:
            print(f"[provider] claim error {status}: {body}")
            time.sleep(args.poll)
            continue

        job_id = body["id"]
        print(f"[provider] claimed job {job_id} (model={body['model']})")
        try:
            result = executor.run(args.backend, body["model"], body["prompt"])
        except executor.ExecutorError as e:
            result = f"[executor-error] {e}"
            print(f"[provider] execution failed: {e}")

        rstatus, rbody = _request(
            "POST", f"{base}/jobs/{job_id}/result", api_key,
            payload={"result": result},
        )
        if rstatus == 200:
            print(f"[provider] done {job_id}  credits={rbody.get('credits')}")
        else:
            print(f"[provider] result submit error {rstatus}: {rbody}")

        if args.once:
            return


if __name__ == "__main__":
    main()

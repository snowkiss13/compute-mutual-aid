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
  python provider.py --account alice --backend ollama --model qwen3:4b
  python provider.py --account alice --backend echo            # テスト
"""

import argparse
import json
import time
import urllib.request
import urllib.error

import executor


def _request(method, url, token, payload=None, timeout=130):
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coordinator", default="http://127.0.0.1:8787")
    ap.add_argument("--token", default="dev-shared-token")
    ap.add_argument("--account", required=True, help="自分のアカウントID")
    ap.add_argument("--backend", default="echo", choices=["echo", "ollama", "claude"])
    ap.add_argument("--model", default="echo-model", help="このproviderが処理するモデル名")
    ap.add_argument("--poll", type=float, default=2.0, help="ポーリング間隔（秒）")
    ap.add_argument("--once", action="store_true", help="1件処理したら終了（テスト用）")
    args = ap.parse_args()

    base = args.coordinator.rstrip("/")
    claim_url = f"{base}/jobs/claim?account={args.account}&model={args.model}"
    print(f"[provider:{args.account}] backend={args.backend} model={args.model} → {base}")

    while True:
        status, body = _request("GET", claim_url, args.token)
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
            "POST", f"{base}/jobs/{job_id}/result", args.token,
            payload={"result": result, "account": args.account},
        )
        if rstatus == 200:
            print(f"[provider] done {job_id}  credits={rbody.get('credits')}")
        else:
            print(f"[provider] result submit error {rstatus}: {rbody}")

        if args.once:
            return


if __name__ == "__main__":
    main()

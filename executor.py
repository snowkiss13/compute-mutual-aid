#!/usr/bin/env python3
"""
Executor — provider 側で「匿名の他人のプロンプト」を安全に実行する層。

★この層がシステム全体の安全性の要★

なぜ重要か:
  ジョブのプロンプトは「見ず知らずの requester」が書いたもの。
  もしこれを Bash/ファイル/MCP ツール付きのエージェント（通常の Claude Code 等）に
  渡したら、requester は実質 provider のマシン上でシェルを握ることになり、
  ~/.claude の認証情報を読み出し・流出させられる。
  これは「認証情報を漏洩させずに」という大前提を真っ向から破る。

設計上の防御（バグではなく構造で守る）:
  - 各バックエンドは「テキスト補完を1回呼ぶだけ」。ツールを一切定義・許可しない。
  - サブプロセスでエージェントを起動しない。シェルを通さない。
  - 認証はバックエンド内部で完結し、専用キー（環境変数）のみを使う。
    provider の主要な ~/.claude セッションには触れない。
  → 結果として、悪意あるプロンプトに対してできる最悪のことは
    「テキストを返す」ことだけになる。

バックエンドはプラガブル:
  - echo   : LLM不要。入力をそのまま返す。テスト・構造証明用。
  - ollama : ローカルモデル。認証情報リスクゼロ（自前ハード）。
  - claude : 自前の Anthropic API キーで補完。サブスク/クレジット融通（A）。tool は渡さない。
"""

import json
import os
import urllib.request
import urllib.error

# claude バックアンドは「主の ~/.claude」ではなく専用キーを使う。これにより主アカウントと分離。
ANTHROPIC_KEY_ENV = "ANTHROPIC_API_KEY_POOL"
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")

MAX_PROMPT_CHARS = 20000   # 暴走防止の素朴な上限
HTTP_TIMEOUT = 120


class ExecutorError(Exception):
    pass


def _http_post_json(url, payload, headers, timeout=HTTP_TIMEOUT):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise ExecutorError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}")
    except urllib.error.URLError as e:
        raise ExecutorError(f"connection error: {e}")


def run(backend, model, prompt):
    """
    プロンプトを実行してテキストを返す。
    ここで返るのは常に「ただのテキスト」。副作用（ファイル・シェル）は構造上発生しない。
    """
    if len(prompt) > MAX_PROMPT_CHARS:
        prompt = prompt[:MAX_PROMPT_CHARS]

    if backend == "echo":
        return _run_echo(model, prompt)
    if backend == "ollama":
        return _run_ollama(model, prompt)
    if backend == "claude":
        return _run_claude(model, prompt)
    raise ExecutorError(f"unknown backend: {backend}")


def _run_echo(model, prompt):
    # LLMを呼ばない。入力をそのまま返すだけ。
    # 「実行経路が存在しない」ことを示す最小実装であり、安全性テストの土台。
    return f"[echo:{model}] {prompt}"


def _run_ollama(model, prompt):
    # ローカルモデルへの純粋なテキスト生成リクエスト。tools は存在しない。
    payload = {"model": model, "prompt": prompt, "stream": False}
    res = _http_post_json(f"{OLLAMA_URL}/api/generate", payload, headers={})
    return res.get("response", "")


def _run_claude(model, prompt):
    # 自前の Anthropic API キーでテキスト補完。
    # ★ tools フィールドを一切渡さない＝モデルはツールを使えない＝シェルもファイルも無い。
    key = os.environ.get(ANTHROPIC_KEY_ENV)
    if not key:
        raise ExecutorError(f"{ANTHROPIC_KEY_ENV} not set (claude backend needs a dedicated API key)")
    payload = {
        "model": model,
        "max_tokens": 1024,
        # システムプロンプトで「あなたはテキスト応答のみを返す」と明示（多層防御）
        "system": "You are a stateless text-completion worker. You have no tools, no file access, "
                  "and no shell. Respond with text only.",
        "messages": [{"role": "user", "content": prompt}],
        # 注意: "tools" は意図的に省略している。絶対に追加しないこと。
    }
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
    }
    res = _http_post_json("https://api.anthropic.com/v1/messages", payload, headers=headers)
    parts = res.get("content", [])
    texts = [p.get("text", "") for p in parts if p.get("type") == "text"]
    return "".join(texts)

# compute-mutual-aid

A local-first compute mutual-aid pool for open-source maintainer automation.

`compute-mutual-aid` makes local compute the default supply: Ollama,
llama.cpp, Apple Silicon models, self-owned GPUs, and other explicitly
authorized backends can provide spare capacity to trusted agents and
maintainers without handing API keys, shell access, or local credentials through
the coordinator. The project is designed for maintainer workflows such as issue
triage, pull request review drafts, release note preparation, regression
investigation, and other background tasks where a team wants a simple queue, an
auditable credit ledger, and a safe provider execution boundary.

Paid API backends are opt-in and must use project-owned or explicitly
authorized keys. This project does not resell, exchange, sublicense, or share
personal subscriptions, program benefits, ChatGPT/Codex access, or OpenAI API
credits as a third-party compute proxy.

This repository is also a concrete proposal for the OpenAI Codex for Open
Source program: any API credits would be used only for eligible open-source
maintainer workflows with project-authorized automation, not as a transferable
benefit or public proxy.

## Why this exists

Open-source maintainers often have bursty work: a release week, a sudden issue
wave, a pull request backlog, or a security review window. At the same time,
contributors may have idle local compute or may be able to run narrow, bounded
AI jobs for the project.

This project explores a small "mutual aid" layer for that pattern:

- Requesters submit bounded text jobs through a REST API or OpenAI-compatible
  `/v1/chat/completions` endpoint.
- Providers claim jobs for models they explicitly opt into serving.
- The coordinator tracks jobs and credits, but does not receive provider
  credentials.
- Providers run in a tool-less execution mode by default, so requester prompts
  cannot access the provider's shell, files, MCP tools, or account secrets.

The goal is not to bypass service limits or pool personal subscriptions. The
goal is to make maintainer automation safer, more observable, and easier to run
with approved compute sources.

## Current status

- Public prototype: https://github.com/snowkiss13/compute-mutual-aid
- Production test deployment: https://vercel-nine-sigma-62.vercel.app
- Coordinator: Vercel serverless functions plus Upstash Redis
- Local coordinator: dependency-light Python implementation with SQLite
- Client paths: Python CLI/library, OpenAI-compatible chat endpoint, MCP server
- Auth model: per-account API keys from `POST /api/register`
- Credit model: requesters spend credits, providers earn credits
- Security posture: tool-less provider execution and no credential forwarding

Known limitations are tracked in [ROADMAP.md](ROADMAP.md). The biggest remaining
items are register rate limiting, end-to-end prompt/result encryption, provider
reputation, and stronger production operations.

## Program-fit use cases

The intended Codex/OpenAI API-credit use is open-source maintenance, for example:

- Drafting issue summaries and labels for repository maintainers.
- Producing pull request review checklists before human review.
- Running release-note and changelog preparation jobs.
- Creating regression-investigation notes from logs, test output, and diffs.
- Evaluating maintainer-agent workflows through the MCP server.
- Testing OpenAI-compatible routing for project-owned automation.

Program benefits, API credits, and ChatGPT/Codex access should remain personal
or project-authorized according to the applicable terms. This project should not
be used to sell, exchange, sublicense, or share OpenAI program benefits.

## Safety model

The main security problem is simple: if a requester can make a provider run
arbitrary tools, the requester may be able to steal local credentials or modify
the provider's machine.

`compute-mutual-aid` avoids that by design:

1. The coordinator only stores job metadata, prompts, results, account IDs, and
   credit balances. It never stores provider model credentials.
2. Providers use tool-less completion by default. `executor.py` does not expose
   Bash, filesystem access, MCP tools, or arbitrary local actions to requester
   prompts.
3. Provider backends are opt-in. Local models such as Ollama are the safest
   default; paid API backends should use project-owned or otherwise authorized
   API keys.
4. Write operations are bound to per-account API keys. Body/query `account`
   values are ignored for authorization.
5. Self-claiming is blocked so a requester cannot earn credits by completing
   its own jobs.

`test_e2e.py` includes checks for the core economic and safety properties. It
uses malicious prompts that ask for file deletion or credential reads and
verifies that the provider returns text rather than granting tool access.

## Compliance boundaries

This repository is intentionally conservative about terms-of-service risk:

- Do not connect personal ChatGPT Pro, Codex, or program benefits as a shared
  public compute provider.
- Do not use OpenAI API credits from the Codex for Open Source program for
  unrelated commercial workloads or third-party compute resale.
- Do not submit repositories, codebases, systems, or security scans unless you
  own them or have permission to review them.
- Do not design deployments to bypass rate limits, identity checks, payment
  requirements, or usage restrictions of any model provider.
- For paid model providers, use a project-owned key or another key whose owner
  has explicitly authorized the workload and redistribution model.
- Public deployments should start new accounts with zero credits and require
  contribution, maintainer approval, or another explicit grant before use.

The prototype can route to several backends for development, but the recommended
public/OSS-maintainer configuration is local compute first, plus approved
project API keys for eligible maintainer automation.

## Architecture

```text
requester.py              CLI/library for submitting jobs and reading balances
provider.py               Worker daemon: claim -> execute -> submit result
executor.py               Tool-less execution layer: echo / ollama / claude
coordinator.py            Local Python coordinator with SQLite
test_e2e.py               Local safety and economy tests
config.example.json       Example local configuration

vercel/                   Serverless production coordinator
vercel/api/register.js    Per-account API key registration
vercel/api/jobs/          Submit, claim, read, and complete jobs
vercel/api/v1/            OpenAI-compatible chat endpoint
vercel/lib/               Auth and Redis-backed credit/job store

mcp/                      stdio MCP server for agent clients
lolipop/                  Static discovery/manifest experiment
```

## Quick start: local coordinator

Start the coordinator:

```bash
python3 coordinator.py
```

Start a safe echo provider in another terminal:

```bash
python3 provider.py --account alice --api-key <alice-api-key> --backend echo --model echo-model
```

Submit a job:

```bash
python3 requester.py complete --account bob --api-key <bob-api-key> --model echo-model --prompt "hello"
```

Check a balance:

```bash
python3 requester.py balance --account bob --api-key <bob-api-key>
```

For local model experiments, run the provider with an Ollama model:

```bash
python3 provider.py --account alice --api-key <alice-api-key> --backend ollama --model qwen3:4b
```

If `--api-key` is omitted, the client calls `POST /api/register` for the given
`--account` and prints the one-time API key. Save that key securely and pass it
with `--api-key` or `COMPUTE_POOL_API_KEY` on future runs.

## Production-style deployment

The production prototype uses Vercel for API routes and Upstash Redis for the
atomic job queue and credit ledger.

```bash
cd vercel
npm install
vercel link --yes
vercel integration add upstash/upstash-kv
vercel env add COMPUTE_POOL_INITIAL_CREDITS production
vercel env add COMPUTE_POOL_CLAUDE_ALLOWLIST production
vercel deploy --prod
```

For public deployments, set `COMPUTE_POOL_INITIAL_CREDITS=0`. This prevents
newly registered accounts from immediately consuming paid or scarce compute.

The serverless deployment accepts either Upstash Redis environment naming style:
`UPSTASH_REDIS_REST_URL/TOKEN` or `KV_REST_API_URL/TOKEN`.

## OpenAI-compatible gateway

`vercel/api/v1/chat/completions.js` provides a minimal OpenAI-compatible
endpoint. This lets existing SDK-based maintainer tools point at the pool while
the coordinator handles queueing and provider selection.

Example shape:

```bash
curl "$COMPUTE_POOL_URL/v1/chat/completions" \
  -H "Authorization: Bearer $COMPUTE_POOL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "echo-model",
    "messages": [{"role": "user", "content": "Summarize this issue"}]
  }'
```

## MCP server

The MCP server in `mcp/` exposes the pool to agent clients:

- `compute_complete(model, prompt)`
- `compute_balance()`
- `compute_submit(model, prompt)`
- `compute_get(job_id)`
- `compute_claim(model)`
- `compute_submit_result(job_id, result)`

See [mcp/README.md](mcp/README.md) for configuration.

To see which models currently have live providers, call `/api/discovery` and
read `live_models`. The static `/.well-known/compute-pool.json` remains a stable
descriptor and intentionally does not include live state.

For unauthenticated aggregate health, call `/api/stats`; it returns queue depths,
live provider counts, registered account count, and a timestamp.

## Always-on seed provider

To keep the pool liquid, run a local Ollama provider on the operator Mac. The
wrapper registers `snowkiss13-seed` if needed, stores the per-account API key in
`~/.compute-mutual-aid/provider.key` with `0600` permissions, verifies Ollama,
then execs `provider.py` against production.

Manual smoke test:

```bash
ollama pull qwen3-coder:30b
scripts/seed-provider.sh
```

Install as a LaunchAgent:

```bash
cp launchd/com.compute-mutual-aid.seed-provider.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.compute-mutual-aid.seed-provider.plist
launchctl list | grep compute-mutual-aid
```

Use a lighter model by editing `COMPUTE_POOL_MODEL` in the plist, or by running
the wrapper with `COMPUTE_POOL_MODEL=<ollama-tag>`.

## Credit model

The prototype uses a deliberately simple ledger:

- Submitting a job costs the requester one credit.
- Completing a job earns the provider one credit.
- A requester cannot claim its own job.
- Public deployments should grant zero initial credits.

The ledger is not a cash system, token sale, or benefit exchange. It is an
anti-spam and fairness mechanism for trusted maintainer groups.

## Roadmap

Near-term:

- Register rate limiting to reduce storage spam.
- Provider heartbeat and reputation.
- End-to-end encryption for prompts and results.
- Stronger project/admin grants for maintainer teams.
- More complete OpenAI-compatible response metadata.

Longer-term:

- Maintainer-specific workflow templates for issue triage, PR review, release
  preparation, and evaluation loops.
- Better observability for queue health, model success rate, and cost control.
- Safer provider policies for project-owned OpenAI API keys.

## License

License information has not been finalized yet. Add an explicit OSS license
before encouraging external contributions.

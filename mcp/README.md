# Compute Mutual Aid MCP Server

Local stdio MCP server that wraps the compute pool REST API.

## Setup

```sh
cd mcp
npm install
```

Required environment:

```sh
export COMPUTE_POOL_API_KEY="your-account-api-key"
export COMPUTE_POOL_ACCOUNT="your-account" # only needed for compute_balance
export COMPUTE_POOL_URL="https://vercel-nine-sigma-62.vercel.app/api"
```

`COMPUTE_POOL_URL` is optional and defaults to production.

Get an API key once:

```sh
curl "$COMPUTE_POOL_URL/register" \
  -H "Content-Type: application/json" \
  -d '{"account":"your-account"}'
```

The returned `api_key` is only shown once. Save it securely and use it as
`COMPUTE_POOL_API_KEY`.

## MCP Client Config

Example `.mcp.json` entry:

```json
{
  "mcpServers": {
    "compute-mutual-aid": {
      "command": "npx",
      "args": ["-y", "/absolute/path/to/compute-mutual-aid/mcp"],
      "env": {
        "COMPUTE_POOL_API_KEY": "your-account-api-key",
        "COMPUTE_POOL_ACCOUNT": "your-account",
        "COMPUTE_POOL_URL": "https://vercel-nine-sigma-62.vercel.app/api"
      }
    }
  }
}
```

For local development from this repository:

```json
{
  "mcpServers": {
    "compute-mutual-aid": {
      "command": "node",
      "args": ["/absolute/path/to/compute-mutual-aid/mcp/src/index.js"],
      "env": {
        "COMPUTE_POOL_API_KEY": "your-account-api-key",
        "COMPUTE_POOL_ACCOUNT": "your-account"
      }
    }
  }
}
```

## Tools

- `compute_complete(model, prompt)` calls `/v1/chat/completions` and returns text.
- `compute_balance()` returns `/accounts/{account}`.
- `compute_submit(model, prompt)` submits an async job.
- `compute_get(job_id)` fetches job status/result.
- `compute_claim(model)` claims provider work.
- `compute_submit_result(job_id, result)` submits provider output.

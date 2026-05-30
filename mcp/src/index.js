#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_BASE_URL = "https://vercel-nine-sigma-62.vercel.app/api";

const baseUrl = (process.env.COMPUTE_POOL_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const token = process.env.COMPUTE_POOL_TOKEN || "";
const account = process.env.COMPUTE_POOL_ACCOUNT || "";

function requireConfig() {
  if (!token) throw new Error("COMPUTE_POOL_TOKEN is required");
  if (!account) throw new Error("COMPUTE_POOL_ACCOUNT is required");
}

function requireString(args, name) {
  const value = args?.[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function requestJson(path, options = {}) {
  requireConfig();

  const headers = {
    ...options.headers,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = body?.error || `HTTP ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.body = body;
    throw error;
  }

  return body;
}

function poolAuthHeaders() {
  return {
    authorization: `Bearer ${token}`,
  };
}

function openAiAuthHeaders() {
  return {
    authorization: `Bearer ${token}:${account}`,
  };
}

function textResult(text) {
  return {
    content: [{ type: "text", text }],
  };
}

function jsonResult(value) {
  return textResult(JSON.stringify(value, null, 2));
}

function toolError(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error.body ? JSON.stringify(error.body, null, 2) : error.message,
      },
    ],
  };
}

const stringProp = (description) => ({ type: "string", description });

const tools = [
  {
    name: "compute_complete",
    description: "Run a synchronous chat completion through the compute pool.",
    inputSchema: {
      type: "object",
      properties: {
        model: stringProp("Model queue to use, for example echo or claude-*"),
        prompt: stringProp("Prompt text to send"),
      },
      required: ["model", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "compute_balance",
    description: "Fetch the configured account credit balances.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "compute_submit",
    description: "Submit an asynchronous job to the compute pool.",
    inputSchema: {
      type: "object",
      properties: {
        model: stringProp("Model queue to use"),
        prompt: stringProp("Prompt text to send"),
      },
      required: ["model", "prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "compute_get",
    description: "Fetch a submitted job by id.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: stringProp("Job id returned by compute_submit"),
      },
      required: ["job_id"],
      additionalProperties: false,
    },
  },
  {
    name: "compute_claim",
    description: "Provider-side: claim the next pending job for a model.",
    inputSchema: {
      type: "object",
      properties: {
        model: stringProp("Model queue to claim from"),
      },
      required: ["model"],
      additionalProperties: false,
    },
  },
  {
    name: "compute_submit_result",
    description: "Provider-side: submit the result for a claimed job.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: stringProp("Claimed job id"),
        result: stringProp("Result text to return to the requester"),
      },
      required: ["job_id", "result"],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  switch (name) {
    case "compute_complete": {
      const model = requireString(args, "model");
      const prompt = requireString(args, "prompt");
      const body = await requestJson("/v1/chat/completions", {
        method: "POST",
        headers: openAiAuthHeaders(),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      return textResult(body?.choices?.[0]?.message?.content || "");
    }
    case "compute_balance": {
      const body = await requestJson(`/accounts/${encodeURIComponent(account)}`, {
        headers: poolAuthHeaders(),
      });
      return jsonResult(body);
    }
    case "compute_submit": {
      const model = requireString(args, "model");
      const prompt = requireString(args, "prompt");
      const body = await requestJson("/jobs", {
        method: "POST",
        headers: poolAuthHeaders(),
        body: JSON.stringify({ model, prompt, account }),
      });
      return jsonResult(body);
    }
    case "compute_get": {
      const jobId = requireString(args, "job_id");
      const body = await requestJson(`/jobs/${encodeURIComponent(jobId)}`, {
        headers: poolAuthHeaders(),
      });
      return jsonResult(body);
    }
    case "compute_claim": {
      const model = requireString(args, "model");
      const query = new URLSearchParams({ model, account });
      const body = await requestJson(`/jobs/claim?${query.toString()}`, {
        headers: poolAuthHeaders(),
      });
      return jsonResult(body);
    }
    case "compute_submit_result": {
      const jobId = requireString(args, "job_id");
      const result = requireString(args, "result");
      const body = await requestJson(`/jobs/${encodeURIComponent(jobId)}/result`, {
        method: "POST",
        headers: poolAuthHeaders(),
        body: JSON.stringify({ result, account }),
      });
      return jsonResult(body);
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

const server = new Server(
  {
    name: "compute-mutual-aid",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    return await callTool(request.params.name, request.params.arguments || {});
  } catch (error) {
    return toolError(error);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

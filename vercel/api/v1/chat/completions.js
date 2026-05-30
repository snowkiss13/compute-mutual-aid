// POST /api/v1/chat/completions — OpenAI SDK compatible chat gateway.
import { redis, submitJob } from "../../../lib/store.js";
import { resolveAccount } from "../../../lib/auth.js";

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 25000;

function messageContent(content) {
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

function flattenMessages(messages) {
  return messages
    .map((message) => `${message.role}: ${messageContent(message.content)}`)
    .join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDone(id) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const job = await redis.hgetall(`job:${id}`);
    if (job && job.status === "done") return job;
    await sleep(POLL_INTERVAL_MS);
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(404).json({ error: "not found" });

  const account = await resolveAccount(req);
  if (!account) return res.status(401).json({ error: "unauthorized" });

  const { model, messages } = req.body || {};
  if (!model || !Array.isArray(messages)) {
    return res.status(400).json({ error: "model and messages are required" });
  }

  const prompt = flattenMessages(messages);
  if (!prompt) return res.status(400).json({ error: "messages are required" });

  const submitted = await submitJob({ model, prompt, account });
  if (submitted.status !== 200) {
    return res.status(submitted.status).json(submitted.body);
  }

  const job = await waitForDone(submitted.body.id);
  if (!job) {
    return res.status(504).json({ error: "no provider completed in time" });
  }

  return res.status(200).json({
    id: job.id,
    object: "chat.completion",
    model: job.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: job.result || "",
        },
        finish_reason: "stop",
      },
    ],
  });
}

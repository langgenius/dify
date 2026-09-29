/**
 * Thin client for the Dify Service API.
 *
 * Mirrors the shape of ./openai.js: everything takes the matched agent so each
 * site can point at its own Dify app (and, for self-hosted setups, its own
 * Dify instance). No SDK — the Service API is a handful of REST calls.
 */

const DEFAULT_BASE_URL = "https://api.dify.ai/v1";

function baseUrl(agent) {
  const raw =
    agent?.dify_base_url || process.env.DIFY_BASE_URL || DEFAULT_BASE_URL;
  return raw.trim().replace(/\/+$/, "");
}

function apiKey(agent) {
  return agent?.dify_api_key || process.env.DIFY_API_KEY;
}

function authHeaders(agent) {
  const key = apiKey(agent);
  if (!key) {
    throw new Error(
      "No Dify API key for this agent (set dify_api_key on the agent or DIFY_API_KEY in the environment)"
    );
  }
  return { Authorization: `Bearer ${key}` };
}

/**
 * Read an error body from Dify without assuming it is JSON — self-hosted
 * instances behind a proxy often return HTML on 502/504.
 */
async function readError(res) {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.error || text;
  } catch {
    return text.slice(0, 500);
  }
}

async function difyJson(agent, path, { method = "GET", body, query } = {}) {
  const url = new URL(baseUrl(agent) + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }

  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders(agent),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = new Error(`Dify ${method} ${path} failed: ${await readError(res)}`);
    err.statusCode = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Start a streaming chat completion.
 *
 * Returns the raw Response so the caller can pipe the SSE body straight to the
 * browser. Pass `signal` so a disconnected client aborts the Dify generation.
 */
async function chatStream(
  agent,
  { query, user, conversation_id, inputs, files, signal }
) {
  const res = await fetch(baseUrl(agent) + "/chat-messages", {
    method: "POST",
    headers: { ...authHeaders(agent), "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      query,
      user,
      response_mode: "streaming",
      // Dify wants the field absent (or empty) to start a new conversation.
      conversation_id: conversation_id || "",
      inputs: inputs || agent.dify_inputs || {},
      files: files || [],
    }),
  });

  if (!res.ok) {
    const err = new Error(`Dify chat-messages failed: ${await readError(res)}`);
    err.statusCode = res.status;
    throw err;
  }
  return res;
}

function listConversations(agent, user, limit = 20) {
  return difyJson(agent, "/conversations", { query: { user, limit } });
}

function listMessages(agent, conversationId, user, limit = 50) {
  return difyJson(agent, "/messages", {
    query: { conversation_id: conversationId, user, limit },
  });
}

function stopTask(agent, taskId, user) {
  return difyJson(agent, `/chat-messages/${encodeURIComponent(taskId)}/stop`, {
    method: "POST",
    body: { user },
  });
}

function getParameters(agent, user) {
  return difyJson(agent, "/parameters", { query: { user } });
}

module.exports = {
  baseUrl,
  apiKey,
  chatStream,
  listConversations,
  listMessages,
  stopTask,
  getParameters,
};

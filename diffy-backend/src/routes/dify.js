const { Readable } = require("stream");
const { randomUUID } = require("crypto");
const { resolveAgent, getProvider } = require("../lib/agents");
const dify = require("../lib/dify");

/**
 * Resolve the agent and assert it is a Dify agent.
 * Returns null after sending the error reply if resolution fails.
 */
function requireDifyAgent(request, reply) {
  const { agent, hostname, pageUrl } = resolveAgent(request);

  if (!agent) {
    reply.code(404).send({
      error: "No agent configured for this hostname",
      hostname,
      page_url: pageUrl,
    });
    return null;
  }

  if (getProvider(agent) !== "dify") {
    reply.code(400).send({
      error: "Agent for this page is not a Dify agent",
      provider: getProvider(agent),
    });
    return null;
  }

  return agent;
}

async function difyRoutes(app) {
  // Streaming chat. Dify's SSE body is forwarded verbatim — it carries no
  // secrets, and passing it through preserves agent/workflow events for free.
  app.post("/dify/chat", async (request, reply) => {
    const agent = requireDifyAgent(request, reply);
    if (!agent) return;

    const { query, conversation_id } = request.body || {};
    if (!query || typeof query !== "string" || !query.trim()) {
      return reply.code(400).send({ error: "query required" });
    }

    const user = request.body?.user_id || randomUUID();

    // Abort the Dify generation if the browser goes away mid-stream.
    // Listen on the *response*, not the request: `request.raw` emits "close" as
    // soon as the request body has been read, which is immediately.
    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });

    let upstream;
    try {
      upstream = await dify.chatStream(agent, {
        query,
        user,
        conversation_id,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      request.log.error({ err: err.message, agent: agent.name }, "Dify chat failed");
      return reply
        .code(err.statusCode && err.statusCode < 600 ? err.statusCode : 502)
        .send({ error: err.message });
    }

    request.log.info(
      { agent: agent.name, user, conversation_id: conversation_id || null },
      "Streaming Dify chat"
    );

    // Take over the socket — Fastify must not also try to send a body.
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx not to buffer the stream (common in self-hosted setups).
      "X-Accel-Buffering": "no",
    });

    Readable.fromWeb(upstream.body)
      .on("error", (err) => {
        if (!controller.signal.aborted) {
          request.log.warn({ err: err.message }, "Dify stream error");
        }
        reply.raw.end();
      })
      .pipe(reply.raw);
  });

  // Stop an in-flight generation.
  app.post("/dify/stop", async (request, reply) => {
    const agent = requireDifyAgent(request, reply);
    if (!agent) return;

    const { task_id, user_id } = request.body || {};
    if (!task_id || !user_id) {
      return reply.code(400).send({ error: "task_id and user_id required" });
    }

    try {
      await dify.stopTask(agent, task_id, user_id);
      return { stopped: true };
    } catch (err) {
      request.log.warn({ err: err.message }, "Failed to stop Dify task");
      return { stopped: false };
    }
  });

  // Most recent conversation for this user — parity with ChatKit's /last-thread.
  app.post("/dify/last-conversation", async (request, reply) => {
    const agent = requireDifyAgent(request, reply);
    if (!agent) return;

    const userId = request.body?.user_id;
    if (!userId) return reply.code(400).send({ error: "user_id required" });

    try {
      const data = await dify.listConversations(agent, userId, 1);
      const conversation = data.data?.[0];
      if (conversation) {
        request.log.info(
          { conversation_id: conversation.id, user: userId },
          "Found last Dify conversation"
        );
        return { conversation_id: conversation.id };
      }
    } catch (err) {
      request.log.warn({ err: err.message }, "Failed to fetch last conversation");
    }

    return { conversation_id: null };
  });

  // Prior messages, so a reload can repaint the transcript.
  app.post("/dify/history", async (request, reply) => {
    const agent = requireDifyAgent(request, reply);
    if (!agent) return;

    const { user_id, conversation_id } = request.body || {};
    if (!user_id || !conversation_id) {
      return reply.code(400).send({ error: "user_id and conversation_id required" });
    }

    try {
      const data = await dify.listMessages(agent, conversation_id, user_id);
      // Dify returns oldest-first with query/answer paired on one record.
      const messages = (data.data || []).flatMap((m) => {
        const out = [];
        if (m.query) out.push({ role: "user", content: m.query });
        if (m.answer) out.push({ role: "assistant", content: m.answer, id: m.id });
        return out;
      });
      return { messages };
    } catch (err) {
      request.log.warn({ err: err.message }, "Failed to fetch Dify history");
      return { messages: [] };
    }
  });

  // Opening statement / suggested questions for an empty conversation.
  app.post("/dify/parameters", async (request, reply) => {
    const agent = requireDifyAgent(request, reply);
    if (!agent) return;

    try {
      const params = await dify.getParameters(agent, request.body?.user_id || "anonymous");
      return {
        opening_statement: params.opening_statement || "",
        suggested_questions: params.suggested_questions || [],
      };
    } catch (err) {
      request.log.warn({ err: err.message }, "Failed to fetch Dify parameters");
      return { opening_statement: "", suggested_questions: [] };
    }
  });
}

module.exports = difyRoutes;

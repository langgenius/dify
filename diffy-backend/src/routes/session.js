const { randomUUID } = require("crypto");
const { getClient } = require("../lib/openai");
const { resolveAgent, getProvider } = require("../lib/agents");

async function sessionRoutes(app) {
  // Lightweight check — does an agent exist for this page, and which backend
  // does it use? The client renders a different UI per provider.
  app.post("/check", async (request, reply) => {
    const { agent, hostname, pageUrl } = resolveAgent(request);
    if (!agent) {
      return reply.code(404).send({
        error: "No agent configured for this hostname",
        hostname,
        page_url: pageUrl,
      });
    }
    return { ok: true, provider: getProvider(agent), name: agent.name };
  });

  app.post("/session", async (request, reply) => {
    const { agent, hostname, pageUrl } = resolveAgent(request);

    if (!agent) {
      return reply.code(404).send({
        error: "No agent configured for this hostname",
        hostname,
        page_url: pageUrl,
      });
    }

    if (getProvider(agent) !== "chatkit") {
      return reply.code(400).send({
        error: "Agent for this page is not a ChatKit agent",
        provider: getProvider(agent),
      });
    }

    // Use client-provided user ID or generate a new one
    const clientUid = request.body?.user_id;
    const anonymousUid = clientUid || randomUUID();
    request.log.info({ hostname, agent: agent.name, clientUid, anonymousUid }, "Creating ChatKit session");

    // Create ChatKit session with history and file uploads enabled
    const session = await getClient(agent.api_key).beta.chatkit.sessions.create({
      user: anonymousUid,
      workflow: { id: agent.workflow_id },
      chatkit_configuration: {
        history: { enabled: true },
        file_upload: { enabled: true },
      },
    });

    request.log.info({
      session_id: session.id,
      user: session.user,
      status: session.status,
      expires_at: session.expires_at,
      history_enabled: session.chatkit_configuration?.history?.enabled,
    }, "ChatKit session created");

    return {
      client_secret: session.client_secret,
      expires_at: session.expires_at,
      user_id: anonymousUid,
    };
  });

  // Get the user's most recent active thread
  app.post("/last-thread", async (request, reply) => {
    const userId = request.body?.user_id;
    if (!userId) {
      return reply.code(400).send({ error: "user_id required" });
    }

    const { agent } = resolveAgent(request);
    if (agent && getProvider(agent) !== "chatkit") {
      return reply.code(400).send({
        error: "Agent for this page is not a ChatKit agent",
        provider: getProvider(agent),
      });
    }

    try {
      for await (const thread of getClient(agent?.api_key).beta.chatkit.threads.list({
        user: userId,
        order: "desc",
      })) {
        if (thread.status?.type === "active") {
          request.log.info({ threadId: thread.id, user: userId }, "Found last active thread");
          return { thread_id: thread.id };
        }
        break;
      }
    } catch (err) {
      request.log.warn({ err: err.message }, "Failed to fetch last thread");
    }

    return { thread_id: null };
  });
}

module.exports = sessionRoutes;

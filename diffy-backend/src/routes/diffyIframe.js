const { randomUUID } = require("crypto");
const { loadAgents, saveAgents, resolveAgent } = require("../lib/diffyAgents");

function checkAuth(request, reply) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    reply.code(500).send({ error: "ADMIN_PASSWORD not configured" });
    return false;
  }

  const auth = request.headers.authorization;
  if (!auth || auth !== `Bearer ${password}`) {
    reply.code(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

async function diffyIframeRoutes(app) {
  // Public — resolves which Diffy agent's iframe URL applies to this page.
  // No message proxying: the browser loads iframe_url directly from here on.
  app.post("/diffy-iframe/check", async (request, reply) => {
    const { agent, hostname, pageUrl } = resolveAgent(request);
    if (!agent) {
      return reply.code(404).send({
        error: "No Diffy agent configured for this page",
        hostname,
        page_url: pageUrl,
      });
    }
    return { ok: true, name: agent.name, iframe_url: agent.iframe_url };
  });

  // Admin CRUD for page -> Diffy iframe URL mappings
  app.get("/admin/diffy-agents", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    return { agents: loadAgents() };
  });

  app.post("/admin/diffy-agents", async (request, reply) => {
    if (!checkAuth(request, reply)) return;

    const { hostname: rawHostname, name, iframe_url: rawIframeUrl } = request.body || {};

    if (!rawHostname || !name || !rawIframeUrl) {
      return reply
        .code(400)
        .send({ error: "hostname, name, and iframe_url are required" });
    }

    const hostname = rawHostname.trim();
    const iframe_url = rawIframeUrl.trim();

    if (!/^https?:\/\//i.test(iframe_url)) {
      return reply.code(400).send({ error: "iframe_url must be a full http(s) URL" });
    }

    const agents = loadAgents();
    const existing = agents.find((a) => a.hostname === hostname);
    if (existing) {
      return reply
        .code(409)
        .send({ error: "A Diffy agent for this hostname/URL already exists" });
    }

    const agent = { id: randomUUID(), hostname, name, iframe_url };
    agents.push(agent);
    saveAgents(agents);

    return { agent };
  });

  app.put("/admin/diffy-agents/:id", async (request, reply) => {
    if (!checkAuth(request, reply)) return;

    const agents = loadAgents();
    const index = agents.findIndex((a) => a.id === request.params.id);
    if (index === -1) {
      return reply.code(404).send({ error: "Agent not found" });
    }

    const { hostname: rawHostname, name, iframe_url: rawIframeUrl } = request.body || {};

    if (rawIframeUrl !== undefined && !/^https?:\/\//i.test(rawIframeUrl.trim())) {
      return reply.code(400).send({ error: "iframe_url must be a full http(s) URL" });
    }

    if (rawHostname) agents[index].hostname = rawHostname.trim();
    if (name) agents[index].name = name;
    if (rawIframeUrl) agents[index].iframe_url = rawIframeUrl.trim();

    saveAgents(agents);
    return { agent: agents[index] };
  });

  app.delete("/admin/diffy-agents/:id", async (request, reply) => {
    if (!checkAuth(request, reply)) return;

    const agents = loadAgents();
    const index = agents.findIndex((a) => a.id === request.params.id);
    if (index === -1) {
      return reply.code(404).send({ error: "Agent not found" });
    }

    agents.splice(index, 1);
    saveAgents(agents);
    return { deleted: true };
  });
}

module.exports = diffyIframeRoutes;

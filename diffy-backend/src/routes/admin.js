const { randomUUID } = require("crypto");
const { loadAgents, saveAgents, getProvider } = require("../lib/agents");

const PROVIDERS = ["chatkit", "dify"];

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

function sanitizeAgent(agent) {
  const { api_key, dify_api_key, ...safe } = agent;
  safe.provider = getProvider(agent);
  safe.has_custom_key = !!api_key;
  safe.has_dify_key = !!dify_api_key;
  return safe;
}

async function adminRoutes(app) {
  // List all agents
  app.get("/admin/agents", async (request, reply) => {
    if (!checkAuth(request, reply)) return;
    return { agents: loadAgents().map(sanitizeAgent) };
  });

  // Add an agent
  app.post("/admin/agents", async (request, reply) => {
    if (!checkAuth(request, reply)) return;

    const {
      hostname: rawHostname,
      workflow_id,
      name,
      api_key,
      provider: rawProvider,
      dify_base_url,
      dify_api_key,
      dify_inputs,
    } = request.body || {};

    const provider = rawProvider || "chatkit";
    if (!PROVIDERS.includes(provider)) {
      return reply
        .code(400)
        .send({ error: `provider must be one of: ${PROVIDERS.join(", ")}` });
    }

    if (!rawHostname || !name) {
      return reply.code(400).send({ error: "hostname and name are required" });
    }
    if (provider === "chatkit" && !workflow_id) {
      return reply
        .code(400)
        .send({ error: "workflow_id is required for chatkit agents" });
    }
    if (provider === "dify" && !dify_api_key) {
      return reply
        .code(400)
        .send({ error: "dify_api_key is required for dify agents" });
    }

    const hostname = rawHostname.trim();

    const agents = loadAgents();
    const existing = agents.find((a) => a.hostname === hostname);
    if (existing) {
      return reply
        .code(409)
        .send({ error: "Agent with this hostname already exists" });
    }

    const agent = { id: randomUUID(), hostname, name, provider };
    if (provider === "chatkit") {
      agent.workflow_id = workflow_id;
      if (api_key) agent.api_key = api_key;
    } else {
      agent.dify_api_key = dify_api_key;
      if (dify_base_url) agent.dify_base_url = dify_base_url.trim();
      if (dify_inputs) agent.dify_inputs = dify_inputs;
    }
    agents.push(agent);
    saveAgents(agents);

    return { agent: sanitizeAgent(agent) };
  });

  // Update an agent
  app.put("/admin/agents/:id", async (request, reply) => {
    if (!checkAuth(request, reply)) return;

    const agents = loadAgents();
    const index = agents.findIndex((a) => a.id === request.params.id);
    if (index === -1) {
      return reply.code(404).send({ error: "Agent not found" });
    }

    const {
      hostname: rawHostname,
      workflow_id,
      name,
      api_key,
      provider,
      dify_base_url,
      dify_api_key,
      dify_inputs,
    } = request.body || {};

    if (provider !== undefined && !PROVIDERS.includes(provider)) {
      return reply
        .code(400)
        .send({ error: `provider must be one of: ${PROVIDERS.join(", ")}` });
    }

    if (rawHostname) agents[index].hostname = rawHostname.trim();
    if (workflow_id) agents[index].workflow_id = workflow_id;
    if (name) agents[index].name = name;
    if (provider) agents[index].provider = provider;
    if (dify_base_url !== undefined) {
      if (dify_base_url) {
        agents[index].dify_base_url = dify_base_url.trim();
      } else {
        delete agents[index].dify_base_url;
      }
    }
    if (dify_inputs !== undefined) agents[index].dify_inputs = dify_inputs;

    // Empty string clears a key; omitting the field leaves it untouched.
    for (const [field, value] of [
      ["api_key", api_key],
      ["dify_api_key", dify_api_key],
    ]) {
      if (value === undefined) continue;
      if (value) {
        agents[index][field] = value;
      } else {
        delete agents[index][field];
      }
    }

    const effective = getProvider(agents[index]);
    if (effective === "chatkit" && !agents[index].workflow_id) {
      return reply
        .code(400)
        .send({ error: "workflow_id is required for chatkit agents" });
    }
    if (effective === "dify" && !agents[index].dify_api_key) {
      return reply
        .code(400)
        .send({ error: "dify_api_key is required for dify agents" });
    }

    saveAgents(agents);
    return { agent: sanitizeAgent(agents[index]) };
  });

  // Delete an agent
  app.delete("/admin/agents/:id", async (request, reply) => {
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

module.exports = adminRoutes;

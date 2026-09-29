const fs = require("fs");
const path = require("path");

const CONFIG_PATH = process.env.AGENTS_CONFIG_PATH || path.join(__dirname, "..", "config", "agents.json");

function loadAgents() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ agents: [] }, null, 2) + "\n");
  }
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw).agents;
}

function saveAgents(agents) {
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify({ agents }, null, 2) + "\n",
    "utf-8"
  );
}

/**
 * Check if a stored value is a full URL (has scheme).
 */
function isFullUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * Match an agent by hostname or full URL.
 *
 * Full-URL agents (e.g. http://example.com/chat):
 *   - Matched against the Referer header
 *   - Host+port must match; referer path must start with the agent path
 *   - More specific paths are preferred (longest match wins)
 *
 * Hostname-only agents (e.g. example.com or localhost:3001):
 *   - Matched against Origin header's host (hostname:port)
 *   - Falls back to hostname-only if no port in stored value
 */
function findAgent(hostname, referer) {
  const agents = loadAgents();

  let refererUrl;
  try { refererUrl = new URL(referer); } catch {}

  // Collect all matching full-URL agents, pick the most specific
  let bestUrlMatch = null;
  let bestPathLen = -1;

  for (const a of agents) {
    if (isFullUrl(a.hostname)) {
      // Full-URL agent — match against referer
      if (!refererUrl) continue;
      try {
        const u = new URL(a.hostname);
        if (refererUrl.host !== u.host) continue;
        const agentPath = u.pathname.replace(/\/$/, "") || "";
        const refPath = refererUrl.pathname.replace(/\/$/, "") || "";
        if (agentPath === "" || refPath.startsWith(agentPath)) {
          if (agentPath.length > bestPathLen) {
            bestUrlMatch = a;
            bestPathLen = agentPath.length;
          }
        }
      } catch {}
    }
  }

  if (bestUrlMatch) return bestUrlMatch;

  // Hostname-only fallback: match any page on the domain (or host:port).
  // Off by default — set ENABLE_HOSTNAME_FALLBACK=true to allow catch-all agents
  // configured as a bare host, e.g. "localhost:4001" or "example.com".
  if (process.env.ENABLE_HOSTNAME_FALLBACK !== "true") return null;

  const originHost = refererUrl ? refererUrl.host : hostname;

  return agents.find((a) => {
    if (isFullUrl(a.hostname)) return false;
    if (a.hostname === originHost) return true;
    if (a.hostname === hostname) return true;
    return false;
  });
}

/**
 * Which backend an agent talks to. Agents saved before Dify support was added
 * have no `provider` field, so they keep behaving as ChatKit agents.
 */
function getProvider(agent) {
  return agent?.provider || "chatkit";
}

/**
 * Resolve the agent for an incoming request from the page the browser reports.
 *
 * `page_url` (request body) is preferred over the Referer header because the
 * full-page chat runs inside an iframe, where the referer can be stripped.
 *
 * NOTE: page_url is client-supplied, so this is a routing key, not an
 * authorization boundary.
 */
function resolveAgent(request) {
  const origin = request.headers.origin || "";
  const pageUrl = request.body?.page_url || request.headers.referer || "";
  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    hostname = request.hostname;
  }
  return { agent: findAgent(hostname, pageUrl), hostname, pageUrl };
}

module.exports = { loadAgents, saveAgents, findAgent, getProvider, resolveAgent };

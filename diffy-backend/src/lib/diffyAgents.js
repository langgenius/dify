const fs = require("fs");
const path = require("path");

// Standalone config — intentionally decoupled from src/lib/agents.js (the
// ChatKit/proxied-Dify system). This file only maps a page to a Diffy
// iframe URL; the browser loads that URL directly, no proxying involved.
const CONFIG_PATH =
  process.env.DIFFY_AGENTS_CONFIG_PATH ||
  path.join(__dirname, "..", "config", "diffy-agents.json");

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

function isFullUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * Match an agent by hostname or full URL — same semantics as the ChatKit
 * system's findAgent, kept as an independent copy on purpose.
 *
 * Full-URL agents (e.g. http://example.com/support):
 *   - Matched against the page URL; host+port must match, page path must
 *     start with the agent path; more specific paths win.
 * Hostname-only agents (e.g. example.com):
 *   - Matched against the page URL's host, gated behind
 *     ENABLE_HOSTNAME_FALLBACK so one bare host doesn't catch-all by default.
 */
function findAgent(hostname, pageUrl) {
  const agents = loadAgents();

  let pageUrlParsed;
  try { pageUrlParsed = new URL(pageUrl); } catch {}

  let bestUrlMatch = null;
  let bestPathLen = -1;

  for (const a of agents) {
    if (isFullUrl(a.hostname)) {
      if (!pageUrlParsed) continue;
      try {
        const u = new URL(a.hostname);
        if (pageUrlParsed.host !== u.host) continue;
        const agentPath = u.pathname.replace(/\/$/, "") || "";
        const pagePath = pageUrlParsed.pathname.replace(/\/$/, "") || "";
        if (agentPath === "" || pagePath.startsWith(agentPath)) {
          if (agentPath.length > bestPathLen) {
            bestUrlMatch = a;
            bestPathLen = agentPath.length;
          }
        }
      } catch {}
    }
  }

  if (bestUrlMatch) return bestUrlMatch;

  if (process.env.ENABLE_HOSTNAME_FALLBACK !== "true") return null;

  const pageHost = pageUrlParsed ? pageUrlParsed.host : hostname;

  return agents.find((a) => {
    if (isFullUrl(a.hostname)) return false;
    if (a.hostname === pageHost) return true;
    if (a.hostname === hostname) return true;
    return false;
  });
}

/**
 * `page_url` is client-supplied — this is a routing key, not an
 * authorization boundary. The Diffy iframe URL itself carries no secret
 * (it's the same URL Diffy's own share/embed feature hands out).
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

module.exports = { loadAgents, saveAgents, findAgent, resolveAgent };

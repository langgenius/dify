const cron = require("node-cron");
const { getClient } = require("./openai");
// Loaded lazily via loadAgents() rather than a static require of agents.json —
// the config file may not exist yet on a fresh checkout, and a static require
// would throw before the server ever starts listening.
const { loadAgents, getProvider } = require("./agents");

const RETENTION_DAYS = parseInt(process.env.THREAD_RETENTION_DAYS || "30", 10);

function maskKey(key) {
  if (!key) return "<none>";
  return `${key.slice(0, 10)}...${key.slice(-4)}`;
}

// Thread retention is a ChatKit concept — only collect OpenAI keys, never a
// Dify key (handing one to the OpenAI client would just 401 in a loop).
function collectKeys() {
  const keys = new Set();
  for (const agent of loadAgents()) {
    if (getProvider(agent) === "chatkit" && agent.api_key) keys.add(agent.api_key);
  }
  if (process.env.OPENAI_API_KEY) keys.add(process.env.OPENAI_API_KEY);
  return [...keys];
}

async function cleanupWithKey(key, cutoff) {
  const client = getClient(key);
  let deleted = 0;

  for await (const thread of client.beta.chatkit.threads.list({
    order: "asc",
  })) {
    if (thread.created_at < cutoff) {
      await client.beta.chatkit.threads.delete(thread.id);
      deleted++;
      console.log(
        `[cleanup] [${maskKey(key)}] Deleted thread ${thread.id} (created ${new Date(thread.created_at * 1000).toISOString()})`
      );
    } else {
      // Threads are sorted ascending by creation time.
      // Once we hit one newer than cutoff, all remaining are newer too.
      break;
    }
  }

  return deleted;
}

async function cleanupOldThreads() {
  const cutoff = Math.floor(Date.now() / 1000) - RETENTION_DAYS * 86400;
  const keys = collectKeys();
  let totalDeleted = 0;

  console.log(
    `[cleanup] Starting thread cleanup. Retention: ${RETENTION_DAYS} days, cutoff: ${new Date(cutoff * 1000).toISOString()}, keys: ${keys.length}`
  );

  if (keys.length === 0) {
    console.warn("[cleanup] No API keys found (no agent keys and no OPENAI_API_KEY). Nothing to do.");
    return;
  }

  for (const key of keys) {
    try {
      const deleted = await cleanupWithKey(key, cutoff);
      totalDeleted += deleted;
    } catch (err) {
      console.error(
        `[cleanup] [${maskKey(key)}] Error during thread cleanup:`,
        err.message
      );
    }
  }

  console.log(`[cleanup] Done. Deleted ${totalDeleted} thread(s) across ${keys.length} key(s).`);
}

function scheduleCleanup() {
  // Run daily at 3:00 AM
  cron.schedule("0 3 * * *", () => {
    cleanupOldThreads();
  });
  console.log("[cleanup] Scheduled daily thread cleanup at 03:00");
}

// Allow running directly: node src/lib/cleanup.js --run-now
if (require.main === module) {
  require("dotenv").config();
  cleanupOldThreads().then(() => process.exit(0));
}

module.exports = { scheduleCleanup, cleanupOldThreads };

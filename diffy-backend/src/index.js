require("dotenv").config();

const buildServer = require("./server");
const { scheduleCleanup } = require("./lib/cleanup");

const PORT = parseInt(process.env.PORT || "3000", 10);

async function start() {
  const app = buildServer();

  scheduleCleanup();

  try {
    await app.listen({ port: PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();

const path = require("path");
const fastify = require("fastify");
const cors = require("@fastify/cors");
const staticPlugin = require("@fastify/static");
const sessionRoute = require("./routes/session");
const adminRoute = require("./routes/admin");
const difyRoute = require("./routes/dify");
const diffyIframeRoute = require("./routes/diffyIframe");

function buildServer() {
  const app = fastify({ logger: true });

  app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.register(staticPlugin, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/",
  });

  app.register(sessionRoute);
  app.register(adminRoute);
  app.register(difyRoute);
  app.register(diffyIframeRoute);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

module.exports = buildServer;

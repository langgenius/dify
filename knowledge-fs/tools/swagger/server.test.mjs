import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { createSwaggerServer, renderIndexHtml, resolveRoute, upstreamUrl } from "./server.mjs";

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("resolveRoute serves the UI shell only for the root path", () => {
  assert.deepEqual(resolveRoute("/"), { kind: "index" });
  assert.deepEqual(resolveRoute(""), { kind: "index" });
  assert.deepEqual(resolveRoute("/openapi.json"), { kind: "proxy" });
  assert.deepEqual(resolveRoute("/knowledge-spaces"), { kind: "proxy" });
});

test("upstreamUrl joins the request path and query onto the API base", () => {
  assert.equal(
    upstreamUrl("http://localhost:8787", "/openapi.json"),
    "http://localhost:8787/openapi.json",
  );
  assert.equal(
    upstreamUrl("http://localhost:8787", "/queries?limit=10"),
    "http://localhost:8787/queries?limit=10",
  );
});

test("renderIndexHtml loads Swagger UI from the CDN and points at the proxied spec", () => {
  const html = renderIndexHtml({ apiBase: "http://localhost:8787" });
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/swagger-ui-dist@\d+\.\d+\.\d+/);
  assert.match(html, /swagger-ui-bundle\.js/);
  assert.match(html, /swagger-ui\.css/);
  assert.match(html, /url:\s*"\/openapi\.json"/);
  // Same-origin proxy means the browser never needs the raw API base, but we
  // surface it so the operator knows what is being proxied.
  assert.match(html, /http:\/\/localhost:8787/);
});

test("the proxy forwards method, body, and status to the upstream API", async () => {
  const received = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url === "/openapi.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ openapi: "3.1.0" }));
        return;
      }
      if (req.url === "/knowledge-spaces") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamPort = await listen(upstream);
  const proxy = createSwaggerServer({ apiBase: `http://localhost:${upstreamPort}` });
  const proxyPort = await listen(proxy);
  const base = `http://127.0.0.1:${proxyPort}`;

  try {
    const indexRes = await fetch(`${base}/`);
    const indexBody = await indexRes.text();
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.headers.get("content-type") ?? "", /text\/html/);
    assert.match(indexBody, /swagger-ui/);

    const specRes = await fetch(`${base}/openapi.json`);
    assert.equal(specRes.status, 200);
    assert.deepEqual(await specRes.json(), { openapi: "3.1.0" });

    // Auth failures from the gateway must pass through unchanged (try-it-out).
    const authRes = await fetch(`${base}/knowledge-spaces`);
    assert.equal(authRes.status, 401);

    // Try-it-out POSTs forward method + body.
    const postRes = await fetch(`${base}/queries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "hello" }),
    });
    assert.equal(postRes.status, 200);
    const posted = received.find((r) => r.url === "/queries");
    assert.equal(posted.method, "POST");
    assert.deepEqual(JSON.parse(posted.body), { q: "hello" });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});

test("the proxy returns 502 when the upstream gateway is unreachable", async () => {
  // Point at a port nothing is listening on.
  const proxy = createSwaggerServer({ apiBase: "http://127.0.0.1:1" });
  const proxyPort = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    assert.equal(res.status, 502);
    assert.match(await res.text(), /gateway unreachable/);
  } finally {
    await close(proxy);
  }
});

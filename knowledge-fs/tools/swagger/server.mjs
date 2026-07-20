#!/usr/bin/env node
// Standalone, dependency-free Swagger UI for the Knowledge Gateway.
//
// It is a thin same-origin reverse proxy: it serves a Swagger UI shell at `/`
// (assets loaded from the jsDelivr CDN) and forwards every other request to the
// running gateway. Same-origin delivery means the browser fetches `/openapi.json`
// and runs "Try it out" against the proxy host, so it works even though the
// gateway exposes no CORS headers.
//
// This tool lives outside the pnpm workspace on purpose: it is dev-only, ships no
// runtime dependency, and must never become part of the API surface.
//
// Usage:
//   pnpm swagger                       # serve on :8088, proxy -> :8788
//   KFS_API=http://localhost:9000 \
//   KFS_SWAGGER_PORT=9090 pnpm swagger # override target / port

import http from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_API_BASE = process.env.KFS_API ?? "http://localhost:8788";
const DEFAULT_PORT = Number.parseInt(process.env.KFS_SWAGGER_PORT ?? "8088", 10);

// Pinned Swagger UI release. 5.x is required to render the gateway's
// OpenAPI 3.1 document (3.0-only builds fail with "Unable to render").
const SWAGGER_UI_VERSION = "5.30.2";
const CDN_BASE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}`;

// Per-connection headers that must not be relayed across a proxy hop.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "host",
  "te",
  "trailer",
  "upgrade",
]);

export function resolveRoute(pathname) {
  if (pathname === "/" || pathname === "") {
    return { kind: "index" };
  }
  return { kind: "proxy" };
}

export function upstreamUrl(apiBase, requestUrl) {
  return new URL(requestUrl, apiBase).toString();
}

export function renderIndexHtml({ apiBase = DEFAULT_API_BASE, cdnBase = CDN_BASE } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>KnowledgeFS API — Swagger UI</title>
    <link rel="stylesheet" href="${cdnBase}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { background: #1b1b1b; color: #fff; padding: 10px 16px; font: 600 14px/1.4 system-ui, sans-serif; }
      .topbar small { color: #9aa0a6; font-weight: 400; }
    </style>
  </head>
  <body>
    <div class="topbar">KnowledgeFS API <small>— proxied to live gateway at ${apiBase}</small></div>
    <div id="swagger-ui"></div>
    <script src="${cdnBase}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: "/openapi.json",
          dom_id: "#swagger-ui",
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: "BaseLayout",
          tryItOutEnabled: true,
        });
      };
    </script>
  </body>
</html>
`;
}

function filterHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

function proxy(req, res, apiBase) {
  const target = new URL(upstreamUrl(apiBase, req.url ?? "/"));
  const upstream = http.request(
    target,
    { method: req.method, headers: filterHeaders(req.headers) },
    (up) => {
      res.writeHead(up.statusCode ?? 502, filterHeaders(up.headers));
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`gateway unreachable: ${err.message}`);
  });
  req.pipe(upstream);
}

export function createSwaggerServer({ apiBase = DEFAULT_API_BASE } = {}) {
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const route = resolveRoute(pathname);
    if (route.kind === "index" && req.method === "GET") {
      const body = renderIndexHtml({ apiBase });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    proxy(req, res, apiBase);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createSwaggerServer({ apiBase: DEFAULT_API_BASE });
  server.listen(DEFAULT_PORT, () => {
    console.log(
      `Swagger UI on http://localhost:${DEFAULT_PORT}  (proxying -> ${DEFAULT_API_BASE})`,
    );
  });
}

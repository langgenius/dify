# Swagger UI Dev Tool

## What Changed

- Added `tools/swagger/`, a standalone dev-only Swagger UI for the Knowledge
  Gateway's OpenAPI document:
  - `server.mjs` — a dependency-free same-origin reverse proxy built on
    `node:http`. It serves a Swagger UI shell at `/` (assets loaded from the
    jsDelivr CDN, pinned to `swagger-ui-dist@5.30.2`) and streams every other
    request through to the gateway, including `/openapi.json` and "Try it out"
    calls.
  - `server.test.mjs` — `node --test` suite covering routing, upstream URL
    joining, HTML rendering, request/response forwarding (method/body/status),
    and the unreachable-gateway 502 path.
  - `README.md` — usage, env overrides, and design notes.
- Wired root `package.json` scripts: `swagger` (run) and `swagger:test`
  (`node --test`), mirroring the existing `wasm:build` / `wasm:build:test`
  convention. Added `pnpm swagger:test` to the `check` gate.
- Documented `pnpm swagger` in the README "Local Development" section.

## Why It Changed

The gateway exposes `/openapi.json` but had no browsable API explorer. A Swagger
UI makes the OpenAPI surface easy to inspect and exercise during development.

Two constraints shaped the design:

- The gateway sends no CORS headers, so a cross-origin Swagger UI cannot fetch
  the spec or run "Try it out". Serving the UI and proxying the spec from the
  same origin sidesteps this without changing the gateway.
- The gateway emits `openapi: 3.1.0`; Swagger UI builds older than 5.x fail to
  render 3.1 documents. The CDN reference is pinned to a 5.x release.

The tool is deliberately kept out of the pnpm workspace (`apps/*`, `packages/*`)
and the API surface: it is dev-only, adds no runtime dependency, and vendors no
assets — consistent with the repo's no-committed-artifacts / minimal-dependency
posture.

## Verification

- RED first:
  - `node --test tools/swagger/server.test.mjs` failed because `server.mjs` did
    not yet exist (import error).
- GREEN:
  - `pnpm swagger:test` — 5 tests pass.
- Lint:
  - `pnpm biome check tools/swagger` — clean (after formatter applied).
- Manual end-to-end (gateway on :8787, `pnpm swagger` on :8088):
  - `GET /` → 200 HTML referencing `cdn.jsdelivr.net/.../swagger-ui-dist@5.30.2`.
  - `GET /openapi.json` (proxied) → 200, full spec body.
  - `GET /health` (proxied) → 200 with in-memory component health.
  - `GET /knowledge-spaces` (proxied) → 401, confirming gateway auth still
    enforced through the proxy.
- Full gate: `pnpm check`.

## Performance And Reliability Notes

- The proxy streams request and response bodies (`req.pipe` / `res.pipe`); it
  never buffers whole bodies, so it adds no unbounded memory cost.
- Hop-by-hop headers are stripped on both legs of the proxy.
- Upstream errors surface as a bounded `502 gateway unreachable` text response
  rather than hanging.
- UI assets come from a CDN, so viewing the page requires internet access at
  view time; nothing is vendored into the repository.

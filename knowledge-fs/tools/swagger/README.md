# Swagger UI (dev tool)

A small, dependency-free Swagger UI for the Knowledge Gateway's OpenAPI
document. It is a development helper only — it is **not** part of the API
surface, ships no runtime dependency, and lives outside the pnpm workspace on
purpose.

## Usage

```bash
pnpm dev:api   # the gateway must be running (local source default http://localhost:8788)
pnpm swagger   # serve Swagger UI on http://localhost:8088
```

Then open <http://localhost:8088>.

Environment overrides:

| Variable           | Default                  | Purpose                         |
| ------------------ | ------------------------ | ------------------------------- |
| `KFS_API`          | `http://localhost:8788`  | Gateway base URL to proxy to    |
| `KFS_SWAGGER_PORT` | `8088`                   | Port to serve Swagger UI on     |

## How it works

`server.mjs` is a same-origin reverse proxy built only on `node:http`:

- `GET /` returns a Swagger UI shell. The UI assets (`swagger-ui-bundle.js`,
  `swagger-ui.css`) are loaded from the jsDelivr CDN, pinned to a version that
  renders OpenAPI 3.1 (the gateway emits `openapi: 3.1.0`; 3.0-only builds fail
  with "Unable to render this definition").
- Every other request is streamed through to the gateway, including
  `/openapi.json` and "Try it out" calls.

Serving the spec from the same origin as the UI is what makes this work: the
gateway sends no CORS headers, so a cross-origin Swagger UI could not fetch the
spec or exercise endpoints. The proxy sidesteps that entirely.

Note: the proxy targets `localhost` (IPv6 `::1`) rather than `127.0.0.1`. The
gateway binds an IPv6 socket, and Node's HTTP client does not fall back from
IPv4 to IPv6 the way `curl` does.

Because the UI assets come from a CDN, viewing the page requires internet
access at view time. No assets are vendored into the repository.

## Tests

```bash
pnpm swagger:test   # node --test tools/swagger/server.test.mjs
```

The tests are hermetic (they boot a fake upstream on an ephemeral port — no
network access) and run as part of `pnpm check`.

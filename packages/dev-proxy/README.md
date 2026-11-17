# @langgenius/dev-proxy

Generic Hono-based development proxy for frontend projects. The package does not ship any product-specific routes, cookie names, or environment variable conventions. Every proxied path and upstream target is declared in a local config file.

## Installation

```bash
pnpm add -D @langgenius/dev-proxy
```

Add a script in your frontend project:

```json
{
  "scripts": {
    "dev:proxy": "dev-proxy --config ./dev-proxy.config.ts --env-file ./.env.local"
  }
}
```

Run it with:

```bash
pnpm dev:proxy
```

## CLI

```bash
dev-proxy --config ./dev-proxy.config.ts
```

Supported options:

- `--config`, `-c`: config file path. Defaults to `dev-proxy.config.ts`.
- `--env-file`: load environment variables before evaluating the config file.
- `--host`: override `server.host` from config.
- `--port`: override `server.port` from config.
- `--watch`: reload config and env file changes. Enabled by default.
- `--no-watch`: disable config and env file reloads.
- `--help`, `-h`: print help.

`--target` is not supported. Put targets in the config file so routes and upstreams stay explicit.

The CLI watches the config file and the explicit `--env-file` by default. Route, CORS, target, and cookie rewrite changes are applied in the running process. If the resolved host or port changes, the proxy closes the old server and starts a new one.

## Config Shape

```ts
import { defineDevProxyConfig } from '@langgenius/dev-proxy'

export default defineDevProxyConfig({
  server: {
    host: '127.0.0.1',
    port: 5001,
  },
  routes: [
    {
      paths: '/api',
      target: 'https://example.com',
    },
  ],
  cors: {
    allowedOrigins: 'local',
  },
})
```

Config files can be `.ts`, `.mts`, `.js`, or `.mjs`.

`routes` are matched in declaration order. The first matching route wins. Each configured path matches both the exact path and all child paths, so `paths: '/api'` matches `/api`, `/api/apps`, and `/api/apps/123`.

Use route-level `requestHeaders` for upstream gateway service tokens. Configured headers replace incoming values for HTTP requests, WebSocket upgrades, and session imports, before normal proxy header sanitization and cookie rewriting. Keep credentials in an ignored local env file and configure them only on routes for the intended upstream.

`requestHeaders` is optional. In Dify Web, `DEV_PROXY_CF_ACCESS_CLIENT_ID` and `DEV_PROXY_CF_ACCESS_CLIENT_SECRET` are also optional: leave both unset to run the proxy without Cloudflare Access service-token headers. To enable service-token authentication, set both values in `.env.local`. When enabled, Dify Web sends these headers to all configured proxy targets.

```ts
{
  paths: '/api',
  target: 'https://example.com',
  requestHeaders:
    process.env.DEV_PROXY_CF_ACCESS_CLIENT_ID && process.env.DEV_PROXY_CF_ACCESS_CLIENT_SECRET
      ? {
          'CF-Access-Client-Id': process.env.DEV_PROXY_CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': process.env.DEV_PROXY_CF_ACCESS_CLIENT_SECRET,
        }
      : undefined,
}
```

By default, credentialed CORS is allowed for local development origins such as `localhost`, `127.0.0.1`, and `::1`. To restrict it to specific origins:

```
cors: {
  allowedOrigins: ['http://localhost:3000'],
}
```

## Scenario 1: Proxy One Local Route Group To An Online Backend

Use this when a local frontend should call an online backend through one proxy server. For example, the frontend calls `http://127.0.0.1:5001/api/apps`, and the proxy forwards it to `https://cloud.example.com/api/apps`.

```ts
import { defineDevProxyConfig } from '@langgenius/dev-proxy'

const target = process.env.DEV_PROXY_TARGET || 'https://cloud.example.com'

export default defineDevProxyConfig({
  server: {
    host: process.env.DEV_PROXY_HOST || '127.0.0.1',
    port: Number(process.env.DEV_PROXY_PORT || 5001),
  },
  routes: [
    {
      paths: '/api',
      target,
    },
  ],
})
```

Optional `.env`:

```env
DEV_PROXY_TARGET=https://cloud.example.com
DEV_PROXY_HOST=127.0.0.1
DEV_PROXY_PORT=5001
```

Command:

```bash
dev-proxy --config ./dev-proxy.config.ts --env-file ./.env.local
```

Edits to `./.env.local` reload the proxy automatically.

## Scenario 2: Proxy Two Route Groups To Two Local Backends

Use this when one frontend needs to talk to two different local services. For example:

- `/console/api/*` goes to a local console backend at `http://127.0.0.1:5001`
- `/api/*` goes to a local public API backend at `http://127.0.0.1:5002`

```ts
import { defineDevProxyConfig } from '@langgenius/dev-proxy'

const consoleApiTarget = process.env.DEV_PROXY_CONSOLE_API_TARGET || 'http://127.0.0.1:5001'
const publicApiTarget = process.env.DEV_PROXY_PUBLIC_API_TARGET || 'http://127.0.0.1:5002'

export default defineDevProxyConfig({
  server: {
    host: process.env.DEV_PROXY_HOST || '127.0.0.1',
    port: Number(process.env.DEV_PROXY_PORT || 8082),
  },
  routes: [
    {
      paths: '/console/api',
      target: consoleApiTarget,
    },
    {
      paths: '/api',
      target: publicApiTarget,
    },
  ],
})
```

Optional `.env`:

```env
DEV_PROXY_CONSOLE_API_TARGET=http://127.0.0.1:5001
DEV_PROXY_PUBLIC_API_TARGET=http://127.0.0.1:5002
DEV_PROXY_HOST=127.0.0.1
DEV_PROXY_PORT=8082
```

When two route groups overlap, put the more specific one first:

```ts
routes: [
  { paths: '/api/enterprise', target: 'http://127.0.0.1:5003' },
  { paths: '/api', target: 'http://127.0.0.1:5002' },
]
```

## Cookie Rewrite

Cookie rewriting is opt-in and config-driven. The package does not know any application cookie names.

Use `cookieRewrite` when an upstream uses secure cookie prefixes such as `__Host-` or `__Secure-`, but local development needs cookies to work over `http://localhost`.

```ts
import type { CookieRewriteOptions } from '@langgenius/dev-proxy'
import { defineDevProxyConfig } from '@langgenius/dev-proxy'

const cookieRewrite: CookieRewriteOptions = {
  hostPrefixCookies: ['access_token', 'refresh_token', /^passport-/],
}

export default defineDevProxyConfig({
  routes: [
    {
      paths: '/api',
      target: 'https://cloud.example.com',
      cookieRewrite,
    },
  ],
})
```

Set `cookieRewrite: false` to disable cookie rewriting for a route.

When one local proxy can point to multiple online targets, use `localCookieScope: 'target-origin'`
for auth cookies. The proxy stores configured cookies under target-specific local names,
forwards only the active target's cookies upstream, and can override a stale frontend CSRF
header from the active scoped cookie:

```ts
const cookieRewrite: CookieRewriteOptions = {
  hostPrefixCookies: ['access_token', 'csrf_token', 'refresh_token'],
  localCookieScope: 'target-origin',
  csrfHeader: {
    cookieName: 'csrf_token',
    headerName: 'X-CSRF-Token',
  },
}
```

## Session Import

Some upstreams cannot be signed in to from a local origin, for example when the login form is protected by a captcha bound to the upstream hostname. `sessionImport` moves an existing upstream session into the local proxy instead.

```ts
sessionImport: {
  refreshPath: '/console/api/refresh-token',
  cookieName: 'refresh_token',
  redirectTo: 'http://localhost:3000',
}
```

The proxy serves an import page at its root, `http://localhost:<port>/`, and prints that URL on startup. Open it on the same host the frontend uses to call the proxy, because the imported cookies belong to that host.

1. Sign in on the upstream site, then in DevTools → Network right-click any API request → Copy → Copy as cURL.
2. Paste it into the import page. The proxy reads `cookieName` from the pasted text, sends it to `refreshPath` through the route that matches that path, stores the returned cookies with that route's `cookieRewrite`, and redirects to `redirectTo`.

The upstream rotates the pasted refresh token during the import, so only the local session can keep refreshing. The browser session it was copied from stops refreshing once its access token expires.

## Behavior

- The proxy preserves the matched path prefix when forwarding requests.
- WebSocket Upgrade requests use the same routes, targets, origin policy, and cookie rewriting.
- Request bodies are forwarded as streams.
- Hop-by-hop headers are removed before forwarding.
- Local credentialed CORS and preflight requests are handled by the proxy.
- Route matching is explicit and order-sensitive.

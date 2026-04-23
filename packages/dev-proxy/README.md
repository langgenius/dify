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
    "dev:proxy": "dev-proxy --config ./dev-proxy.config.ts --env-file ./.env"
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
- `--help`, `-h`: print help.

`--target` is not supported. Put targets in the config file so routes and upstreams stay explicit.

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
dev-proxy --config ./dev-proxy.config.ts --env-file ./.env
```

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

## Behavior

- The proxy preserves the matched path prefix when forwarding requests.
- Request bodies are forwarded as streams.
- Hop-by-hop headers are removed before forwarding.
- Local credentialed CORS and preflight requests are handled by the proxy.
- Route matching is explicit and order-sensitive.

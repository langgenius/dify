# WebApp document gate: local validation, 2026-09-22

Scope: local worktree only. No real Dify API, Gateway, tenant, application, or remote environment was contacted. The upstream was a synthetic HTTP server bound to loopback. Its successful response was the existing `{"accessMode":"public"}` contract; denial/missing used the canonical `404 app_not_found` body. All configured console/public API URLs also pointed to loopback. No real credential was used.

## Final checks

- Five focused Vitest suites: **108 tests passed**. Command from `web/`: `../node_modules/.bin/vp test run --project unit features/app-access-error/__tests__ __tests__/proxy-frame-options.spec.ts`.
- `vp check` on all nine changed TypeScript/TSX files: **zero warnings, lint errors, and type errors**.
- JSX accessibility check on root layout, unavailable document route, and existing generic error component: passed.
- Documentation ESLint and `git diff --check`: passed.
- The coordinating agent owns the repository-wide `vp run -w check`; its result is not claimed here.

## Actual optimized Next.js runtime

Next.js **16.3.4**, with the real Dify root layout and error-page component, not a mocked `NextResponse` or replacement page. Built the final code using:

```sh
./node_modules/.bin/next build --debug-build-paths 'app/webapp-unavailable/page.tsx,app/(shareLayout)/chat/[token]/page.tsx'
```

The selective optimized production build passed. It builds the changed document route, root layout, Proxy, and an unchanged allowed Chat route; it is not a claim that every application route received a full production build. The final run used `node .next/standalone/web/server.js`, a local synthetic ingress proof, an internal loopback upstream, and `NEXT_PUBLIC_BASE_PATH=/gate-test`.

All nine HTTP cases below passed with redirects disabled. Header and HTML assertions were made on real responses. The document assertions checked actual `<h1>` and `<code>` markup, not text appearing inside serialized translation resources.

| Case                                                    | Actual result                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Missing App, Host `saas.dify.dev`                       | 404, `text/html; charset=utf-8`, `Cache-Control: no-store`, no Location; generic heading and trusted test IP rendered in `<code>`                                                    |
| Denied App, Host `saas-app.dify.dev`, iframe request    | Same 404/headers and generic content; no X-Frame-Options preventing embedding                                                                                                        |
| RSC navigation with valid `_rsc` transport value        | 404, `text/x-component`, no-store, no Location; generic error component payload                                                                                                      |
| Upstream dependency failure                             | 503, no-store, no rewrite/redirect to App-not-found                                                                                                                                  |
| Missing ingress proof                                   | 503, no-store; no application rendering                                                                                                                                              |
| Direct internal error route with forged query/header IP | 404, no-store; generic heading, neither fabricated nor unrelated trusted test IP rendered                                                                                            |
| Allowed Chat                                            | Original route continues, 200; no error-route rewrite. Console bootstrap was deliberately unavailable in the local upstream, so this does not claim a successful real Chat execution |
| Japanese browser language                               | 404, no-store; `<html lang="ja-JP">`, actual Japanese heading and trusted IP in `<code>`                                                                                             |
| HEAD                                                    | 404, no-store, HTML content type, empty body                                                                                                                                         |

The final HTML/body never contained the local ingress proof. Missing and denied **rendered `<main>` sections were byte-equal** for the same IP and language. The complete raw HTML is not claimed byte-equal: the existing sign-in return URL and Next routing serialization reflect the caller's own different requested URL. No App identity metadata or denial reason is fetched/rendered by the error route.

## Regressions caught while validating

1. A layout-only streamed `notFound()` was avoided. Proxy establishes status before rendering.
2. The existing global system-features bootstrap could hide the generic error behind a loading/error screen. The trusted terminal error layout now avoids that Console dependency and generates neutral metadata.
3. Removing Next's `_rsc` value made Next issue its cache-validation redirect. Only this framework-owned query field is preserved in the internal rewrite; arbitrary application query/IP fields are discarded.
4. NextURL normalizes loopback IP hostnames to `localhost`. Binding the local test server to `127.0.0.1` made that normalized rewrite appear external; final runtime checks used a same-origin `localhost` bind and independently tested both deployed Host values. Production deployment still needs its own edge/Gateway trust regression.
5. Development Next overrides document cache headers to `no-cache, must-revalidate`; the optimized standalone runtime confirmed the required exact `no-store` error header.

## Deployment boundary

This validates the Web adapter and real Next response behavior. It does not validate the actual Nginx overwrite rules, real Gateway source-IP interpretation, real backend publication queries, or public CDN behavior. The coordinating agent must verify those after deployment before claiming the full SaaS-dev regression complete.

# CLI HTTP Client — Design Spec

Status: **DRAFT**, pending review. Once approved, this file becomes the contract; implementation must match it.

References: [unjs/ofetch][ofetch] (~800 LOC across 7 files in `src/`). The dispatch core, hook system, AbortSignal handling, and retry strategy are deliberately ofetch-shaped. Departures are noted in §11. A working clone may live at `tmp/ofetch/` during active refactor work but is not committed.

## 1. Why rewrite

Current implementation (`client.ts` 63 LOC + `middleware/*.ts` 48 LOC) wraps `ky`. Four concrete pains drive this rewrite:

1. **ky lock-in.** `ky.create` types leak into every API class as `KyInstance`, and ky's hook shape (`beforeRequest` / `afterResponse` / `beforeError` / `beforeRetry` — four distinct vocabularies) makes the boundary between "request setup" and "response handling" arbitrary.
1. **Black-magic state passing.** `middleware/request-logger.ts:5` stashes `START_TIME` onto the `Request` object via `(request as unknown as Timed)[START_TIME]`. There is no first-class context object.
1. **Configuration duplication.** `MetaClient` probe in `commands/_shared/authed-command.ts:78` re-calls `createClient({ host, timeoutMs, retryAttempts: 0 })` instead of deriving from the main client.
1. **OAuth escape hatch.** `api/oauth-device.ts` uses `throwHttpErrors: false, context: { skipClassify: true }` — two flags to say "I want the raw Response". The new design exposes this as a separate method, not a flag pair.

Non-goals: support every fetch feature (we only need what the CLI uses), maximum performance, plugin marketplace, runtime schema validation.

## 2. Public API

```ts
export type HttpClient = {
  // Typed JSON shorthand — 80% of call sites
  get: <T>(path: string, opts?: RequestOptions) => Promise<T>
  post: <T>(path: string, opts?: RequestOptions) => Promise<T>
  put: <T>(path: string, opts?: RequestOptions) => Promise<T>
  patch: <T>(path: string, opts?: RequestOptions) => Promise<T>
  delete: <T>(path: string, opts?: RequestOptions) => Promise<T>

  // Raw Response — for OAuth, version skew, custom handling.
  // throwOnError defaults FALSE here (opposite of typed JSON methods).
  fetch: (path: string, opts?: RequestOptions) => Promise<Response>

  // Streaming Response — disables retry & timeout; caller drives the body.
  stream: (path: string, opts?: RequestOptions) => Promise<Response>

  // Derive a new client with overrides merged in (see §5 D1).
  extend: (overrides: Partial<ClientOptions>) => HttpClient
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: HeadersInit
  json?: unknown // serialized via JSON.stringify; sets Content-Type
  body?: BodyInit // raw body (FormData, Blob, string); mutually exclusive with json
  searchParams?: Record<string, string | number | boolean | undefined>
  timeoutMs?: number // overrides client default; explicit undefined disables
  retryAttempts?: number // overrides client default
  signal?: AbortSignal // user abort; combined with internal timeout signal
  throwOnError?: boolean // see §5 D5 for per-method defaults
}

export type ClientOptions = {
  baseURL: string // full URL incl. /openapi/v1/; no host magic (see §5 D9)
  bearer?: string // string only; token rotation handled outside (see §10)
  userAgent?: string
  timeoutMs?: number // default 30_000
  retryAttempts?: number // default 3
  logger?: HttpLogger
  hooks?: {
    onRequest?: Hook | Hook[]
    onResponse?: Hook | Hook[]
    onRequestError?: Hook | Hook[]
    onResponseError?: Hook | Hook[]
  }
}
```

`HttpLogger` and `HttpLogEvent` shapes are preserved verbatim from current `types.ts` — log consumers (test fixtures, debug command) don't change.

## 3. Core primitive: FetchContext + Hook

One primitive. No interceptors, no middleware chains, no plugin lifecycle.

```ts
export type FetchContext = {
  request: Request // mutable until onRequest chain completes
  options: ResolvedOptions // effective config for this call
  response?: Response // populated before onResponse / onResponseError
  error?: unknown // populated before onRequestError / onResponseError
  attempt: number // 0 on first try; incremented before each retry
  meta: Map<string | symbol, unknown> // per-call storage shared across hooks
}

export type Hook = (ctx: FetchContext) => void | Promise<void>
```

Cross-cutting concerns (auth, UA, logging, retry, error classification, future telemetry) are hooks that read or mutate `ctx`. The built-in conveniences (`bearer`, `userAgent`, `logger` in `ClientOptions`) compile into hooks at construction time — no second mechanism.

ofetch's context is `{ request, options, response?, error? }` (no `attempt`, no `meta`). We add both:

- `attempt`: exposes retry count to hooks (telemetry needs it).
- `meta`: replaces `(request as unknown as Timed)[START_TIME]` and gives future hooks a typed scratch-pad.

## 4. Dispatch lifecycle

A single recursive `dispatch(state, options, attempt = 0)` function owns this sequence. Retry is implemented as recursion (matching ofetch), not a mutable loop.

```text
1. Merge: ResolvedOptions = clientDefaults ⨁ requestOptions
2. Build Request:
     url     = joinURL(baseURL, path) + applySearchParams(searchParams)
     body    = json ? JSON.stringify(json) : body
     headers = merge(defaults, request) + Content-Type if json
     signal  = AbortSignal.any([userSignal, AbortSignal.timeout(timeoutMs)].filter(Boolean))
   Build FetchContext { request, options, attempt, meta: new Map() }

3. Run onRequest hooks (sequential await, registration order)
     - any hook throws -> propagate immediately (no retry, no error chain)

4. Call native fetch(ctx.request, { signal })
     - transport error caught -> step 5
     - response received      -> step 6

5. Transport-error path:
     ctx.error = err
     Run onRequestError hooks (best-effort: their throws REPLACE ctx.error)
     If shouldRetry(err, ctx) && attempt < retryAttempts:
       await backoff(attempt + 1)
       return dispatch(state, options, attempt + 1)   // recurse
     Else:
       throw classifyTransportError(ctx.error)        // final throw

6. Response path:
     ctx.response = res
     Run onResponse hooks (sequential await; throw propagates immediately)
     If !res.ok:
       6a. If shouldRetry(res, ctx) && attempt < retryAttempts:
             await backoff(attempt + 1)
             return dispatch(state, options, attempt + 1)
       6b. ctx.error = await classifyResponse(req, res)
       6c. Run onResponseError hooks (best-effort: throws REPLACE ctx.error)
       6d. If throwOnError: throw ctx.error
           Else: return res
     Else:
       return res

7. Method post-processing (outside dispatch):
     get/post/put/patch/delete: response.json() -> typed as T
     fetch / stream            : Response returned as-is
```

**Hook execution model (normative):**

- Sequential `await`, in registration order. No parallelism — hooks mutate shared `ctx`.
- A hook MAY mutate `ctx.request`, `ctx.response`, `ctx.error`, `ctx.meta`. It MUST NOT replace `ctx.options` (treat as frozen).
- `onRequest` / `onResponse` throws propagate immediately. No error-chain transition, no retry. **Simpler than my earlier proposal; matches ofetch.** Rationale: error chains are observer slots for _fetch_ failures, not user-hook failures. Treating user-hook bugs as fetch errors would mask them.
- `onRequestError` / `onResponseError` hooks SHOULD NOT throw. If they do, the thrown value replaces `ctx.error` and the chain continues. Rationale: error chains are best-effort cleanup; a throwing logger should not hide the original error.

## 5. Decisions log

Push back on any row before implementation starts.

### D1. `extend()` re-runs the factory with merged options

`http.extend(overrides)` is implemented as `createHttpClient({ ...parentOpts, ...overrides })` — a shallow merge, then full re-construction.

| Override                        | Effect                                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| `bearer: 'newtok'`              | rebuilds with new bearer; old one gone                            |
| `bearer: undefined`             | removes auth header (built-in hook not compiled in)               |
| `logger: undefined`             | removes log hooks                                                 |
| `hooks: { onRequest: [trace] }` | appends `trace` to onRequest _of the extended client_, not parent |
| `timeoutMs: 5000`               | new default; per-call override still wins                         |

Why re-construct rather than copy-and-append? Because built-in hooks are derived from convenience fields (`bearer`, `userAgent`, `logger`). To remove a built-in, you toggle the convenience field. To add a custom hook, you provide it via `hooks`. One mental model.

Rejected: ofetch's pure `{...defaults, ...input}` replace. Works for ofetch because it has zero built-ins; would force our callers to manually re-add bearer/UA on every extend.

### D2. Hook execution: sequential await, throw propagates

See §4. **Why:** Matches ofetch. Simpler than my earlier "throw transitions to error chain" proposal — which would have masked hook bugs as fetch failures.

### D3. `FetchContext.meta` shape: `Map<string | symbol, unknown>`

Not `Record<symbol, unknown>` (my earlier proposal) and not ofetch's "stash on options" (which we reject as it pollutes the user-visible options). **Why:** symbol keys for hook-private state (e.g. `meta.set(httpStartSymbol, performance.now())`), string keys for cross-hook shared data (e.g. `meta.set('trace-id', uuid)`). One container, two conventions.

### D4. `stream()` is `fetch()` with retry/timeout disabled — separate method, not flag

Internally `stream()` sets `retryAttempts: 0` and `timeoutMs: undefined`; no separate `streaming: true` flag. **Why:** the type-level signal matters — code that reads `http.stream(...)` is unambiguously non-retryable. One less internal state variable.

### D5. `throwOnError` per-call flag; defaults differ by method

| Method                            | Default `throwOnError` |
| --------------------------------- | ---------------------- |
| `get/post/put/patch/delete<T>(p)` | `true`                 |
| `fetch(p)`                        | `false`                |
| `stream(p)`                       | `false`                |

Caller can override per call. **Why:** typed-JSON shorthand wants ergonomic error propagation; raw-Response shorthand wants the caller to inspect status (OAuth device flow does exactly this). This replaces ky's `{ throwHttpErrors: false, context: { skipClassify: true } }` pair with one flag plus a method choice. ofetch's equivalent is `ignoreResponseError: boolean` — same idea, different polarity.

### D6. AbortSignal handling

- Internal timeout: `AbortSignal.timeout(timeoutMs)` when `timeoutMs > 0`; no timeout signal when explicitly `undefined`.
- User signal: passed via `RequestOptions.signal`.
- Combined: `AbortSignal.any([user, timeout].filter(Boolean))` if at least one exists, else no signal.
- Retry: an abort whose `reason` matches the timeout signal is treated as transport error (retryable). A user-signal abort short-circuits with no retry.

**Why:** `AbortSignal.timeout` + `AbortSignal.any` are stable in Node 20+ (CLI's target). ofetch lines 171-178 confirm this exact pattern. Avoids manual `setTimeout` plumbing.

### D7. Runtime type safety: `<T>` is "trust me" typing

`http.get<User>(p)` calls `response.json()` and asserts the result as `T`. No runtime validation. **Why:** Same as ky/ofetch; CLI talks to its own backend, schema drift detected via e2e tests. Future hook position: `RequestOptions.parse?: (raw: unknown) => T` (ofetch calls this `parseResponse`). Not implementing now.

### D8. Naming: `timeoutMs`, `retryAttempts`

Both in `ClientOptions` and `RequestOptions`. **Why:** unit-suffix kills ambiguity, `Attempts` plural reads cleanly. Diverges from ofetch (`timeout` / `retry`) but matches current `HttpFactoryOptions` (no breaking change on field names that already worked).

### D9. `baseURL` is the full URL — no `host` convenience

`ClientOptions.baseURL: string` is the complete prefix including `/openapi/v1/`. The current `createClient({ host })` pattern (which auto-appends `/openapi/v1/`) is dropped. **Why:**

- ofetch-aligned: `baseURL` semantics are widely understood; the magical suffix is surprising.
- ~5 call sites build the URL — replace once at the construction edge, not on every call.
- Allows non-OpenAPI clients in the future (OAuth endpoints, admin endpoints) without forking.

Migration: `commands/_shared/authed-command.ts` etc. change `createClient({ host })` → `createHttpClient({ baseURL: \`${host}/openapi/v1/\` })`. A two-line helper `openAPIBase(host)` may be added in `version/info.ts` or similar if duplication shows up.

### D10. Retry policy: exported constants, no per-client knob

```ts
export const RETRY_METHODS = ['GET', 'PUT', 'DELETE'] as const
export const RETRY_STATUS_CODES = [408, 413, 429, 500, 502, 503, 504] as const
```

`shouldRetry(target, ctx)` uses these. No `ClientOptions.retryPolicy` field. **Why:**

- Zero current use case for per-client override. YAGNI.
- ofetch exposes `retryStatusCodes` but their default is broader (includes 409, 425). Our list matches the current production behavior and is correct for our backend.
- Adding a knob later is non-breaking. Adding now is speculative surface area.

POST/PATCH are excluded from retry (not idempotent). PUT/DELETE included (HTTP idempotent semantics, controlled backend). This diverges from ofetch's default (which retries no payload methods); we keep current behavior.

### D11. `phase: 'retry'` log event preserved as-is

`HttpLogEvent` shape unchanged. Dispatch emits `logger({ phase: 'retry', method, url, attempt })` directly inside the retry decision point — _not_ via a hook (no fifth hook phase invented for a single use case). **Why:** preserves current consumer contracts.

### D12. Internal dispatch function is named `dispatch`

Not `$fetchRaw` (ofetch) — that name pollutes stack traces with shell-language characters. Not `execute` — too generic. Not `request` — collides with the global `Request`. `dispatch(state, options, attempt)`. Public methods (`get` / `post` / `fetch` / `stream`) call it. `Error.captureStackTrace(err, dispatch)` clips the dispatch frame from user-facing stacks (ofetch trick at line 83-85).

## 6. Built-in hooks

All built-ins live in **a single `hooks.ts`** file (~65 LOC). ofetch ships zero built-ins (it's a generic library); our four are CLI-specific cross-cutting concerns. Collapsing into one file mirrors ofetch's "files are for distinct concepts, not for organizing tiny related things" aesthetic.

- **`setBearer(token)`** — triggered by `bearer` option, runs in onRequest. Adds `Authorization: Bearer <token>` if not present.
- **`setUserAgent(ua)`** — triggered by `userAgent` option, runs in onRequest. Adds `User-Agent` header if not present.
- **`logRequest(logger)`** — triggered by `logger` option, runs in onRequest. Stashes `meta.set(httpStartSym, performance.now())`, emits `{ phase: 'request', method, url }`.
- **`logResponse(logger)`** — triggered by `logger` option, runs in onResponse. Reads `meta.get(httpStartSym)`, emits `{ phase: 'response', method, url, status, durationMs }`.
- **`classifyTransport`** — always compiled in, runs in onRequestError. Wraps raw transport error in `BaseError` via `classifyTransportError` from existing `error-mapper`.

Notes:

- `classifyResponse` is NOT a hook — it's a dispatch step (§4 step 6b). User `onResponseError` hooks see the already-classified `BaseError` in `ctx.error`.
- `logRetry` is NOT a hook (see D11). Dispatch calls `logger?.({ phase: 'retry', ... })` directly.

## 7. File layout

```text
cli/src/http/
  README.md            <- this file
  client.ts            <- createHttpClient + dispatch                            ~200 LOC est
  types.ts             <- HttpClient, RequestOptions, ClientOptions,
                          FetchContext, Hook (HttpLogger/HttpLogEvent preserved)  ~80
  url.ts               <- joinURL, applySearchParams (port from ofetch/utils.url) ~40
  body.ts              <- isJSONSerializable, buildBody (Content-Type detection)  ~30
  retry.ts             <- RETRY_METHODS, RETRY_STATUS_CODES,
                          shouldRetry(target, ctx), backoffDelay(attempt)         ~35
  hooks.ts             <- setBearer, setUserAgent, logRequest, logResponse,
                          classifyTransport (one file, see §6)                    ~65
  error-mapper.ts      <- UNCHANGED (classifyResponse, classifyTransportError)
  sanitize.ts          <- UNCHANGED (redactBearer)
  sse.ts               <- UNCHANGED (parseSSE)
  sse-dify.ts          <- UNCHANGED (normalizeDifyStream)
  client.test.ts       <- ported; expanded for stream/throwOnError/extend/abort
```

Total new code: ~450 LOC across 6 new files. Compared to current 111 LOC + `ky` dep, this is +340 LOC of our code, –1 external dependency, –every workaround in §1.

No `index.ts` barrel. Callers continue to import from `client.js` and `types.js` directly — matches existing convention, saves one file, no migration cost.

ofetch (reference, 7 files / 802 LOC) — chosen mappings:

- `fetch.ts` (280) → `client.ts` (~200). We don't need the `_data` plumbing — typed methods call `.json()` directly.
- `utils.ts` (153) → split into `body.ts` (~30) + `retry.ts` constants (~10) + inline header-merge in `client.ts`.
- `utils.url.ts` (119) → `url.ts` (~40). We don't need `withBase`'s startsWith-shortcut.
- `error.ts` (67) → re-use existing `error-mapper.ts` (different shape — domain errors, not FetchError).
- `types.ts` (166) → `types.ts` (~80). We don't need `ResponseMap` / `MappedResponseType` since stream/json are separate methods.
- `base.ts` (2) → skipped (no barrel).
- `index.ts` (15) → skipped (no global instance).
- _(new)_ → `hooks.ts` (~65; built-ins ofetch doesn't have).

## 8. Migration plan

Roughly 20 call sites use `this.http.*`. Three distinct patterns:

### Pattern A: `.json<T>()` chain (most call sites)

```ts
// before
return this.http.get('account').json<AccountResponse>()
// after
return this.http.get<AccountResponse>('account')
```

Mechanical rename. ~15 sites.

### Pattern B: Raw Response (OAuth device flow, streaming setup)

```ts
// before (api/oauth-device.ts:79)
const res = await this.http.post('oauth/device/code', {
  json: body,
  throwHttpErrors: false,
  context: { skipClassify: true },
})
// after
const res = await this.http.fetch('oauth/device/code', { method: 'POST', json: body })
```

```ts
// before (api/app-run.ts:49)
const res = await this.http.post(`apps/${id}/run`, {
  json: body,
  headers: { Accept: 'text/event-stream' },
})
// after
const res = await this.http.stream(`apps/${id}/run`, {
  method: 'POST',
  json: body,
  headers: { Accept: 'text/event-stream' },
})
```

### Pattern C: Derived client (MetaClient probe)

```ts
// before (commands/_shared/authed-command.ts:78)
const http = createClient({ host, timeoutMs: META_PROBE_TIMEOUT_MS, retryAttempts: 0 })
// after
const probe = mainHttp.extend({ timeoutMs: META_PROBE_TIMEOUT_MS, retryAttempts: 0 })
```

API class fields change from `KyInstance` to `HttpClient`. No call-site signature changes beyond the rename.

## 9. Testing strategy

`client.test.ts` ports current 13 tests (intent preserved), plus adds:

- `extend()` inherits bearer/UA/logger; per-call override beats client default
- `extend({ logger: undefined })` drops log hooks; subsequent calls produce no log events
- `stream()` ignores `retryAttempts: 3` even when set at client level
- `throwOnError: false` returns 4xx Response without throwing
- User hook in `onRequest` mutates header and is observed by mock fetch
- User hook in `onResponse` throws — error propagates and onResponseError does NOT run (D2)
- `AbortSignal.timeout` fires — transport error path with retry
- User signal abort — no retry, immediate reject

All tests use `vi.stubGlobal('fetch', mockFetch)`. No new test dependencies.

## 10. Out of scope

Each item below has been considered and intentionally excluded. Recording them so future drift is a conscious decision.

- **`bearer` as `() => Promise<string>` callback** — CLI tokens stable per `difyctl login`. Refresh handled by login flow, not transport.
- **Per-call hook overrides (`http.get(p, { hooks: ... })`)** — no current use case. `extend()` covers it at construction time.
- **Plugin/middleware registration (`client.use(plugin)`)** — duplicates hook + extend(). Two APIs for one job.
- **Fluent builder** — duplicates `extend()`.
- **Class inheritance** — function + interface composes better; tree-shakes fine.
- **Runtime schema validation** — deferred; see D7.
- **Cookie jar / credentials handling** — CLI is bearer-only.
- **Response caching** — CLI is mostly write or read-fresh.
- **`host`-style baseURL convenience** — see D9.
- **Per-client retry policy customization** — see D10.
- **`index.ts` barrel** — see §7. Existing import style preserved.

## 11. ofetch comparison

What we adopted verbatim:

- Single `FetchContext` primitive; all extensibility is hooks reading/writing it.
- Sequential `await` hook execution.
- Recursive retry (`dispatch(req, { ..., attempt: attempt+1 })`) instead of mutable loop.
- `AbortSignal.any([user, timeout])` composition.
- `joinURL` and URL builder utilities (direct port).
- `isJSONSerializable` body detection logic.
- `Error.captureStackTrace(err, dispatch)` for clean stack traces.

What we changed:

- Public surface is method-shaped (`http.get<T>(p)`) not function-shaped (`$fetch(p, { method })`). CLI ergonomics outweigh ofetch's "one function does everything" purity.
- `extend()` re-runs the factory (D1) instead of shallow-merging defaults — we need to recompile built-in hooks.
- `FetchContext` has `attempt` and `meta` (ofetch has neither).
- `throwOnError` defaults vary by method (D5) instead of a single `ignoreResponseError` flag.
- We have a `hooks.ts` of built-ins; ofetch has none.
- We do not implement: `responseType` switch, `parseResponse`, `duplex`, `dispatcher`, `agent`, `params` legacy alias.

What we explicitly do not borrow:

- ofetch's `responseType: 'stream'` mechanism — replaced by the `stream()` method.
- ofetch's `FetchResponse<T>._data` — we return `T` directly from typed methods.
- ofetch's `FetchError` class hierarchy — domain errors (`BaseError` + `ErrorCode`) are richer for our purposes.
- ofetch's recursive `onError` that handles both transport and response paths — we have two clearly separated paths in §4 step 5 vs 6.

---

When all decisions in §5 are acknowledged, implementation proceeds file-by-file:

1. `types.ts`
1. `url.ts`
1. `body.ts`
1. `retry.ts`
1. `hooks.ts`
1. `client.ts`
1. `client.test.ts` (port + expand)
1. migrate ~20 call sites (Pattern A/B/C per §8)
1. drop `ky` dep from `cli/package.json`

[ofetch]: https://github.com/unjs/ofetch

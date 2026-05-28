# ARD — Architecture & Design Reference

Onboarding ref for `dify/cli/` contributors. Cover canonical patterns, layer contracts, scaffolding recipe, dev workflow, anti-patterns. Read before adding command or touching shared infra.

Spec authority: [`docs/specs/`]. Specs own HTTP wire shape + server behavior; this file owns CLI code structure.

---

## Project layout

```
src/
  commands/          one folder per command leaf
  api/               HTTP client wrappers (one file per resource)
  auth/              hosts.yml read/write
  cache/             app-info cache
  config/            config.yml read/write
  errors/            BaseError, ErrorCode, exit codes
  http/              ky client factory + middleware
  io/                IOStreams, spinner, printer chain
  limit/             --limit flag parsing
  types/             shared TypeScript types
  util/              small pure helpers
  workspace/         workspace ID resolution
```

---

## New command scaffold

Recipe for adding command leaf. Follow order.

**1. Create folder**

```
src/commands/<topic>/<verb>/
```

Examples: `get/app/`, `auth/devices/revoke/`, `describe/app/`.

**2. Mandatory files**

| File       | Responsibility                                                                          |
| ---------- | --------------------------------------------------------------------------------------- |
| `index.ts` | `DifyCommand` subclass. Flag/arg declaration + `run()` wiring only. No business logic.  |
| `run.ts`   | Pure async function. Typed options + deps. Returns string. No `src/framework/` imports. |

**3. Optional files — add as needed**

| File               | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `handlers.ts`      | Output format handlers (text, table, etc.)          |
| `print-flags.ts`   | `--output` flag → printer resolution                |
| `payload-shape.ts` | Response type narrowing/transformation              |
| `run.test.ts`      | Behavior tests against `run.ts`                     |
| `guide.ts`         | Agent onboarding text — exports `agentGuide` string |

**4. Checklist**

- [ ] `index.ts` extends `DifyCommand`
- [ ] Authed command calls `this.authedCtx()`; non-authed skips
- [ ] No try/catch in `run()` — `DifyCommand.catch()` handles `BaseError`
- [ ] `run.ts` returns string; no direct stdout write
- [ ] `run.ts` no `src/framework/` imports
- [ ] HTTP client via factory dep, not direct
- [ ] `run.test.ts` written before impl (test-first)
- [ ] `pnpm tree:gen` run after adding command (updates `src/commands/tree.ts`)
- [ ] README command table updated by hand

---

## DifyCommand base class

All commands extend `DifyCommand`, not `Command`.

```typescript
export default class MyCommand extends DifyCommand {
  async run(): Promise<void> {
    const { args, flags } = this.parse(MyCommand, argv)

    // Authed: authedCtx() sets outputFormat + builds context
    const ctx = await this.authedCtx({ retryFlag: flags['http-retry'], format: flags.output })

    process.stdout.write(await runMyThing({ /* args */ }, { bundle: ctx.bundle, http: ctx.http, io: ctx.io }))
  }
}
```

**`authedCtx(opts)`** — wraps `buildAuthedContext`. Sets `this.outputFormat` as side effect. Required for any command needing bearer token.

**`catch(err)` override** — auto-handles `BaseError` with format-aware serialization. Never wrap `run()` in try/catch. Throw `BaseError`; base class catches.

---

## Error handling

Throw `BaseError`. Never throw raw `Error` for domain failures.

```typescript
import { BaseError } from '../../errors/base.js'
import { ErrorCode } from '../../errors/codes.js'

throw new BaseError({
  code: ErrorCode.UsageMissingArg,
  message: 'workspace id required',
  hint: 'pass --workspace or run \'difyctl use workspace <id>\'',
})
```

`ErrorCode` exhaustive const object — never use raw strings. `exitFor(code)` maps to exit codes auto. `DifyCommand.catch()` calls `formatErrorForCli` with `outputFormat` so JSON/YAML consumers get machine-readable error output.

| Exit | Meaning                                   |
| ---- | ----------------------------------------- |
| 0    | Success                                   |
| 1    | Generic error                             |
| 2    | Usage error (bad flag, missing arg)       |
| 4    | Auth error (not logged in, token expired) |
| 6    | Version/compat error                      |

New error code: add to `ErrorCode` + map to `ExitCode` in `codes.ts`. Never scatter exit codes inline.

---

## IOStreams

I/O context passed through every layer. Carries stdout, stderr, stdin, TTY flags, `outputFormat`.

```typescript
export type IOStreams = {
  out: NodeJS.WritableStream
  err: NodeJS.WritableStream
  in: NodeJS.ReadableStream
  isOutTTY: boolean
  isErrTTY: boolean
  outputFormat: string // 'json' | 'yaml' | 'name' | 'wide' | ''
}
```

| Factory               | When                              |
| --------------------- | --------------------------------- |
| `realStreams(format)` | Production — wraps `process.std*` |
| `bufferStreams()`     | Tests — captures output in memory |
| `nullStreams()`       | When IO irrelevant                |

`outputFormat` set at construction. Do not mutate. Do not pass `format` as separate arg downstream — put in `IOStreams`, pass struct.

---

## Spinner

`runWithSpinner` wraps async call with animated spinner on stderr. Auto-disables for structured output — no manual `enabled:` flag needed.

```typescript
const result = await runWithSpinner(
  { io, label: 'Fetching apps' },
  () => client.list(params),
)
```

`STRUCTURED_FORMATS = new Set(['json', 'yaml', 'name'])` drives disable check. New structured format = add to this set only — no other callsites change.

Only override `enabled` for intentional suppression (e.g., tests using `bufferStreams` already suppress via `isErrTTY: false`).

---

## Printer chain

Output rendering separated from data fetching.

1. `run.ts` returns string — rendered result.
1. `handlers.ts` defines format handlers (`TextHandler`, `TableHandler`, etc.).
1. `print-flags.ts` maps `--output` value to correct handler.

```typescript
// run.ts
const printer = new AppPrintFlags().toPrinter(format)
return printer.print(data)
```

New output format: implement handler interface, register in `print-flags.ts`. Never add `if (format === 'json')` branches in `run.ts`.

---

## Strategy pattern (mode dispatch)

Singleton strategies + picker function. No switch ladders on discriminator.

```typescript
export type RunStrategy = {
  execute: (ctx: RunContext) => Promise<void>
}

const blocking = new BlockingStrategy()
const streamingText = new StreamingTextStrategy()
const streamingStructured = new StreamingStructuredStrategy()

export function pickStrategy(useStream: boolean, isText: boolean): RunStrategy {
  if (!useStream)
    return blocking
  return isText ? streamingText : streamingStructured
}
```

New mode = new class + one line in picker. Singletons avoid per-call allocation.

---

## HTTP clients

One file per resource under `src/api/`. Each exports class wrapping `KyInstance`.

```typescript
export class AppsClient {
  private readonly http: KyInstance
  constructor(http: KyInstance) { this.http = http }

  async list(params: ListParams): Promise<ListResponse> { /* ... */ throw new Error('elided') }
  async describe(id: string, workspaceId: string, fields: string[]): Promise<DescribeResponse> { /* ... */ throw new Error('elided') }
}
```

Inject via factory dep in `run.ts` for testability:

```typescript
type GetAppDeps = {
  appsFactory?: (http: KyInstance) => AppsClient
}
// default: (h) => new AppsClient(h)
```

Never instantiate clients in `index.ts`.

---

## Testing

**Test-first.** Write failing test, run to confirm fail, then implement.

Tests live in `run.test.ts` alongside command. Test `run.ts` direct — never the `DifyCommand` class.

```typescript
const io = bufferStreams()
const result = await runGetApp(
  { format: 'json', appId: 'app-1' },
  { bundle, http: mockHttp, io, appsFactory: () => fakeClient },
)
expect(JSON.parse(result).data).toHaveLength(1)
```

### dify-mock fixture server

`test/fixtures/dify-mock/server.ts` mirrors `/openapi/v1/*`. Each test starts isolated instance:

```typescript
import { startMock } from '../../../test/fixtures/dify-mock/server.js'

const mock = await startMock({ scenario: 'happy' })
// ... test against mock.url ...
await mock.stop()
```

| Scenario          | Effect                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| `happy` (default) | Standard fixtures: 4 apps across 2 workspaces, 2 workspaces, 1 active session |
| `sso`             | `/workspaces` returns empty (external-SSO bearer model)                       |
| `expired`         | All authenticated routes return 401 `auth_expired`                            |
| `pagination`      | `/apps` honors `?page=` + `?limit=`, total > one page                         |
| `slow`            | Adds `Retry-After: 1` to GETs to test ky retry behavior                       |

New scenario: extend `Scenario` union in `scenarios.ts`, branch in relevant handler. No per-test mocks — one fixture surface keeps tests aligned with real API.

### Assertions

Inline string/regex/JSON checks — no golden files.

```typescript
expect(out).toMatch(/^ID\s+NAME\s+ROLE/)
expect(JSON.parse(out).workspaces).toHaveLength(2)
```

---

## Scripts

| Command                 | When to run                                        |
| ----------------------- | -------------------------------------------------- |
| `pnpm dev <cmd> [args]` | Run CLI from source during dev                     |
| `pnpm test`             | Full vitest suite — run before every commit        |
| `pnpm test:coverage`    | Coverage report                                    |
| `pnpm type-check`       | `tsc --noEmit` — catches type errors without build |
| `pnpm lint`             | ESLint check                                       |
| `pnpm lint:fix`         | ESLint auto-fix (perfectionist sort, chaining)     |
| `pnpm build`            | Production bundle (`vp pack`)                      |
| `pnpm tree:gen`         | Regenerate `src/commands/tree.ts` (registry)       |
| `pnpm tree:check`       | Verify `tree.ts` matches the filesystem            |
| `pnpm build:bin`        | Cross-compile standalone binaries via Bun (CI)     |

**`pnpm tree:gen` rule:** run after adding, removing, renaming any command. The generated `tree.ts` is the runtime command registry — stale tree causes commands to be invisible at runtime. (Runs implicitly via `prebuild`/`predev`/`pretest`.)

**README hand-maintained.** When adding a command, update the command table in `README.md` manually.

---

## Lint rules that catch contributors

Repo runs `@antfu/eslint-config` + perfectionist + unicorn.

| Rule                               | What it catches                                    |
| ---------------------------------- | -------------------------------------------------- |
| `perfectionist/sort-named-imports` | Alphabetical, case-insensitive                     |
| `perfectionist/sort-imports`       | Relative imports last; `import type` first         |
| `antfu/consistent-chaining`        | Long `.foo().bar().baz()` must split across lines  |
| `unicorn/no-new-array`             | Use `Array.from({ length: n })` not `new Array(n)` |
| `noUncheckedIndexedAccess` (tsc)   | `arr[i]` is `T \| undefined`; guard before use     |

`pnpm lint:fix` resolves perfectionist + chaining auto.

---

## PR conventions

- One feature, one PR. Bundle test + impl + doc update.
- Branch off `feat/cli`. Never target `main`.
- Commit style: `<type>(cli): <imperative subject>`. Types: `feat`, `fix`, `refactor`, `docs`, `chore`. Body explains why if non-obvious.
- Plan/spec/superpowers files do not ship in CLI commits.
- Verify diff before committing — `.local.json` and `.vitest-cache/` gitignored but check anyway.

---

## Anti-patterns

| Pattern                                                              | Do instead                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| `if (format === 'json') { ... }` in `run.ts`                         | Printer handler per format                              |
| `try { ... } catch (e) { if (isBaseError(e)) ... }` in every command | Throw `BaseError`; `DifyCommand.catch()` handles        |
| Raw string error codes `'not_logged_in'`                             | `ErrorCode.NotLoggedIn`                                 |
| `enabled: !isHuman` in `runWithSpinner`                              | Set `outputFormat` on `IOStreams`; spinner auto-detects |
| Long positional arg lists                                            | Options struct                                          |
| `Record<string, Strategy>` dispatch map                              | Named singletons + picker function                      |
| `src/framework/` import in `run.ts`                                  | Keep framework imports in `index.ts` only               |
| `buildAuthedContext(this, opts)` in command body                     | `this.authedCtx(opts)`                                  |
| `console.log` in `src/`                                              | Return string from `run.ts`; write in `index.ts`        |
| New dependency without approval                                      | Check first                                             |

[`docs/specs/`]: docs/specs/

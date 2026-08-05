# ARD — Architecture & Design Reference

Onboarding ref for `dify/cli/` contributors. Cover canonical patterns, layer contracts, scaffolding recipe, dev workflow, anti-patterns. Read before adding command or touching shared infra.

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
  sys/io/            IOStreams, prompts, spinner, output rendering
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

**2. Mandatory file**

| File       | Responsibility                                                                       |
| ---------- | ------------------------------------------------------------------------------------ |
| `index.ts` | `DifyCommand` subclass. Owns flag/arg parsing, framework output, and command wiring. |

**3. Optional files — add as needed**

| File               | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `run.ts`           | Typed behavior owner when logic merits independent tests or reuse  |
| `handlers.ts`      | Output types implementing `FormattedPrintable` or `TablePrintable` |
| `payload-shape.ts` | Response type narrowing/transformation                             |
| `run.test.ts`      | Behavior tests against `run.ts`                                    |
| `guide.ts`         | Agent onboarding text — exports `agentGuide` string                |

**4. Checklist**

- [ ] `index.ts` extends `DifyCommand`
- [ ] Authed command calls `this.authedCtx()`; non-authed skips
- [ ] Let the command boundary handle `BaseError`; catch only when the command owns recovery
- [ ] Keep framework parsing and output construction in `index.ts`
- [ ] When present, `run.ts` returns typed behavior data or owns explicit streaming/interactive I/O and does not import `src/framework/`
- [ ] HTTP client via factory dep, not direct
- [ ] Add focused behavior tests when the command changes an observable contract
- [ ] `pnpm tree:gen` run after adding command (updates `src/commands/tree.generated.ts`)
- [ ] README command table updated by hand

---

## DifyCommand base class

All commands extend `DifyCommand`, not `Command`.

```typescript
export default class MyCommand extends DifyCommand {
  async run(argv: string[]) {
    const { args, flags } = this.parse(MyCommand, argv)

    const ctx = await this.authedCtx({ retryFlag: undefined, format: flags.output })
    const result = await runMyThing(
      { id: args.id },
      { active: ctx.active, http: ctx.http, io: ctx.io },
    )
    return formatted({ format: flags.output, data: result.data })
  }
}
```

**`authedCtx(opts)`** — wraps `buildAuthedContext` and returns the authenticated registry, account, HTTP, I/O, and optional cache dependencies. Pass the selected output format so authentication failures use the same serialization contract. Required for commands that need a bearer token.

The framework runner in `src/framework/run.ts` catches command errors, normalizes unknown failures, and serializes `BaseError` according to the selected output format. Catch inside a command only when that command owns a real recovery path.

---

## Error handling

Throw `BaseError`. Never throw raw `Error` for domain failures.

```typescript
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

throw new BaseError({
  code: ErrorCode.UsageMissingArg,
  message: 'workspace id required',
  hint: "pass --workspace or run 'difyctl use workspace <id>'",
})
```

`ErrorCode` is the exhaustive error-code object; do not scatter raw code strings. `exitFor(code)` maps it to a process exit code, and the framework runner calls `formatErrorForCli` so JSON/YAML consumers receive machine-readable errors.

| Exit | Meaning                                   |
| ---- | ----------------------------------------- |
| 0    | Success                                   |
| 1    | Generic error                             |
| 2    | Usage error (bad flag, missing arg)       |
| 4    | Auth error (not logged in, token expired) |
| 6    | Version/compat error                      |
| 7    | Rate limited                              |

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
const result = await runWithSpinner({ io, label: 'Fetching apps' }, () => client.list(params))
```

`STRUCTURED_FORMATS = new Set(['json', 'yaml', 'name'])` drives disable check. New structured format = add to this set only — no other callsites change.

Only override `enabled` for intentional suppression (e.g., tests using `bufferStreams` already suppress via `isErrTTY: false`).

---

## Output protocol

Output rendering separated from data fetching via protocol objects.

- Data classes implement `TablePrintable` or `FormattedPrintable` from `src/framework/output`.
- Streaming commands implement `StreamPrinter` from `src/framework/stream`.
- `index.ts` wraps the result with `table({format, data})` or `formatted({format, data})` and returns it; `src/framework/run.ts` calls `stringifyOutput()`.
- Commands that write incrementally (streaming) write directly from the strategy via `deps.io.out.write(stringifyOutput(...))`.

```typescript
// handlers.ts — implement the protocol on the data object
export class MyListOutput implements TablePrintable {
  tableColumns() {
    return COLUMNS
  }
  tableRows() {
    return this.rows.map((r) => r.tableRow())
  }
  json() {
    return { items: this.rows.map((r) => r.json()) }
  }
}

// index.ts — wrap and return
return table({ format: flags.output, data: result })
```

New output format: add to `OutputFormat` in `framework/output.ts` and handle in `stringifyOutput`. Never add `if (format === 'json')` branches in `run.ts` or handlers.

---

## Strategy pattern (mode dispatch)

Singleton strategies + picker function. No switch ladders on discriminator.

```typescript
export type RunStrategy = {
  execute: (ctx: RunContext) => Promise<void>
}

const streamingText = new StreamingTextStrategy()
const streamingStructured = new StreamingStructuredStrategy()

export function pickStrategy(isText: boolean, livePrint: boolean): RunStrategy {
  return isText && livePrint ? streamingText : streamingStructured
}
```

New mode = new class + one line in picker. Singletons avoid per-call allocation.

---

## HTTP clients

Keep resource clients under `src/api/`. They receive the shared `HttpClient` and call generated oRPC operations through `createOpenApiClient(...)` when the OpenAPI contract covers the endpoint. Reuse generated request and response types instead of duplicating wire shapes.

Pass `HttpClient` into behavior owners. Add a client or factory dependency only when it owns a real substitution or lifecycle boundary; behavior tests normally exercise the real client stack against `test/fixtures/dify-mock/`. Keep client construction out of `index.ts` so the command remains a framework and output boundary.

---

## Testing

Keep tests beside the owner as `*.test.ts`. When a command has a behavior module, test that public function directly for domain and protocol behavior. Test the command class or framework boundary when argument parsing, flags, help, output construction, or command wiring is the observable contract. Establish a failing case first when practical for behavior changes and bug fixes.

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

| Command                 | When to run                                    |
| ----------------------- | ---------------------------------------------- |
| `pnpm dev <cmd> [args]` | Run CLI from source during dev                 |
| `pnpm test`             | Full vitest suite — run before every commit    |
| `pnpm test:coverage`    | Coverage report                                |
| `vp check cli`          | Scoped static check from the repository root   |
| `vp check --fix cli`    | Scoped static fixes from the repository root   |
| `pnpm build`            | Production bundle (`vp pack`)                  |
| `pnpm tree:gen`         | Regenerate `src/commands/tree.generated.ts`    |
| `pnpm tree:check`       | Verify the generated tree matches the commands |
| `pnpm build:bin`        | Cross-compile standalone binaries via Bun (CI) |

**`pnpm tree:gen` rule:** run after adding, removing, or renaming any command. The generated `tree.generated.ts` is the runtime command registry; a stale tree makes commands invisible at runtime. It also runs through `prebuild`, `predev`, and `pretest`.

**README hand-maintained.** When adding a command, update the command table in `README.md` manually.

---

## Lint rules that catch contributors

The repository runs Vite+ Oxlint as the primary code-quality linter, an explicit ESLint config for unsupported cases, and Vite+ Oxfmt for formatting. The fallback config does not depend on the Antfu ESLint config.

| Rule                               | What it catches                                    |
| ---------------------------------- | -------------------------------------------------- |
| `perfectionist/sort-named-imports` | Alphabetical, case-insensitive                     |
| `perfectionist/sort-imports`       | Relative imports last; `import type` first         |
| `antfu/consistent-chaining`        | Long `.foo().bar().baz()` must split across lines  |
| `unicorn/no-new-array`             | Use `Array.from({ length: n })` not `new Array(n)` |
| `noUncheckedIndexedAccess` (tsc)   | `arr[i]` is `T \| undefined`; guard before use     |

Run `vp check --fix cli` from the repository root for scoped formatting, lint, and TypeScript fixes and diagnostics.

---

## PR conventions

- One feature, one PR. Bundle test + impl + doc update.
- Branch off `feat/cli`. Never target `main`.
- Commit style: `<type>(cli): <imperative subject>`. Types: `feat`, `fix`, `refactor`, `docs`, `chore`. Body explains why if non-obvious.
- Plan/spec/superpowers files do not ship in CLI commits.
- Verify diff before committing — `.local.json` and `.vitest-cache/` gitignored but check anyway.

---

## Anti-patterns

| Pattern                                                              | Do instead                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `if (format === 'json') { ... }` in `run.ts`                         | Printer handler per format                                                 |
| `try { ... } catch (e) { if (isBaseError(e)) ... }` in every command | Throw `BaseError`; `src/framework/run.ts` normalizes and formats it        |
| Raw string error codes `'not_logged_in'`                             | `ErrorCode.NotLoggedIn`                                                    |
| `enabled: !isHuman` in `runWithSpinner`                              | Set `outputFormat` on `IOStreams`; spinner auto-detects                    |
| Long positional arg lists                                            | Options struct                                                             |
| `Record<string, Strategy>` dispatch map                              | Named singletons + picker function                                         |
| `src/framework/` import in `run.ts`, `api/`, or `auth/`              | Framework imports belong in `index.ts`, `handlers.ts`, and strategies only |
| `buildAuthedContext(this, opts)` in command body                     | `this.authedCtx(opts)`                                                     |
| `console.log` in `src/`                                              | Return `CommandOutput` from the command or use owned I/O for streaming     |
| New dependency without approval                                      | Check first                                                                |

# ARD — Architecture & Design Reference

Onboarding ref for `dify/cli/` contributors. Cover canonical patterns, layer contracts, scaffolding recipe, dev workflow, anti-patterns. Read before adding command or touching shared infra.

---

## Layout

```
src/
  kernel/       plugin + Context primitives — no CLI knowledge
  plugins/      argv global-flags env config session token catalog http ops io commands — the 11 services, one folder each; index.ts is the plugin and the only file anything outside the folder imports
    argv/       the invocation's tokens as a context input, plus the argv parser (parse.ts, framework shared by global-flags and commands)
    global-flags/ flags any command accepts (`--verbose`), parsed off argv before the command is resolved
    catalog/    the cached catalog document: types, parseCatalog, op lookup
    http/       the authenticated fetch wrapper with the catalog fingerprint header and 412 refetch
    ops/        the catalog as the CLI shows it: resolve an op (refetch once on unknown), list rows, describe one op with its pins
    commands/   command pipeline plus the command framework (command.ts, cancel.ts, registry.ts) every command imports
  protocol/     pure catalog-shape logic: kinds, bind, pins, fold — no I/O
  call/         the `call` flag table; JSON and SSE response decoding; builds a request from a resolved op + validated input; renders the response by kind
  commands/     one folder per command leaf; index.ts is the only file the registry discovers
  net/          fetch init and proxy dispatcher, shared by the http plugin and the pre-login device flow
  store/        config/session/token file and keychain persistence
  skills/       SKILL.md template + install
```

---

## Kernel

A plugin is `{ name, needs, build(ctx) }`. `needs` is a list of the other plugin objects it reads through `ctx.get(...)` — an array of the actual plugin values, not strings or classes, so a plugin literally names its dependencies and TypeScript checks `build`'s `ctx` against that list (`src/kernel/plugin.ts`).

`Context` (`src/kernel/context.ts`) builds services lazily: `ctx.get(plugin)` runs `plugin.build(ctx)` the first time that plugin is requested, caches the result, and returns the cached service on every later call in the same invocation. A plugin never builds if nothing asks for it. `needs` is only the compile-time allow-list for that plugin's `ctx.get`; the kernel never walks it, so declaring `needs: BASE_PLUGINS` on the `commands` plugin costs nothing until a command actually calls `ctx.get` on one of them (`version` logged out builds six plugins, never `http`).

State stays with its owner. A plugin's `build()` closes over its own state (an in-memory cache, a loaded config document); nothing outside reaches into it — code that needs it calls `ctx.get(thatPlugin)` again and gets the same cached instance.

`ctx.defer(fn)` queues a cleanup to run after the command finishes (for example, aborting a streaming call's `AbortController` on `SIGINT`), instead of scattering `try`/`finally` through command bodies.

There is no event bus and no listener registration. Plugins that need to react to something call `ctx.get` on the plugin that has it; there is no subscribe/publish path to keep in sync.

The one `commands` plugin (`src/plugins/commands/index.ts`) needs `BASE_PLUGINS` (`global-flags env config session token catalog http ops io`) and its `build()` returns `{ run }`. `runPipeline` takes the argv left over by `global-flags`, resolves the typed `Command` from the generated tree, parses those tokens against that command's Zod `input` schema, and calls `run(input, ctx)` — the pipeline never branches on which command it is.

A plugin's folder is private. Code outside it imports only the plugin's `index.ts` (`@/plugins/<name>`) and reaches the plugin's behaviour through `ctx.get(plugin)`; a helper two plugins share is exposed on a service, and a helper only commands use lives outside `src/plugins/`. The two exceptions are contracts rather than services: the command framework in `plugins/commands/` (`Command`, `Outcome`, `runSignal`, the tree types) and the argv parser in `plugins/argv/parse.ts`.

Global flags are one Zod object in `src/plugins/global-flags/index.ts`. The plugin pulls the flags it knows out of the `argv` input, exposes their values as `flags` and the remaining tokens as `rest`; any plugin or command reads a global flag through `ctx.get(globalFlags)`, never by scanning argv. Which flag wins over an env var or a config key is decided in the plugin that owns the setting, not here.

Help is the row: `commandRow(Ctor, path)` (`src/plugins/commands/describe.ts`) is the one function that renders a command's `--help` output and its entry in the root command list — there is no separate help-text template.

Tests substitute one plugin's service directly: `new Context([[plugin, mockService]])` seeds the cache so `ctx.get(plugin)` returns the mock without building the real one.

---

## New command scaffold

1. Create the folder: `src/commands/<topic>/<verb>/` (or `src/commands/<verb>/` for a top-level command like `login`).
2. Write `index.ts`: a default-exported class extending `Command<typeof INPUT>` with static `summary`, `effect` (`'read' | 'write' | 'destructive'`, default `'read'`), `input` (a Zod object), optional `positional` and `examples`, and an instance `run(input, ctx)` that returns the value to print — or an `Outcome` when the command needs a non-zero exit or has already written its own output.
3. Run `pnpm tree:gen` to add the command to `src/commands/tree.generated.ts`.
4. Run `pnpm tree:check` (also gated in CI) to confirm the generated tree matches the command folders.

---

## Error handling

Throw `BaseError`. Never throw raw `Error` for domain failures.

```typescript
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'

throw new BaseError({
  code: ErrorCode.UsageMissingArg,
  message: 'workspace id required',
  hint: "pass --workspace or run 'difyctl workspace use <id>'",
})
```

`ErrorCode` is the exhaustive error-code object; do not scatter raw code strings. `exitFor(code)` maps it to a process exit code, and `BaseError.toEnvelope()` serializes it as the one JSON error line on stderr.

| Exit | Meaning                                          |
| ---- | ------------------------------------------------ |
| 0    | Success                                          |
| 1    | Generic error                                    |
| 2    | Usage error (bad flag, missing or invalid input) |
| 4    | Auth error (not logged in, forbidden)            |
| 6    | Catalog error (unavailable, or unknown op id)    |
| 7    | Rate limited                                     |

New error code: add to `ErrorCode` and map it to an `ExitCode` in `codes.ts`. Never scatter exit codes inline.

---

## Output

Everything the CLI prints goes through the `io` plugin's service, never through a stream directly. Four writes cover every case; a new output format or a `--quiet` flag is a change inside this one plugin.

```typescript
export type IOService = Readonly<{
  line: (value: Printable) => Promise<void> // one JSON line on stdout: results, streamed events
  document: (value: Printable) => Promise<void> // pretty JSON on stdout: help
  notice: (text: string) => void // one text line on stderr: warnings, progress
  raw: (chunk: string | Buffer) => Promise<void> // bytes as given: a text-kind body
  streams: IOStreams // stdin and the TTY flags
}>
```

`Printable` (a JSON primitive, an array, or a plain object) is what a command may return and what `line` accepts. stdout writes use the callback form so a closed pipe reaches `printEnvelope` as a rejection and the run ends at exit 0. `printEnvelope` itself writes the error envelope to the raw stderr stream, since it runs in `main` after the context may have failed to build.

`IOStreams` is the raw layer underneath: `realStreams()` wraps `process.std*` in production, `bufferStreams()` captures output in tests, and `ioService(streams)` wraps either.

---

## Testing

Keep tests beside the owner as `*.test.ts`. When a command delegates to a pure module (`call/`, `protocol/`), test that module directly. Test the command class or the `commands` pipeline when argument parsing, help, or command wiring is the observable contract. Establish a failing case first when practical for behavior changes and bug fixes.

### dify-mock fixture server

`test/fixtures/dify-mock/server.ts` mirrors `/openapi/v1/*` and the catalog endpoint. Each test starts an isolated instance:

```typescript
import { startMock } from '../../../test/fixtures/dify-mock/server.js'

const mock = await startMock({ scenario: 'happy' })
// ... test against mock.url ...
await mock.stop()
```

`happy` (default) is the standard fixture set: 4 apps across 2 workspaces, 2 workspaces, 1 active session. See `Scenario` in `scenarios.ts` for the full union — auth failures, rate limiting, catalog-fingerprint mismatches, HITL pauses, pending imports, and more.

New scenario: extend the `Scenario` union in `scenarios.ts`, branch in the relevant handler. No per-test mocks — one fixture surface keeps tests aligned with the real API.

### Assertions

Inline string/regex/JSON checks — no golden files.

```typescript
expect(JSON.parse(out).ops).toHaveLength(2)
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
| `pnpm build:bin:local`  | Same, pinned to the `dev` channel              |

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
- Commit style: `<type>(cli): <imperative subject>`. Types: `feat`, `fix`, `refactor`, `docs`, `chore`. Body explains why if non-obvious.
- Plan/spec/superpowers files do not ship in CLI commits.
- Verify diff before committing — `.local.json` and `.vitest-cache/` gitignored but check anyway.

---

## Anti-patterns

| Pattern                                                     | Do instead                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Raw string error codes `'not_logged_in'`                    | `ErrorCode.NotLoggedIn`                                                |
| Long positional arg lists                                   | A Zod `input` object with named fields                                 |
| `if (kind === 'sse') { ... } else if (kind === 'list') ...` | A `Record<Kind, Renderer>` dispatch table (see `call/render/index.ts`) |
| A command reaching into another plugin's closed-over state  | `ctx.get(thatPlugin)` — the cached service, not its internals          |
| `console.log` in `src/`                                     | Return the value from `run()`; the pipeline prints it                  |
| New dependency without approval                             | Check first                                                            |

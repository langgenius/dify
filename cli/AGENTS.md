# AGENTS.md — difyctl (TypeScript CLI)

TypeScript port of difyctl. Stack: custom CLI framework (`src/framework/`), Node 22+, ESM, ky for HTTP, Vitest, and Vite+ formatting and linting.

> Architecture patterns, scaffolding recipe, printer chain, strategy pattern, testing conventions, anti-patterns: see **[`ARD.md`]**.

## Code rules

- **Spaces, not tabs.**
- **Minimum comments.** Code speak for self. Comment only non-obvious WHY — hidden constraints, subtle invariants, bug-workaround notes. Never restate code. Never reference tasks, PRs, current callers.
- **No magic strings or numbers.** Enums or named constants for bounded value sets.
- **No long positional arg lists.** Use options objects.
- **No long if/switch ladders on discriminator.** Polymorphism, dispatch tables, or strategy pattern. Name concept, let implementations plug in.
- **No `any`. No `unknown` outside genuine wire boundaries** (HTTP body parse, env vars). Narrow types everywhere else.
- **Avoid `!` non-null assertions.** Narrow instead.
- **`readonly` on inputs not mutated.**
- **Discriminated unions** for variant data (SSE events, run outputs, error shapes), not optional-field bags.
- **No backwards-compat shims.** No re-exports of old names, no `// removed:` markers, no deprecation notes. Delete, update callers.
- **No new dependencies without explicit approval.**
- **No CLI behavior changes in refactor commit.** Same flags, same output, same exit codes.
- **Every leaf command extends `DifyCommand`.** Add `static agentGuide` string when command benefits from agent workflow docs — see `src/commands/AGENTS.md`.

## Layering

| Layer     | Path                             | Role                                                                                                                                  |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| commands  | `src/commands/`                  | Command class shells (extend `DifyCommand`). Only place framework imports run.                                                        |
| domain    | `src/run/`, `src/get/`, etc.     | Plain TS modules. Take typed deps via options. Testable without the framework.                                                        |
| api       | `src/api/`                       | One typed client per resource. Each takes `KyInstance`.                                                                               |
| http      | `src/http/`                      | `createClient` + middleware (auth, retry, logging, error mapping). Only place ky runs.                                                |
| io        | `src/io/`                        | Streams + spinner. Fence between data-out and progress UI.                                                                            |
| printers  | `src/printers/`                  | `CompositePrintFlags` + `-o {json,yaml,name,wide,text}` matrix.                                                                       |
| errors    | `src/errors/`                    | `BaseError`, `ErrorCode` enum, `ExitCode` enum, dispatch table, `formatErrorForCli`.                                                  |
| guide     | `src/commands/**/<cmd>/guide.ts` | Per-command agent guide string. Export `agentGuide`, assign `static agentGuide = agentGuide` in command class. Surfaced via `--help`. |
| cache     | `src/cache/`                     | On-disk caches (app-info, etc.).                                                                                                      |
| auth      | `src/auth/`                      | Hosts file, token store, login flow.                                                                                                  |
| config    | `src/config/`                    | XDG dir resolution, config.yml load/save.                                                                                             |
| workspace | `src/workspace/`                 | Resolver: flag → env → bundle.                                                                                                        |
| types     | `src/types/`                     | Pure data + zod schemas for server contracts. No runtime imports outward.                                                             |

## Command Structure

Scaffold recipe + checklist: see `ARD.md §New command scaffold`. Full folder convention (subcommands, guide.ts): see `src/commands/AGENTS.md`.

Layer rules:

- Commands thin shells. Use `this.authedCtx(opts)` for bearer context; delegate to domain function.
- Domain receives deps via options; never imports `src/framework/`.
- Only `src/http/client.ts` and `src/api/*` import ky at runtime; elsewhere use `import type { KyInstance }`.
- `process.*` lives in `src/io/`, `src/store/dir.ts`, `src/util/browser.ts`. Nowhere else.
- No circular imports. `types/` pure leaf.

## Dev commands

```sh
pnpm install                                   # one-time
pnpm dev <command> [args...]                   # run CLI from source (no -- separator)
pnpm test                                      # vitest
pnpm test:coverage                             # with coverage
pnpm -w type-check                             # repository-wide type check
pnpm -w lint                                   # repository-wide lint
pnpm -w lint:fix                               # repository-wide lint fixes
vp fmt                                         # format with Oxfmt
pnpm build                                     # production bundle (vp pack)
pnpm tree:gen                                  # regenerate src/commands/tree.ts (registry)
pnpm tree:check                                # verify tree.ts is up-to-date with the fs
```

Release binaries (5 platform targets, Bun-compiled) are produced by `pnpm build:bin` (called from `.github/workflows/cli-release.yml`).

## Tests

- Behavior tests run against real Hono mock at `test/fixtures/dify-mock/`. No `nock`, `msw`, or `fetchMock` — every test exercises real HTTP.
- Test files co-located: `foo.test.ts` next to `foo.ts`.
- Repository-wide type-check and lint, plus the full test suite, must be green before any commit.

## Spec docs (`docs/specs/`)

Behavior contracts. Living tree — amended in place, no version subfolders.

**Keep:** HTTP wire shape (req/resp JSON, headers, status codes), SQL DDL, Redis keys + TTL, state transitions, audit event names + payload, error/exit codes, rate-limit values, JWS/cookie envelope claims.

**Cut:** language type decls, internal helper sigs, decorator snippets, file-path tables, pseudocode mirroring code, "Open items"/"Handler walk"/"CI guard"/"Migration" sections, rationale (`Rejected:`/`Why X not Y`/`Historical note:`/product comparisons), release-pipeline lines, version-pinning (`in v1.0`, `post-v1.0`, milestone codes), frontmatter `date`/`status`/`author`.

**Test:** "rewrite in Rust tomorrow, does spec hold?" HTTP/SQL/Redis stays; type defs go.

**Rules:** behavior, not rationale. One topic per file; cross-refs = `auth.md §Storage`. Tables beat prose. Code wins on drift — update spec.

## Out of scope for unrelated work

Do not modify in passing:

- `test/fixtures/dify-mock/` public surface (endpoints, JSON shapes, status codes, scenario names) — that's the dify-api contract.
- `bin/`, `scripts/`, `Makefile`, `lint.config.ts`, `tsconfig*.json`, `package.json` (unless the change is required by the task).

## Commits

- One concern per commit. Style: `<type>(<scope>): <imperative subject>` lowercase. Body explains why if non-obvious.
- Never push, amend, force-push, or skip hooks (`--no-verify`) without explicit user approval.

[`ARD.md`]: ARD.md

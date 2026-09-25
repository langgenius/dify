# AGENTS.md — difyctl (TypeScript CLI)

This package is the Node 24+, ESM TypeScript implementation of `difyctl`. Development also requires the Bun version pinned in `.bun-version`; command-tree generation and the `dev`, `test`, and `build` pre-scripts invoke it. Read [`ARD.md`] before adding a command or changing shared CLI infrastructure. Read `src/commands/AGENTS.md` for command-folder and registry rules.

## Architecture Boundaries

- Every command extends `Command` (`src/plugins/commands/command.ts`) and declares no `needs` of its own; it reads whatever plugin services it uses directly through `ctx.get(...)` inside `run(input, ctx)`.
- Plugins under `src/plugins/` (`argv global-flags env config session token catalog http ops io commands`) own state. A plugin's `build()` closes over its own cache or loaded document; nothing outside a plugin reaches into another plugin's internals. Outside a plugin folder, import only `@/plugins/<name>` and use the service from `ctx.get(...)`; the command framework (`plugins/commands/command.ts`, `cancel.ts`, `registry.ts`) and the argv parser (`plugins/argv/parse.ts`) are the only modules imported directly.
- `src/protocol/` and `src/call/` are pure modules: catalog-shape logic (kinds, bind, pins, fold) and the `call` flag table, request-building and rendering, with no op-specific branching anywhere under `src/call/` — kind and bind dispatch go through the tables in `src/protocol/` and `src/call/render/`, keyed by the catalog's own `kind`/`bind` values, never by operation id.
- Preserve exit codes and the JSON output contract during refactors. Do not add dependencies or compatibility shims unless the task explicitly requires them.
- `ARD.md` owns CLI code structure. Keep behavior aligned with the real mock-server (`test/fixtures/dify-mock/`) behavior tests.

## Commands

Run package scripts from `cli/`:

- Source CLI: `pnpm dev <command> [args...]`
- Tests: `pnpm test`
- Build: `pnpm build`
- Build a local binary: `pnpm build:bin:local` (pins `DIFYCTL_CHANNEL=dev` so it does not self-report the release channel)
- Regenerate and verify the registry: `pnpm tree:gen` and `pnpm tree:check`

Run the scoped static check from the repository root with `vp check cli`.

Behavior tests use the real Hono server under `test/fixtures/dify-mock/`; do not replace it with `nock`, `msw`, or `fetchMock`. Keep tests colocated with their source files.

[`ARD.md`]: ARD.md

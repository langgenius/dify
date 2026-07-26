# AGENTS.md — difyctl (TypeScript CLI)

This package is the Node 22+, ESM TypeScript implementation of `difyctl`. Read [`ARD.md`] before adding a command or changing shared CLI infrastructure. Read `src/commands/AGENTS.md` for command-folder and registry rules.

## Architecture Boundaries

- Every leaf command extends `DifyCommand`; command classes own framework parsing and delegate behavior to domain modules.
- Each command folder keeps its framework shell in `index.ts` and its behavior in sibling modules such as `run.ts` and `handlers.ts`. Behavior modules receive typed dependencies and do not import `src/framework/`.
- `src/http/` owns ky middleware and client construction; `src/api/` owns resource clients; `src/sys/io/` owns process streams and progress UI; `src/types/` remains a pure data and schema leaf.
- Preserve flags, output, and exit codes during refactors. Do not add dependencies or compatibility shims unless the task explicitly requires them.
- `ARD.md` owns CLI code structure. Keep wire behavior aligned with typed API clients and the real mock-server behavior tests.

## Commands

Run from `cli/`:

- Source CLI: `pnpm dev <command> [args...]`
- Tests: `pnpm test`
- Static checks: `pnpm -w check`
- Build: `pnpm build`
- Regenerate and verify the registry: `pnpm tree:gen` and `pnpm tree:check`

Behavior tests use the real Hono server under `test/fixtures/dify-mock/`; do not replace it with `nock`, `msw`, or `fetchMock`. Keep tests colocated with their source files.

[`ARD.md`]: ARD.md

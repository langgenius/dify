# AGENTS.md — `src/commands/`

Per-command agent-optimized usage and structure guide.

## Command folder convention

Every command is a folder. `index.ts` is the command class file. All related
code — business logic, helpers, tests, and optional agent guide — colocates inside
the folder. Subcommands are subfolders.

```
src/commands/
  <topic>/
    <verb>/
      index.ts        ← command class (extends DifyCommand; the ONLY file the registry discovers)
      run.ts          ← business logic (not a command, invisible to the registry)
      handlers.ts     ← helpers
      guide.ts        ← agent guide string (optional)
      *.test.ts       ← tests
    <nested-verb>/    ← subcommand (e.g. auth/devices/list/)
      index.ts
    _shared/          ← intra-topic shared code (only when needed by 2+ siblings)
      <shared>.ts
```

The registry generator (`pnpm tree:gen` → `src/commands/tree.ts`) discovers
commands only via `**/index.+(js|cjs|mjs|ts)`. All other files in command
folders are invisible to the registry — add freely without glob exclusions.
Folders prefixed with `_` (e.g. `_shared/`, `_strategies/`) are excluded from
registry discovery and from coverage checks.

## Adding a new command

1. Create `src/commands/<topic>/<verb>/index.ts` extending `DifyCommand`.
1. Add business logic in sibling files (e.g. `run.ts`, `handlers.ts`).
1. Run `pnpm tree:gen` to regenerate the command tree (also runs implicitly via `prebuild`/`predev`/`pretest`).
1. Run `pnpm test` to verify coverage.

## Adding an agent guide

<!-- prettier-ignore -->
1. Create `src/commands/<topic>/<verb>/guide.ts` exporting a plain string:
   ```ts
   export const agentGuide = `
   WORKFLOW
     1. ...

   ERROR RECOVERY
     ...
   `
   ```
1. Import and assign in `index.ts`:
   ```ts
   import { agentGuide } from './guide.js'

   export default class MyCmd extends DifyCommand {
     static agentGuide = agentGuide
   }
   ```
1. The guide appears at the bottom of `difyctl <cmd> --help` automatically.
1. Agents call `difyctl <cmd> --help` to read both structural help and workflow guidance.

## Shared utilities

Code used by two or more commands lives in `src/<domain>/` (e.g. `src/auth/`,
`src/api/`, `src/errors/`). Do not put broadly shared code inside a command folder.
Intra-topic shared code (used only within one topic's commands) uses `_shared/`
within that topic folder.

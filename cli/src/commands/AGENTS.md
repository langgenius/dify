# AGENTS.md — `src/commands/`

Per-command agent-optimized usage and structure guide.

## Command folder convention

Every command is a folder. `index.ts` is the command class file. All related
code — business logic, helpers, tests — colocates inside the folder.
Subcommands are subfolders.

```
src/commands/
  <topic>/
    <verb>/
      index.ts        ← command class (extends Command; the ONLY file the registry discovers)
      helpers.ts      ← optional behavior owner (not a command, invisible to the registry)
      *.test.ts       ← tests
    <nested-verb>/    ← subcommand (e.g. ops/describe/)
      index.ts
    _shared/          ← intra-topic shared code (only when needed by 2+ siblings)
      <shared>.ts
```

The registry generator (`pnpm tree:gen` → `src/commands/tree.generated.ts`) discovers
commands only via `**/index.+(js|cjs|mjs|ts)`. All other files in command
folders are invisible to the registry — add freely without glob exclusions.
Folders prefixed with `_` are excluded from registry discovery.

The command class extends `Command<typeof INPUT>` (`src/plugins/commands/command.ts`):

```ts
export default class MyCmd extends Command<typeof INPUT> {
  static override summary = 'One-line description'
  static override effect = 'write' as const // 'read' (default) | 'write' | 'destructive'
  static override input = INPUT // a Zod object; also the argv parser's schema
  static override positional = ['id'] as const // optional; maps positional argv to input keys
  static override examples = [{ title: '...', input: { id: '...' } }] // optional

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    // read plugin services with ctx.get(...); the return value is printed as
    // one JSON line. Return an Outcome for a non-zero exit or output already
    // written through ctx.get(io); notices go to ctx.get(io).notice(...).
  }
}
```

`run`'s return value is the JSON value printed to stdout; there is no separate
output-formatting step and no `agentGuide` — `--help` on any command prints
the same descriptor (`summary`, `effect`, `input`, `positional`, `examples`)
that `ops describe` prints for a catalog operation.

## Adding a new command

1. Create `src/commands/<topic>/<verb>/index.ts` extending `Command`.
1. Keep small owner-local behavior in `index.ts`; extract a sibling module when logic needs independent tests, reuse, or a clearer owner.
1. Run `pnpm tree:gen` to regenerate the command tree (also runs implicitly via `prebuild`/`predev`/`pretest`).
1. Run `pnpm test` to verify coverage.

## Shared utilities

Code used by two or more commands lives in a top-level domain folder (e.g.
`src/call/`, `src/errors/`) or on a plugin service, never inside a
command folder. One command never imports from another command's folder.

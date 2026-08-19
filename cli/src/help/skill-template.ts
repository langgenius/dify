export const SKILL_TEMPLATE = `---
name: difyctl
description: Drive the difyctl CLI to manage Dify apps, workspaces, members and runs. Use when the task involves difyctl or operating a Dify instance from the command line.
---

# difyctl

difyctl is self-describing — do not guess commands.

## Discover the command surface
1. Find candidates:
   \`difyctl search "<intent>" -o json\`
   Treat hits as candidates only — do not execute from this output.
2. Inspect the chosen command:
   \`difyctl help <path> -o json\`
   Expand a multi-token path as separate shell arguments; never quote the
   entire returned path.
   That JSON is the source of truth for args, flags, examples, \`effect\`,
   and \`agentGuide\`.

When the task depends on global exit codes, error envelopes, HITL, or retry
semantics, read \`difyctl help agent\`.

Only when search returns no viable candidate, fall back to
\`difyctl help -o json\`. Do not run the full sitemap after useful search results.

## The one non-obvious thing: HITL pauses are not failures
A run can pause for human input. It exits with **code 0** and emits a
\`paused\` JSON payload — this is success-with-pending, NOT a crash.
Resume as the payload instructs (see \`difyctl resume app --help\`).

## Before any write/destructive action
Never execute a write/destructive candidate from search output. Treat the
inspected command's \`effect\` as the confirmation gate before running it.

---
difyctl skill v{{VERSION}} — if \`difyctl version\` differs, re-run
\`difyctl skills install\` to refresh.
`

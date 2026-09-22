export const SKILL_TEMPLATE = `---
name: difyctl
description: Drive the difyctl CLI to manage Dify apps, workspaces, members and runs. Use when the task involves difyctl or operating a Dify instance from the command line.
---

# difyctl

difyctl is self-describing — do not guess commands.

## Discover the command surface
1. Read the complete compact sitemap:
   \`difyctl help -o json --compact\`
   Each entry contains only \`command\`, \`description\`, and \`effect\`.
2. Decide whether the request maps to one command, needs clarification, or is
   unsupported.
3. When one command is selected, inspect it:
   \`difyctl help <path> -o json\`
   Expand a multi-token path as separate shell arguments; never quote the
   entire returned path.
   That JSON is the source of truth for args, flags, examples, \`effect\`,
   and \`agentGuide\`. Never skip it — the sitemap carries no args or flags,
   so any flag you name without this step is a guess.

When the task depends on global exit codes, error envelopes, HITL, or retry
semantics, read \`difyctl help agent\`.

Do not read the full command tree. Report unsupported only after checking the
compact sitemap. Clarify only when more than one command could satisfy the
request.

## The one non-obvious thing: HITL pauses are not failures
A run can pause for human input. It exits with **code 0** and emits a
\`paused\` JSON payload — this is success-with-pending, NOT a crash.
Resume as the payload instructs (see \`difyctl resume app --help\`).

## Before any write/destructive action
Treat the inspected command's \`effect\` as the confirmation gate before
running it. Never execute a write/destructive command without confirmation.

---
difyctl skill v{{VERSION}} — if \`difyctl version\` differs, re-run
\`difyctl skills install\` to refresh.
`

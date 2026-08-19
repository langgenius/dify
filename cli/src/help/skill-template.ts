// The difyctl agent skill, in full — one hand-authored, pure-delegation file.
//
// It inlines NO command list, NO flag list, and ships no reference files. The
// command surface is discovered at runtime via `difyctl help -o json`, so this
// template has nothing to derive from the binary and nothing that can drift
// from it. `{{VERSION}}` is the only substitution; it is filled at emit time by
// renderSkill() in ./skill.
//
// RED LINE: keep this pure delegation. The moment a command or flag listing is
// added here, the embedded static copy can fall out of sync with the command
// surface — at which point it must instead be generated from the command model
// with a snapshot test (see SKILL-SPEC.md §10, decision D2).
export const SKILL_TEMPLATE = `---
name: difyctl
description: Drive the difyctl CLI to manage Dify apps, workspaces, members and runs. Use when the task involves difyctl or operating a Dify instance from the command line.
---

# difyctl

difyctl is self-describing — do not guess commands.

## Discover the command surface
Run \`difyctl help -o json\` for the version-current map: every command
(args, flags, examples, \`effect\`) plus the global \`contract\` (exit codes,
output formats, error envelope, HITL protocol). Treat that JSON as the
source of truth; this file only bootstraps you into it.

## The one non-obvious thing: HITL pauses are not failures
A run can pause for human input. It exits with **code 0** and emits a
\`paused\` JSON payload — this is success-with-pending, NOT a crash.
Resume as the payload instructs (see \`difyctl resume app --help\`).

## Before any write/destructive action
Check the command's \`effect\` (\`read\` / \`write\` / \`destructive\`) in
\`difyctl help -o json\` before running it.

---
difyctl skill v{{VERSION}} — if \`difyctl version\` differs, re-run
\`difyctl skills install\` to refresh.
`

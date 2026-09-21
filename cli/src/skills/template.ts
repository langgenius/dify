export const SKILL_TEMPLATE = `---
name: difyctl
description: Run Dify apps and manage a workspace through the difyctl CLI. Use when the task involves difyctl or a Dify server from the command line.
---

# difyctl

difyctl talks to a Dify server. Business commands are not built in: the server publishes a catalog of operations and you discover them at run time. Every command prints JSON. Help is JSON too.

## The three steps

1. \`difyctl ops\` lists every operation id with a one-line summary, kind and tags.
2. \`difyctl ops describe <op-id>\` prints the operation: \`input\` (a JSON Schema), \`bind\`, \`kind\`, \`examples\`, and \`pins\` (values difyctl fills in for you, currently \`workspace_id\`). \`difyctl call <op-id> --help\` prints the same thing.
3. \`difyctl call <op-id> --input '<json>'\` runs it. Output is one JSON object on stdout.

Run an app with the op for its mode: \`console_app.workflow.run\`, \`console_app.chat.run\`, \`console_app.advanced_chat.run\`, \`console_app.completion.run\`. First \`call console_app.describe --input '{"app_id":"..."}'\` and read \`input_schema\`; that is the shape of \`inputs\`.

## --input

\`--input '{"a":1}'\` inline, \`--input @file.json\` from a file, \`--input @-\` from stdin. Local files go under \`files\`, keyed by the app's file variable name: \`{"files":{"doc":"./r.pdf"}}\` or a list of paths. Files for the run itself go under \`attachments\`. URLs go straight into \`inputs\`.

## Options (difyctl-only flags)

\`--stream\` prints every event of a streaming op as one JSON line instead of folding them into one result. \`--only <event>\` filters streamed events (repeatable). \`--output <path>\` saves a file-kind response. \`--verbose\` includes the raw server response in errors. An option the operation's kind does not support exits 2.

## Reading results

Streaming ops fold to \`{status, text, outputs?, message_id?, conversation_id?, error?, hints}\`. \`status\` is \`ended\`, \`failed\` (exit 1), \`suspended\` (a human-input form is waiting; follow \`hints\`), or \`incomplete\` (the stream broke early). Any response may carry \`hints: [{summary, op, input, form?}]\`, next steps the server filled in: the next page of a list, the confirm step of a pending import, the reply op of a chat, the submit of a paused form. Fill any \`null\` in \`input\`, then pass it back as \`call <op> --input <input>\`.

## Errors and exit codes

Errors are one JSON line on stderr: \`{"error":{"code","message","hint"?,"details"?,"schema"?}}\`. Exit 2 is bad input (the schema is included), 4 is not logged in or forbidden, 6 means the catalog could not be loaded or the op id is unknown (run \`difyctl cache refresh\` or upgrade difyctl), 7 is rate limited (wait the seconds in \`hint\`).

## Login and environment

\`difyctl login --server https://...\` (device flow; \`--no-browser\` prints the URL and code; \`--insecure\` skips TLS verification). One login at a time; logging in again logs the previous one out. \`difyctl workspace list\` and \`difyctl workspace use <id>\` set the local pin. Scripts skip login with \`DIFY_SERVER\` and \`DIFY_TOKEN\`; \`DIFY_WORKSPACE_ID\` overrides the pin. \`DIFY_CONFIG_DIR\` and \`DIFY_CACHE_DIR\` move the files.

## Destructive operations

Operations that remove or revoke (member removal, session revoke) have no confirmation prompt. Confirm with the person before calling them.

difyctl {{VERSION}}
`

export function renderSkill(opts: { readonly version: string }): string {
  return SKILL_TEMPLATE.replaceAll('{{VERSION}}', opts.version)
}

---
name: difyctl
description: 'Operate a Dify server through difyctl: find and run any operation, and build, test, publish and change Workflow and Chatflow apps. Use when the task involves difyctl, a Dify server, or Dify apps.'
---

# difyctl

difyctl talks to a Dify server. Business commands are not built in: the server publishes a catalog of operations, and each one is a command you discover at run time.

Always pass `--json`. Help and errors are text on a terminal and JSON in a pipe; `--json` (or `DIFY_OUTPUT=json`) forces JSON. Results and streams are always JSON.

## Finding what the CLI can do

An operation id is dotted, `run.console_app.chat`, and is typed as words: `difyctl run console_app chat`. Ids come from the server and can change, so look them up instead of assuming them.

Four views under `help`, covering local commands and server operations as one tree:

1. `difyctl help --json`: the map. Start here.
2. `difyctl help <namespace> --json`: everything under one namespace (`difyctl help get`). The bare namespace, `difyctl get --json`, prints the same.
3. `difyctl help <words> --json`: search by plain words (`difyctl help upload file`), top 20 entries plus `total`. Widen the words when nothing fits.
4. `difyctl help <id> --json`: one descriptor, dotted or spaced id. For an operation: `input` (JSON Schema), `bind`, `kind`, `examples` and `pins` (values difyctl fills in, currently `workspace_id`). `<command> --help` prints the same.

`--all` adds operations the server marks internal. `--full` on the bare `help` prints every descriptor; rarely needed.

Not logged in, or the server unreachable, gives the local commands plus one line on stderr.

Operations that remove or revoke have no confirmation prompt. Confirm with the person first.

## Where to read next

- Read [`references/setup.md`](references/setup.md) to check login or log in, switching server or workspace, or running in a sandbox or CI.
- Read [`references/operations.md`](references/operations.md) before running any operation: flags, inputs, files, results, hints, errors and exit codes.
- Read [`references/build-workflow.md`](references/build-workflow.md) when asked to create, change, test or publish a Workflow or Chatflow app.
- Read [`references/plugins.md`](references/plugins.md) to find tools, models and knowledge bases before building, when a plugin, model, tool or credential is missing, or when the user asks to install or remove a plugin. Prefer an existing tool over an HTTP Request or Code node; the human picks.

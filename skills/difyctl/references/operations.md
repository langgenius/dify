# Running operations

`difyctl run console_app workflow --app-id <id> --inputs '{"a":1}'`. Each top-level field of `input` is a flag, dashes for underscores. Scalars take a value; objects, maps and lists of objects take a JSON literal or `@file.json`; lists of scalars repeat the flag. Fields named `input`, `stream`, `only`, `output`, `verbose`, `json` or `help` have no flag; pass them through `--input`.

`--input '{"a":1}'`, `--input @file.json` or `--input @-` (stdin) sends the whole body; field flags merge over it. A dotted id is a command with the dots as spaces: `run.console_app.workflow` is `difyctl run console_app workflow`.

Run an app with the op for its mode: `run console_app workflow`, `run console_app chat`, `run console_app advanced_chat`, `run console_app completion`. First `difyctl describe console_app --app-id <id> --json` and read `input_schema`; that is the shape of `inputs`. Local files go under `files`, keyed by the app's file variable name (`{"files":{"doc":"./r.pdf"}}` or a list of paths); files for the run itself under `attachments`; URLs straight into `inputs`.

## difyctl-only flags

`--stream` prints each event of a streaming op as one JSON line instead of folding them. `--only <event>` filters streamed events (repeatable). `--output <path>` saves a file-kind response; the default is the current directory under the server's filename, or `<op-id>.<ext>`. The default never replaces an existing file: it exits 2, and you pass `--output` to choose the path (an `--output` path is replaced). `--verbose` adds the raw server response to errors. A flag the operation's kind does not support exits 2.

## Reading results

Streaming ops fold to `{status, text, outputs?, total_tokens?, message_id?, conversation_id?, run_id?, error?, hints}`. `text.answer` is the reply; `text.by_source` appears only while `status` is `incomplete`. `status` is `ended`, `failed` (exit 1), `suspended` (a form is waiting; follow `hints`) or `incomplete` (stream broke early; exit 0, so check `status`). Any response may carry `hints: [{summary, op, input, form?}]`, the server's next steps: next page, confirm step, reply op, form submit. Fill any `null` in `input` and pass it back with `difyctl <op, dots as spaces> --input '<input>'`.

After `submit.run.form`, run its `get.run.event` hint to follow the run; repeat if it suspends again.

## Errors and exit codes

Stderr envelope: `{"error":{"code","message","hint"?,"details"?,"schema"?,"http_status"?,"server"?}}`. `code` is difyctl's (`server_error` for server rejections); the server's code is `error.server.code` (e.g. `dsl_invalid`). `details`: `[{loc,msg}]`.

Exit: 2 bad input caught locally (incl. near-miss command); 1 server rejection or other failure; 4 not logged in (incl. unknown word while logged out), 401, 403; 6 catalog unavailable or `unknown_op`; 7 rate limited.

PowerShell: use `--input @file.json`, and `$env:VAR='v'; difyctl ...`.

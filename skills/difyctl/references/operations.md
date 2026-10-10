# Running operations

`difyctl run console_app workflow --app-id <id> --inputs '{"a":1}'`. Each top-level field of `input` is a flag, dashes for underscores. Scalars take a value; objects, maps and lists of objects take a JSON literal or `@file.json`; lists of scalars repeat the flag. Fields named `input`, `stream`, `only`, `output`, `verbose`, `json` or `help` have no flag; pass them through `--input`.

`--input '{"a":1}'`, `--input @file.json` or `--input @-` (stdin) sends the whole body; field flags merge over it. A dotted id is a command with the dots as spaces: `run.console_app.workflow` is `difyctl run console_app workflow`.

Run an app with the op for its mode: `run console_app workflow`, `run console_app chat`, `run console_app advanced_chat`, `run console_app completion`. First `difyctl describe console_app --app-id <id> --json` and read `input_schema`; that is the shape of `inputs`. Local files go under `files`, keyed by the app's file variable name (`{"files":{"doc":"./r.pdf"}}` or a list of paths); files for the run itself under `attachments`; URLs straight into `inputs`.

## difyctl-only flags

`--stream` prints each event of a streaming op as one JSON line instead of folding them. `--only <event>` filters streamed events (repeatable). `--output <path>` saves a file-kind response; the default is the current directory under the server's filename, or `<op-id>.<ext>`. `--verbose` adds the raw server response to errors. A flag the operation's kind does not support exits 2.

## Reading results

Streaming ops fold to `{status, text, outputs?, total_tokens?, message_id?, conversation_id?, error?, hints}`. `text.answer` is the reply; `text.by_source` appears only while `status` is `incomplete`. `status` is `ended`, `failed` (exit 1), `suspended` (a form is waiting; follow `hints`) or `incomplete` (the stream broke early). Any response may carry `hints: [{summary, op, input, form?}]`, the server's next steps: next page, confirm step, reply op, form submit. Fill any `null` in `input` and pass it back with `difyctl <op, dots as spaces> --input '<input>'`.

## Errors and exit codes

Errors are one envelope on stderr: `{"error":{"code","message","hint"?,"details"?,"schema"?}}`. Exit 2 is bad input (schema included), 4 not logged in or forbidden, 6 catalog unavailable or unknown op (run `difyctl refresh cache` or upgrade difyctl), 7 rate limited.

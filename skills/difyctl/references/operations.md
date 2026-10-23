# Running operations

`difyctl run console_app workflow --app-id <id> --inputs '{"a":1}'`. Each top-level field of `input` is a flag, dashes for underscores. Scalars take a value; objects, maps and lists of objects take a JSON literal or `@file.json`; lists of scalars repeat the flag. Fields named `input`, `stream`, `only`, `output`, `verbose`, `json` or `help` have no flag; pass them through `--input`.

`--input '{"a":1}'`, `--input @file.json` or `--input @-` (stdin) sends the whole body; field flags merge over it. A dotted id is a command with the dots as spaces: `run.console_app.workflow` is `difyctl run console_app workflow`.

The command word is the app's `mode` with `-` as `_`: `mode: advanced-chat` runs as `run console_app advanced_chat`. Run an app with the op for its mode: `run console_app workflow`, `run console_app chat`, `run console_app advanced_chat`, `run console_app completion`. First `difyctl describe console_app --app-id <id> --json` and read `input_schema`; that is the shape of `inputs`. Local files go under `files`, keyed by the app's file variable name (`{"files":{"doc":"./r.pdf"}}` or a list of paths); files for the run itself under `attachments`; URLs straight into `inputs`.

## difyctl-only flags

`--stream` prints each event of a streaming op as one JSON line instead of folding them. `--only <event>` filters streamed events (repeatable). `--output <path>` saves a file-kind response; the default is the current directory under the server's filename, or `<op-id>.<ext>`. The default never replaces an existing file: it exits 2, and you pass `--output` to choose the path (an `--output` path is replaced). `--verbose` adds the raw server response to errors. A flag the operation's kind does not support exits 2.

## Reading results

Streaming ops fold to `{status, text, outputs?, total_tokens?, message_id?, conversation_id?, run_id?, error?, hints}`. `text.answer` is the reply; `text.by_source` appears only while `status` is `incomplete`. `status` is `ended`, `failed` (exit 1), `suspended` (a form is waiting; follow `hints`) or `incomplete` (stream broke early; exit 0, so check `status`). Any response may carry `hints: [{summary, op, input, form?}]`, the server's next steps: next page, confirm step, reply op, form submit. Errors can carry them too, at `error.server.hints`. Fill any `null` in `input` and pass it back with `difyctl <op, dots as spaces> --input '<input>'`.

After `submit.run.form`, run its `get.run.event` hint to follow the run; repeat if it suspends again.

## Errors and exit codes

Stderr envelope: `{"error":{"code","message","hint"?,"details"?,"schema"?,"http_status"?,"server"?}}`. `code` is difyctl's: `auth_expired` (401), `access_denied` (403), `rate_limited` (429), `server_error` for any other server rejection. The server's code is `error.server.code` (e.g. `dsl_invalid`). `details`: `[{loc,msg}]`. A 429 may carry `retry_after`, in seconds.

Exit: 2 bad input caught locally (incl. near-miss command); 1 server rejection or other failure; 4 not logged in (incl. unknown word while logged out), 401, 403 (a domain `error.server.code` such as `webapp_public_access_disabled`, `service_api_disabled` or `plugin_install_forbidden` is not a login problem: read the code and its hint); 6 catalog unavailable or `unknown_op`; 7 rate limited.

When a command fails:

- Exit 7: wait `error.retry_after` seconds (5 if absent), then retry once. Exit 7 again: stop and tell the human.
- `network_connection` that says "timed out": the server is slow. Run the `hint` (`difyctl set config http.timeout <ms>`). Then retry once if the command only reads. If it changes state (create, import, publish), it may have worked on the server: check the current state first, then decide. Never make a second copy.
- Exit 6 `catalog_unavailable` with "HTTP 404": either OpenAPI is off on that server, or the saved server URL is wrong. Tell the human to ask the admin to set `OPENAPI_ENABLED=true`, or to check the URL. Don't retry.
- A 403 whose hint does not tell you to sign in: stop and tell the human the message and the hint. Logging in again does not help.
- A 503 whose hint names an admin: stop and tell the human.
- A 403 whose hint says to sign in with an account (`unsupported_token_type`): log in as that account.

PowerShell: use `--input @file.json`, and `$env:VAR='v'; difyctl ...`.

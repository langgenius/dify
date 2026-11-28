# Dify through MCP tools

Read this when the tools `dify_find`, `dify_read`, `dify_write` and `dify_destructive` are available.

The server sent its usage rules when the tools connected, in its instructions and in each tool's description. Follow them. They match the server's version, so this page does not repeat them.

## What this page adds

- **Login.** The host holds the token. You cannot log in, log out or switch server. When the server refuses the login, the host reports the Dify connection as unauthorized instead of returning a tool result. Ask the human to reconnect Dify in the host with a new token.
- **Reach.** An operation that `dify_find` does not list is not available to this login. A personal token acts as its owner, within the workspaces and apps chosen for it. Find apps with `get.console_app`: it needs no workspace and lists every app the login may use. The workspace list shows the login's workspaces and may be empty; app operations still work. Workspace access is needed for plugins, model providers and tool credentials. A workspace token can list and run apps, and cannot answer a human-input pause.
- **Hints.** A hint this login cannot call is removed from the result. When a paused run has no form hint, call `wait.job` once more. If it is still paused with no form hint, this login cannot answer the form: tell the human what the note says.
- **Errors.** `forbidden` (its message may say `personal_access_token_not_supported`): this login may not do that; tell the human and do not retry. `private_app_access_denied`: the app's web access is private and leaves this login out. The hint names the operation that changes it: ask the human whether to let this login in, then call it. A draft test needs no web access. `too_many_requests`: wait the seconds in the "Retry after" line, or a minute when there is none. `job_not_found`: the job expired (after a day by default), or belongs to another login; run again. `job_capacity_reached`: the server is busy; wait for a running job to finish. A result above the server's limit (40,000 characters by default) comes back cut, followed by a note. The operation ran: do not call it again to get the rest, which a repeat will not return. Narrow the request with `limit`, a filter, or a more specific operation.
- **Runs.** Run or test an app with the operation `dify_find` shows for it. It answers a job, which may come back before the run ends. Keep calling `wait.job` until the status is `succeeded`, `failed` or `stopped`, or `paused` (see Hints). Leave `wait_seconds` at its default of 25: a longer wait can outlast the host's timeout. Do not call the run again: that runs the app twice. A run with the same `idempotency_key` returns the same job, also when it failed (for example as interrupted or not confirmed): to run again, use a new key.
- **Files.** Local files go beside the call. Call `prepare.upload`, run the returned command for your shell, then put the returned id in the operation's file field; for an app's file variable that is `"files": {"<variable name>": "<id>"}` on the run or test operation. For a folder, pass `"folder": true`: the command zips the folder's contents and sends the zip. A file result comes back as `{"file": {"id", "download_url"}}`: pass the id to another operation, or save it at once with `curl -fsSL -o <name> "<download_url>"`. Keep the id, not the link; the link lasts minutes. A URL in `inputs` still works.

## Build

The build pages write difyctl commands. Over these tools, each command is one operation:

- A command's words are the operation's id and its flags are the input: `difyctl get console_app version --app-id <app_id>` is operation `get.console_app.version` with input `{"app_id": "<app_id>"}`. Call it with the tool `dify_find` names for it.
- Pass `workspace_id` wherever an operation takes it. difyctl fills it in for you; these tools do not.
- A local path becomes an upload id: send the file with `prepare.upload` first (see Files). An app's file variable goes under `files`, not `inputs`.
- Runs and tests have the same names on both sides: `difyctl test console_app workflow` is `test.console_app.workflow`. Each answers a job (see Runs).

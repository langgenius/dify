# Dify through MCP tools

Read this when the tools `dify_find`, `dify_read`, `dify_write` and `dify_destructive` are available.

The server sent its usage rules when the tools connected, in its instructions and in each tool's description. Follow them. They match the server's version, so this page does not repeat them.

## What this page adds

- **Login.** The host holds the token. You cannot log in, log out or switch server. When the server refuses the login, the host reports the Dify connection as unauthorized instead of returning a tool result. Ask the human to reconnect Dify in the host with a new token.
- **Reach.** An operation that `dify_find` does not list is not available to this login. A personal token acts as its owner, within the workspaces and apps chosen for it. Find apps with `get.console_app`: it needs no workspace and lists every app the login may use. The workspace list shows the workspaces the login can manage and may be empty; app operations still work. Workspace access is needed for plugins, model providers and tool credentials. A workspace token can list and run apps, and cannot answer a human-input pause.
- **Hints.** A hint this login cannot call is removed from the result. When a paused run has no form hint, call `wait.job` once more. If it is still paused with no form hint, this login cannot answer the form: ask the human.
- **Errors.** `forbidden` (its message may say `personal_access_token_not_supported`): this login may not do that; tell the human and do not retry. `too_many_requests`: wait the seconds in the "Retry after" line, or a minute when there is none. `job_not_found`: the job expired after a day, or belongs to another login; start again. `job_capacity_reached`: the server is busy; wait for a running job to finish. A result above 40,000 characters comes back cut, followed by a note. The operation ran: do not call it again to get the rest, which a repeat will not return. Narrow the request with `limit`, a filter, or a more specific operation.
- **Runs.** A start call may answer before the run ends. Keep calling `wait.job` until the status is `succeeded`, `failed` or `stopped`, or `paused` (see Hints). Leave `wait_seconds` at its default of 25: a longer wait can outlast the host's timeout. Do not start the run again: that runs the app twice. A start with the same `idempotency_key` returns the same job, also when it failed (for example as interrupted or not confirmed): to run again, use a new key.
- **Files.** Give a file to an app as a URL in `inputs`. Local files are not supported over these tools yet.

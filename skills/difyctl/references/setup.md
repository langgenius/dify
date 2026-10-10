# Login and environment

## Log in

`login` uses the device flow: it prints a URL and a code, the user approves in a browser, and difyctl stores a token. One login at a time. A new login replaces the old one, and it replaces the code the user is looking at.

**Check first.** Run `difyctl login --resume`. If it prints an `email`, you are logged in: skip login. If it fails with `not_logged_in`, log in.

**Server.** Always pass `--server <url>`. Without it, difyctl logs in to Dify Cloud. If the user has not named a server, ask which one before you log in. Never guess one.

Log in only this way:

1. `difyctl login --server <url> --no-browser --no-wait`. It saves a pending login and prints `verification_uri`, `user_code` and `expires_in` (seconds), then exits.
2. Give the user the URL and the code. Ask them to reply when they have approved. Then end your turn. Do not poll, do not sleep, and do not start a background job.
3. When the user replies, run `difyctl login --resume` once. If it prints the account `email`, you are logged in. If it prints `status: pending`, tell the user it is not approved yet and end your turn again.
4. If the code expires or the user denies it, `--resume` fails. Start again from step 1.

Never run `login` without `--no-wait`. It blocks until the user approves.

A script that already has a token skips login: set `DIFY_SERVER` and `DIFY_TOKEN`.

`--no-browser` prints the URL instead of opening one; always pass it as an agent. `--insecure` skips TLS verification and allows `http://` (local dev only).

## Sandboxes and machines without a keyring

The token goes to the OS keyring by default. On Linux without a DBus session, difyctl uses a file instead, because the keyring there is lost when the session ends. In a sandbox, a container or a headless VM, the keyring can still be lost between sessions. There:

- Add `--no-keyring` to `login`, so the token goes to a file. Pass it on the `--no-wait` call; `--resume` remembers it.
- Leave `DIFY_CONFIG_DIR` unset unless the default folder (`~/.config/difyctl`) is lost between sessions. If you set it, put it on every command (`DIFY_CONFIG_DIR=<dir> difyctl ...`): an `export` does not carry over when each command runs in a new shell. The pending login from `--no-wait` lives there too, so `--resume` needs the same value. A `not_logged_in` error names the folder it checked.

## Workspace

`difyctl get workspace` lists your workspaces. `difyctl use workspace <id>` pins one; later commands fill `workspace_id` from it. `DIFY_WORKSPACE_ID` overrides the pin for one call.

## Files

`DIFY_CONFIG_DIR` moves the login and token files; `DIFY_CACHE_DIR` moves the catalog cache.

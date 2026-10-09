# Login and environment

## Log in

`login` uses the device flow: it prints a URL and a code, the user approves in a browser, and difyctl stores a token. One login at a time. A new login replaces the old one, and it replaces the code the user is looking at.

**Check first.** Run `difyctl login --resume`. If it prints an `email`, you are logged in: skip login. If it fails with `not_logged_in`, log in. Run this check again any time you lose track, for example after you stopped waiting or a background job died. The login may already be done.

Pick the way that fits how you run commands:

1. **You can keep a background job alive** (most agent shells). Run `difyctl login --server <url> --no-browser` as a background job. Relay the `open <url>` and `code <code>` lines from its stderr to the user. Do not kill the job; it exits when the user approves, and its exit code reports the result.
2. **Each command must finish before the next one, or background jobs die between calls.** Start without waiting, then finish later:
   1. `difyctl login --server <url> --no-browser --no-wait`. It saves a pending login and prints `verification_uri`, `user_code` and `expires_in` (seconds), then exits.
   2. Give the user the URL and the code, and ask them to tell you when they have approved.
   3. `difyctl login --resume`. It checks once. While it prints `status: pending`, wait a few seconds and run it again. When it prints the account `email`, you are logged in.
   4. If the code expires or the user denies it, `--resume` fails. Start again from step 1.
3. **A script with a token already.** Skip login: set `DIFY_SERVER` and `DIFY_TOKEN`.

**Waiting.** The user may take several minutes. Keep waiting until `expires_in` runs out (usually 15 minutes). Stop early only if the user says they declined.

`--no-browser` prints the URL instead of opening one; always pass it as an agent. `--insecure` skips TLS verification and allows `http://` (local dev only).

## Sandboxes and machines without a keyring

The token goes to the OS keyring by default. In a sandbox, a container or a headless VM, the keyring is often missing or lost between sessions. There:

- Add `--no-keyring` to `login`, so the token goes to a file. With `--no-wait`, pass it on the first call; `--resume` remembers it.
- Set `DIFY_CONFIG_DIR` to storage that survives the session, and set it the same way on every call. The pending login from `--no-wait` lives there too, so `--resume` needs the same value.

## Workspace

`difyctl get workspace` lists your workspaces. `difyctl use workspace <id>` pins one; later commands fill `workspace_id` from it. `DIFY_WORKSPACE_ID` overrides the pin for one call.

## Files

`DIFY_CONFIG_DIR` moves the login and token files; `DIFY_CACHE_DIR` moves the catalog cache.

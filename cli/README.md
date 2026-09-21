# difyctl

CLI client for the [Dify] platform. Browser device-flow sign-in, then a server-published catalog of operations you discover and call at run time. Every command prints JSON.

## Install (edge, internal)

Per-commit `edge` builds are published to Cloudflare R2. The installer script lives in this repo; binaries are fetched from R2 via `DIFYCTL_R2_BASE` (shared internally):

```sh
curl -fsSL https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-r2.sh | DIFYCTL_R2_BASE=<BASE> sh
```

| Env                     | Default            | Purpose                                                             |
| ----------------------- | ------------------ | ------------------------------------------------------------------- |
| `DIFYCTL_R2_BASE`       | — (required)       | R2 public base, e.g. `https://pub-….r2.dev`.                        |
| `DIFYCTL_CHANNEL`       | `edge`             | Channel to install.                                                 |
| `DIFYCTL_INSTALL_DIR`   | `$HOME/.local/bin` | Directory the binary is written to (`<dir>/difyctl`).               |
| `DIFYCTL_VERSION`       | latest             | Pin an exact published version.                                     |
| `DIFYCTL_COMMIT`        | latest             | Pin by git commit (short or full sha).                              |
| `DIFYCTL_R2_PREFIX`     | `difyctl`          | R2 key root for the pointer JSONs (`manifest.json` / `index.json`). |
| `DIFYCTL_R2_BIN_PREFIX` | `difyctl/bin`      | R2 key root for binaries (the lifecycle/TTL target).                |

By default the channel pointer (latest build) is installed. Set `DIFYCTL_COMMIT` (e.g. `ce4af86`) or `DIFYCTL_VERSION` to install a specific past build — both resolve through the channel's `index.json`:

```sh
curl -fsSL https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-r2.sh | DIFYCTL_R2_BASE=<BASE> DIFYCTL_COMMIT=ce4af86 sh
```

Windows: `$env:DIFYCTL_R2_BASE='<BASE>'; irm https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-r2.ps1 | iex` (same env vars, e.g. `$env:DIFYCTL_COMMIT='ce4af86'`).

Re-run to upgrade. For tagged `rc`/`stable` builds, use the GitHub installer (`install-cli.sh` / `install.ps1`), which resolves releases via the GitHub API. That API caps unauthenticated requests at 60/hour per IP; behind a shared NAT or in CI, set `GITHUB_TOKEN` (or `GH_TOKEN`) to raise it to 5000/hour — the installer sends it as a bearer token.

## Quickstart

```sh
difyctl login --server https://dify.example.com                     # opens browser; paste the device code shown
difyctl workspace list                                               # workspaces visible to this account
difyctl ops                                                          # every operation the server exposes
difyctl ops describe console_app.list                                # one operation's input schema and usage
difyctl call console_app.list --input '{"limit":5}'                  # run it
difyctl call console_app.workflow.run --input @run.json --stream     # stream a workflow run
```

difyctl has no built-in business commands: `ops` and `call` are the whole surface for talking to a server. See [Agent skill] for the full discovery flow.

## Commands

| Command                    | Purpose                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `login`                    | Log in via the OAuth device flow                                               |
| `logout`                   | Log out of the current session                                                 |
| `version`                  | Print the client and (if logged in) server versions                            |
| `workspace list`           | List workspaces visible to the account                                         |
| `workspace use <id>`       | Pin the local session to a workspace                                           |
| `config get [key]`         | Print the local config, or one key                                             |
| `config set <key> <value>` | Set a local config value                                                       |
| `config unset <key>`       | Remove a local config value, restoring its default                             |
| `cache refresh`            | Refetch the server catalog and replace the local cache                         |
| `cache clear`              | Delete the local server catalog cache                                          |
| `skills install [dir]`     | Install the agent skill into detected agent directories                        |
| `ops`                      | List every operation the server publishes                                      |
| `ops describe <op-id>`     | Show one operation's input schema, kind, and pins                              |
| `call <op-id>`             | Call any catalog operation by id (`--input`, `--stream`, `--only`, `--output`) |

`--verbose` is global: it may appear on any command, and it keeps the raw server
response in the error envelope instead of dropping it.

Run `difyctl <cmd> --help` for a command's JSON descriptor, or `difyctl call <op-id> --help` (same as `ops describe <op-id>`) for an operation's. Run `difyctl --help` with no other arguments for the full command list, plus — once logged in — the operation list.

## Agent skill

`difyctl skills install` installs a single `SKILL.md` into your local agents so they auto-load it. The skill teaches the discovery flow — `ops` to list operations, `ops describe <op-id>` to inspect one, `call <op-id> --input '<json>'` to run it — so it stays correct as the server's catalog grows; it does not enumerate operations itself. It is embedded in the binary (version-stamped) rather than checked in.

- `difyctl skills install` — dry-run: detect installed agents (Claude Code, Codex, opencode, Cursor, pi) and print where the skill would land. Writes nothing.
- `difyctl skills install --yes` — write to every detected agent, printing each path. `--agent claude-code[,cursor]` restricts to a subset; `<dir>` forces one explicit directory (handy when your agent isn't detected).
- `difyctl skills install --stdout` — print the `SKILL.md` to stdout (for piping or self-install); writes nothing.

Detection is by config-directory existence (`~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.cursor`, `~/.pi`). If a copy ever looks stale, run `difyctl version` and re-run `difyctl skills install`.

## Configuration

| OS      | Config path                                  |
| ------- | -------------------------------------------- |
| Linux   | `${XDG_CONFIG_HOME:-$HOME/.config}/difyctl/` |
| macOS   | `$HOME/.config/difyctl/`                     |
| Windows | `%APPDATA%\difyctl\`                         |

`config get [key]` prints the whole local config or one key; `config set <key> <value>` and `config unset <key>` change it. The only config key today is `http.timeout` (request timeout in milliseconds).

Tokens use the OS keychain by default, falling back to a sealed file on hosts without one. Config and cache files are written `0600`, their directory `0700`.

| Env var             | Effect                                                      |
| ------------------- | ----------------------------------------------------------- |
| `DIFY_SERVER`       | Server base URL; with `DIFY_TOKEN`, skips interactive login |
| `DIFY_TOKEN`        | Bearer token; requires `DIFY_SERVER`                        |
| `DIFY_WORKSPACE_ID` | Overrides the locally pinned workspace                      |
| `DIFY_CONFIG_DIR`   | Overrides the config directory                              |
| `DIFY_CACHE_DIR`    | Overrides the catalog cache directory                       |

## Streaming

Pass `--stream` on `call` to print every event of a streaming operation as one JSON line, instead of folding the whole run into a single result object:

```sh
difyctl call console_app.chat.run --input '{"app_id":"…","query":"hello","inputs":{}}' --stream
```

`--only <event>` filters the streamed events to the named event types; repeat it to keep more than one. Without `--stream`, a streaming operation's events fold into `{status, text, outputs?, message_id?, conversation_id?, error?, hints}`.

## Exit codes

| Code | Meaning                                      |
| ---- | -------------------------------------------- |
| 0    | Success                                      |
| 1    | Error                                        |
| 2    | Usage or input error                         |
| 4    | Not logged in, or forbidden                  |
| 6    | Catalog unavailable, or unknown operation id |
| 7    | Rate limited                                 |

## Contributing

See [`ARD.md`] for architecture patterns, scaffolding recipe, dev workflow.

## License

Apache-2.0.

[Agent skill]: #agent-skill
[Dify]: https://dify.ai
[`ARD.md`]: ARD.md

# difyctl

CLI client for the [Dify] platform. Browser device-flow sign-in, then a server-published catalog of operations you discover and call at run time, each one a command. Results are JSON; help and errors are text on a terminal, JSON in a pipe.

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
difyctl login --server https://dify.example.com   # opens the browser; approve the device code shown
difyctl help                                      # the map: every command and operation namespace
difyctl help chatbot                              # search commands and operations by plain words
difyctl workspace list                            # workspaces visible to this account
difyctl console_app list --limit 5                # list apps
difyctl console_app workflow run --app-id <id> --inputs @vars.json --stream
```

difyctl has no built-in business commands. Every operation the server publishes is a command: `console_app.workflow.run` is `difyctl console_app workflow run`, and its input fields are flags (`--app-id`, `--inputs`). A field named like one of difyctl's own flags (`input`, `stream`, `only`, `output`, `verbose`, `json`, `help`) is passed through `--input`. `difyctl call <id> --input '<json>'` runs an operation by its dotted id. The table lists the local commands; `difyctl help` lists the server's too. See [Agent skill] for the discovery flow.

## Commands

| Command                    | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `login`                    | Log in via the OAuth device flow                                |
| `logout`                   | Log out of the current session                                  |
| `version`                  | Print the client and (if logged in) server versions             |
| `workspace use <id>`       | Pin the local session to a workspace                            |
| `config get [key]`         | Print the local config, or one key                              |
| `config set <key> <value>` | Set a local config value                                        |
| `config unset <key>`       | Remove a local config value, restoring its default              |
| `cache refresh`            | Refetch the server catalog and replace the local cache          |
| `cache clear`              | Delete the local server catalog cache                           |
| `skills list`              | List the skills in the collection                               |
| `skills install <dir>`     | Write skills from the collection into a skills root (`--skill`) |

`login` blocks until the browser approval arrives. An agent runs it in the background, relays the `open <url>` and `code <code>` lines from its stderr to the user, and does not cancel the job. In a sandbox it adds `--no-keyring` and sets `DIFY_CONFIG_DIR` to persistent storage on every call, so the login survives the next session.

`--verbose` is global: it may appear on any command, and it keeps the raw server
response in the error envelope instead of dropping it.

`difyctl help` covers local commands and server operations as one tree. Bare, it prints the map. `difyctl help <namespace>` lists one namespace (the bare namespace, `difyctl console_app`, does the same), `difyctl help <words>` searches by plain words, and `difyctl help <id>` prints one descriptor, the same as `<command> --help`; the id may be dotted or spaced. `--all` adds hidden entries, `--full` on the bare `help` prints every descriptor. Help and errors are text on a terminal and JSON in a pipe; `--json` or `DIFY_OUTPUT=json` forces JSON. Results and streams are always JSON.

## Agent skills

difyctl ships a collection of agent skills from [`skills/`] at the repo root. The basic skill, `difyctl`, teaches the discovery flow — `help` to see the map or search, `help <id>` to inspect one operation, then the operation's own command to run it — so it stays correct as the server's catalog grows. Scenario skills add guidance for one kind of task and open by reading the basic one. The collection is embedded in the binary.

- `difyctl skills list` — the collection: each skill's name and description. Writes nothing.
- `difyctl skills install <dir>` — write every skill into `<dir>`, the agent's skills root: the folder that holds one subfolder per skill, for example `~/.claude/skills` for Claude Code or `~/.codex/skills` for Codex. Existing copies are overwritten. `--skill <name>` (repeatable) writes only those skills; a scenario skill brings `difyctl` along.

difyctl does not detect agents. You name the root, and the same command re-run after an upgrade refreshes the copies.

The same files install through the Vercel skills installer: `npx skills add langgenius/dify --skill difyctl -g`. Always pass `--skill`; without it the installer also offers the contributor skills under `.agents/skills/`.

## Configuration

| OS      | Config path                                  |
| ------- | -------------------------------------------- |
| Linux   | `${XDG_CONFIG_HOME:-$HOME/.config}/difyctl/` |
| macOS   | `$HOME/.config/difyctl/`                     |
| Windows | `%APPDATA%\difyctl\`                         |

`config get [key]` prints the whole local config or one key; `config set <key> <value>` and `config unset <key>` change it. The only config key today is `http.timeout` (request timeout in milliseconds).

Tokens use the OS keychain by default, falling back to `tokens.yml` on hosts without one; `login --no-keyring` chooses the file outright. Config and cache files are written `0600`, their directory `0700`.

| Env var             | Effect                                                      |
| ------------------- | ----------------------------------------------------------- |
| `DIFY_SERVER`       | Server base URL; with `DIFY_TOKEN`, skips interactive login |
| `DIFY_TOKEN`        | Bearer token; requires `DIFY_SERVER`                        |
| `DIFY_WORKSPACE_ID` | Overrides the locally pinned workspace                      |
| `DIFY_OUTPUT`       | `json` or `text`; overrides the terminal/pipe detection     |
| `DIFY_CONFIG_DIR`   | Overrides the config directory                              |
| `DIFY_CACHE_DIR`    | Overrides the catalog cache directory                       |

## Streaming

Pass `--stream` on a streaming operation to print every event as one JSON line, instead of folding the whole run into a single result object:

```sh
difyctl console_app chat run --app-id … --query hello --inputs '{}' --stream
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

[Agent skill]: #agent-skills
[Dify]: https://dify.ai
[`ARD.md`]: ARD.md
[`skills/`]: ../skills

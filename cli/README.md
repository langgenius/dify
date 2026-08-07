# difyctl

CLI client for [Dify] platform. Browser device-flow signin, list/inspect apps, run with structured input, parse output as JSON, YAML, or human text.

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
difyctl auth login                                       # opens browser; paste the device code shown
difyctl get app                                          # list apps in default workspace
difyctl describe app <app-id>                            # inspect parameters
difyctl run app <app-id> "hello"                         # run, blocking
difyctl run app <app-id> "hello" -o json | jq .answer    # JSON output
difyctl run app <app-id> --input name=world --input topic=cats   # workflow inputs
```

Background docs: `difyctl help account`, `difyctl help external`, `difyctl help environment`, `difyctl help agent`.

## Commands

Run `difyctl --help` for the full list of commands.
Run `difyctl <cmd> --help` for per-command reference.

For agents (and scripting), start with `difyctl help agent` — the cross-command operating guide (output, discovery, auth, exit codes, errors, HITL, retry). Every help surface is also machine-readable: `difyctl help -o json` dumps the whole command tree plus the global contract (exit codes, output formats, error envelope, HITL protocol), and `difyctl <cmd> --help -o json` returns one command's descriptor.

## Agent skill

`difyctl skills install` installs a single, pure-delegation `SKILL.md` into your local agents so they auto-load it. The skill does not freeze the command set — it points the agent at `difyctl help -o json` for the live surface, so it never drifts from your binary. It is embedded in the binary (version-stamped) rather than checked in.

- `difyctl skills install` — dry-run: detect installed agents (Claude Code, Codex, opencode, Cursor, pi) and print where the skill would land. Writes nothing.
- `difyctl skills install --yes` — write to every detected agent, printing each path. `--agent claude-code[,cursor]` restricts to a subset; `<dir>` forces one explicit directory (handy when your agent isn't detected).
- `difyctl skills install --stdout` — print the `SKILL.md` to stdout (for piping or self-install); writes nothing.

Detection is by config-directory existence (`~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.cursor`, `~/.pi`). If a copy ever looks stale, run `difyctl version` and re-run `difyctl skills install`.

## Output formats

| Flag      | Behavior                                               |
| --------- | ------------------------------------------------------ |
| (none)    | Human table, columns auto-sized to terminal.           |
| `-o wide` | Same as table, no column truncation.                   |
| `-o json` | Pretty-printed JSON, machine-parseable, stable shape.  |
| `-o yaml` | YAML mirror of `-o json`.                              |
| `-o name` | IDs only, newline-separated — pipes into `xargs`.      |
| `-o text` | kubectl-describe style human text (`describe`, `run`). |

Errors emit JSON envelope to stderr in `-o json` mode; else human message. Exit codes deterministic.

## Configuration

| OS      | Config path                                  |
| ------- | -------------------------------------------- |
| Linux   | `${XDG_CONFIG_HOME:-$HOME/.config}/difyctl/` |
| macOS   | `$HOME/.config/difyctl/`                     |
| Windows | `%APPDATA%\difyctl\`                         |

Override with `DIFY_CONFIG_DIR=/some/path`. Files written `0600`, directory `0700`. Tokens use OS keychain by default, fall back to sealed file on hosts without one.

For every env var `difyctl` reads, run `difyctl env list` (machine-readable) or `difyctl help environment` (narrative).

## Streaming

`run app` uses blocking transport by default. For long-running apps (likely exceed ~30s) pass `--stream`:

```sh
difyctl run app app-1 "tell me about cats" --stream
```

Agent apps (`mode === 'agent-chat'` or `is_agent` flag set) stream regardless — Dify backend rejects blocking requests for agent mode. Combining `--stream` with `-o json` or `-o yaml` aggregates SSE events into same envelope shape as blocking response, so structured output identical regardless of transport.

## HTTP retry

Idempotent requests (`GET`, `PUT`, `DELETE`) retry on transient network/DNS failures with exponential backoff. Default count: **3**. `POST` and `PATCH` never retry — side effects possible.

| Knob                     | Effect                                         |
| ------------------------ | ---------------------------------------------- |
| `--http-retry <n>`       | Per-invocation override. `0` disables retries. |
| `DIFYCTL_HTTP_RETRY=<n>` | Process-level default.                         |

Resolution: flag → env → 3.

## Contributing

See [`ARD.md`] for architecture patterns, scaffolding recipe, dev workflow.

## License

Apache-2.0.

[Dify]: https://dify.ai
[`ARD.md`]: ARD.md

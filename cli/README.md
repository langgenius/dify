# difyctl

CLI client for [Dify] platform. Browser device-flow signin, list/inspect apps, run with structured input, parse output as JSON, YAML, or human text.

## Install

Builds are standalone binaries (Bun-compiled) published as **GitHub Actions workflow artifacts** — no npm, no GitHub Release assets. The installer fetches the latest successful `cli-release.yml` run on `main`, verifies sha256, and copies the binary into `$HOME/.local/bin/difyctl`.

```sh
# GH_TOKEN with `actions:read` scope is required — workflow artifact downloads
# need auth even on public repos.
export GH_TOKEN=<your-pat>
curl -fsSL https://raw.githubusercontent.com/langgenius/dify/main/cli/scripts/install-cli.sh | sh
```

| Env              | Default           | Purpose                                               |
| ---------------- | ----------------- | ----------------------------------------------------- |
| `GH_TOKEN`       | —                 | GitHub PAT (or `GITHUB_TOKEN`) with `actions:read`.   |
| `DIFYCTL_PREFIX` | `$HOME/.local`    | Install root. Binary lands at `<prefix>/bin/difyctl`. |
| `DIFYCTL_REPO`   | `langgenius/dify` | Source repo.                                          |
| `DIFYCTL_BRANCH` | `main`            | Branch to pick the latest successful run from.        |

Supported targets: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `windows-x64.exe`. The shell installer covers Linux + macOS; Windows users can download the `.exe` directly from the same artifact.

## Quickstart

```sh
difyctl auth login                                       # opens browser; paste the device code shown
difyctl get app                                          # list apps in default workspace
difyctl describe app <app-id>                            # inspect parameters
difyctl run app <app-id> "hello"                         # run, blocking
difyctl run app <app-id> "hello" -o json | jq .answer    # JSON output
difyctl run app <app-id> --input name=world --input topic=cats   # workflow inputs
```

Background docs: `difyctl help account`, `difyctl help external`, `difyctl help environment`.

## Commands

Run `difyctl --help` for the full list of commands.
Run `difyctl <cmd> --help` for per-command reference.

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

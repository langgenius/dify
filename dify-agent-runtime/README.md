# dify-agent-runtime

Go implementation of the shellctl server and runtime utilities.

This is a rewrite of the Python `shellctl` package (`dify-agent/src/shellctl/` and
`dify-agent/src/shellctl_runtime/`). The original Python code is kept as reference.

## Architecture

```
cmd/
  shellctl/          — main server binary (shellctl serve)
  sanitize-pty/      — tmux pipe-pane PTY sanitizer (stdin→stdout filter)
  runner-exit/       — post-drain SQLite exit recorder

internal/
  sanitize/          — PTY ANSI stripping + CR normalization
  runner_exit/       — SQLite CAS update for job exit
  server/            — HTTP API, job service, tmux controller, output reader
```

## Building

```bash
make build
```

Produces binaries in `bin/`:

- `shellctl` — the main server (`shellctl serve --listen 0.0.0.0:5004`)
- `shellctl-sanitize-pty` — PTY sanitizer for tmux pipe-pane
- `shellctl-runner-exit` — exit state writer
- `shellctl-runner` — job runner with integrated Landlock isolation

### Building docker image

```
docker build -f dify-agent-runtime/docker/Dockerfile \
  --build-context agent=./dify-agent \
  -t dify-agent-runtime:latest \
  dify-agent-runtime/
```

### Runing docker container

```
docker run -d --name dify-agent-runtime \
  -p 15004:5004 \
  dify-agent-runtime:latest
```

## Help text generation

Cli help can be generated and injected to dify-agent's system prompt.

```sh
make gen-cli-help
```

## Testing

```bash
make test
```

## Path Isolation

Each agent job runs inside a Landlock sandbox that restricts filesystem access:

| Access               | Paths (defaults)                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Read-Write**       | `$HOME` (always, includes `$CWD/.tmp` as `TMPDIR`)                                                            |
| **Read-Write (dev)** | `/dev/null`, `/dev/zero`, `/dev/urandom`, `/dev/random`, `/dev/tty`                                           |
| **Read-Only + Exec** | `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc`, `/proc`, `/opt/dify-agent-tools`, `/opt/homebrew`, `/snap` |
| **Denied**           | Everything else (`/tmp`, other agents' homes, `/var`, `/srv`, etc.)                                           |

The runner automatically creates `$CWD/.tmp` and sets `TMPDIR`, `TMP`, `TEMP` to it, so temp files stay isolated per workspace.

### Environment Variables

| Variable                         | Default         | Description                                      |
| -------------------------------- | --------------- | ------------------------------------------------ |
| `SHELLCTL_ENABLE_PATH_ISOLATION` | `true`          | Set to `false` to disable Landlock entirely      |
| `SHELLCTL_LANDLOCK_RW_PATHS`     | _(empty)_       | Comma-separated RW directories (besides `$HOME`) |
| `SHELLCTL_LANDLOCK_RO_PATHS`     | `/usr,/bin,...` | Comma-separated RO+exec directories              |
| `SHELLCTL_LANDLOCK_RW_DEV_PATHS` | `/dev/null,...` | Comma-separated device files with RW access      |

Requires Linux ≥ 5.13. On unsupported kernels, a warning is printed to stderr.

## Dependencies

- Go 1.23+
- `modernc.org/sqlite` (pure-Go SQLite driver, no CGO required)
- tmux (runtime dependency, not a build dependency)

## Migration from Python

The Go binaries are drop-in replacements for the Python console scripts:

- `shellctl-sanitize-pty` replaces the Python `shellctl-sanitize-pty` entrypoint
- `shellctl-runner-exit` replaces the Python `shellctl-runner-exit` entrypoint
- `shellctl serve` replaces the Python `shellctl serve` (FastAPI/uvicorn)

The HTTP API contract, SQLite schema, and filesystem artifact layout are identical.

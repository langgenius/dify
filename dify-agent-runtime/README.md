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

Produces three binaries in `bin/`:

- `shellctl` — the main server (`shellctl serve --listen 0.0.0.0:5004`)
- `shellctl-sanitize-pty` — PTY sanitizer for tmux pipe-pane
- `shellctl-runner-exit` — exit state writer

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

## Testing

```bash
make test
```

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

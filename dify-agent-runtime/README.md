# dify-agent-runtime

Go implementation of the shellctl server and runtime utilities.

## Architecture

```
cmd/
  shellctl/          - main server binary (shellctl serve)
  sanitize-pty/      - tmux pipe-pane PTY sanitizer (stdin→stdout filter)
  runner-exit/       - post-drain SQLite exit recorder
  dify-agent-cli/    - cli tool talking to agent backend
  runner/            - process runner to bootstrap agent commands
internal/            - internal implementations
```

## Job execution modes

`POST /v1/jobs/run` accepts an optional `mode` field:

- `pty` (default) keeps the interactive tmux PTY path. stdout and stderr are
  merged, sanitized, and written to `output.log`; the job accepts `/input`.
- `stdio` keeps tmux as the lifecycle owner but gives the child `/dev/null` as
  stdin and captures stdout and stderr through separate pipes. Public output
  and pagination read stdout from `output.log`; private diagnostics are written
  to `stderr.log`. A stdio job completes only after both streams reach EOF and
  does not accept `/input`.

The response models are identical in both modes. Use `stdio` for bounded,
machine-readable control commands and `pty` for interactive jobs.

## Building

```bash
make build
```

Produces binaries in `bin/`:

### Building docker image

```
docker build -f dify-agent-runtime/docker/Dockerfile \
  --build-context agent=./dify-agent \
  -t dify-agent-runtime:latest \
  dify-agent-runtime/
```

### Running docker container

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
| **Read-Write**       | `$HOME` and the job's `cwd` (also used directly as `TMPDIR`, `TMP`, and `TEMP`)                               |
| **Read-Write (dev)** | `/dev/null`, `/dev/zero`, `/dev/urandom`, `/dev/random`, `/dev/tty`                                           |
| **Read-Only + Exec** | `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc`, `/proc`, `/opt/dify-agent-tools`, `/opt/homebrew`, `/snap` |
| **Denied**           | Everything else (`/tmp`, other agents' homes, `/var`, `/srv`, etc.)                                           |

The runner sets `TMPDIR`, `TMP`, and `TEMP` directly to the job's `cwd`. It does not create a separate temp directory, so the active Workspace is both the working directory and temp space.

### Environment Variables

See [here](./internal/envvar/envvar.go)

Requires Linux ≥ 5.13. On unsupported kernels, a warning is printed to stderr.

## Dependencies

- Go 1.26
- `modernc.org/sqlite` (pure-Go SQLite driver, no CGO required)
- tmux (runtime dependency, not a build dependency)

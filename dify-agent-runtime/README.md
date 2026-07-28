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
| **Read-Write**       | `$HOME` and `$CWD`                                                                                              |
| **Read-Write (dev)** | `/dev/null`, `/dev/zero`, `/dev/urandom`, `/dev/random`, `/dev/tty`                                           |
| **Read-Only + Exec** | `/usr`, `/bin`, `/sbin`, `/lib`, `/lib64`, `/etc`, `/proc`, `/opt/dify-agent-tools`, `/opt/homebrew`, `/snap` |
| **Denied**           | Everything else (`/tmp`, other agents' homes, `/var`, `/srv`, etc.)                                           |

The runner creates no temp directory. It always sets `TMPDIR`, `TMP`, and
`TEMP` to `$CWD`, overriding command-provided values so temporary files remain
inside the existing writable layout.

When `SHELLCTL_ENABLE_PATH_ISOLATION=true`, Landlock setup is fail-closed: a
restriction error prevents the user script from executing.

Landlock denies opening, listing, or mutating paths outside the allow-list, but
Linux does not currently let Landlock restrict `stat(2)`. A job may therefore
observe sibling path metadata even though it cannot read or write sibling Home
content.

### Environment Variables

See [here](./internal/envvar/envvar.go)

Path isolation requires Landlock ABI V3 (upstream Linux 6.2+; actual availability
depends on the running kernel's reported ABI). Unsupported kernels or other
Landlock setup failures stop the job before its script runs.

## Dependencies

- Go 1.26
- `modernc.org/sqlite` (pure-Go SQLite driver, no CGO required)
- tmux (runtime dependency, not a build dependency)

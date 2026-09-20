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

## API Routes

### Home snapshot

Native save/restore of the runtime's Home directory (`$HOME`) as a tar+zstd
stream. One snapshot operation runs at a time per runtime (`409 snapshot_busy`
otherwise). **Neither endpoint imposes a size limit — callers own size policy
and must bound the streams in their own logic** (count bytes while reading a
save stream and abort at their cap; bound what they send to restore).

Each operation carries a total I/O deadline set by `SHELLCTL_SNAPSHOT_TIMEOUT`,
a Go duration string (`10m`, `15m30s`). It bounds how long a stalled peer —
connection open, nobody reading — can hold the single-operation gate; a peer
that closes the connection releases it immediately. Unset or empty uses the
built-in default; an unparseable or non-positive value fails startup rather
than falling back to it.

- `POST /v1/snapshot/save` — optional JSON body `{"excludes": [...]}`, gitignore
  syntax, matched at any depth; a malformed body is refused with
  `400 invalid_request`. The runtime's own state directory
  (`.local/share/shellctl`) is **always** excluded and no pattern can
  re-include it; an excluded directory is not descended into. The Workspace
  needs no such rule — it lives outside Home. Streams the
  Home as `application/octet-stream` (chunked). An empty Home is not a special
  case: it streams an ordinary archive with no entries. Success is signaled by
  trailers `X-Snapshot-Status: ok`,
  `X-Snapshot-Sha256`, `X-Snapshot-Bytes`; a cleanly terminated stream WITHOUT
  the `ok` trailer, or an aborted connection, is a failure.
- `POST /v1/snapshot/restore` — raw tar+zstd body, no parameters. Extracts
  into `$HOME` under `os.Root` (path traversal, absolute names, and symlink
  escapes are refused). Returns `{"entries": N, "bytes_written": M}`;
  `400 archive_malformed` for invalid input, `500 restore_failed` for
  non-format failures (e.g. filesystem or environmental errors). Restore is
  NOT transactional — a mid-stream failure can leave a partially restored
  Home, so callers must treat the sandbox as unusable and recreate it rather
  than retry into it. Archives are plain tar+zstd; the decoder caps the zstd
  window at 64 MiB, so foreign archives produced with long-window settings
  are rejected as malformed.

## Dependencies

- Go 1.26
- `modernc.org/sqlite` (pure-Go SQLite driver, no CGO required)
- tmux (runtime dependency, not a build dependency)

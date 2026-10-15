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

## Isolated native test scopes

The ordinary `/v1/jobs` service retains its existing behavior. A separate
`serve --native-test-supervisor` instance exposes authenticated scope creation,
inspection, destruction, and `/v1/test-scopes/{scope_id}/jobs/...`. Native scope
requests pin `scope_id`, positive `generation`, `binding_ref`, immutable
`base_snapshot_ref` and `input_file_refs`, capability digest, deadline, finite
limits, and bounded network targets. References resolve under administrator
supplied immutable roots; clients never supply mount paths. Every scoped job
operation requires the control bearer, `X-Scope-Generation`, and `X-Scope-Token`.
Inspection requires control authority and matching generation and returns a
fresh transport handle for the existing physical owner. Creation never replaces
an existing scope, even after its worker is lost. Tokens are excluded from Agent
checkpoint serialization. Keep the control signing/auth token stable across a
retained scope's lifetime.

The Linux supervisor requires a dedicated unprivileged UID, user/mount/PID/net
namespaces, Landlock, active seccomp filtering, the enforcing
`dify-native-test-supervisor` AppArmor profile, and a finite delegated cgroup-v2
subtree with cpu, memory, pids and cgroup.kill. Missing primitives reject setup
before submitted instructions. The native worker reuses the existing SQLite,
tmux and runner job owner; native catalog commits use FULL durability. A private
worker control socket is authenticated with a scope-specific token. Its namespace
worker survives control-service restart; process PID/start-time and durable
scope/generation identity must still match. Lost workers are never recreated.

Each submitted job enters a separate mount/PID namespace and chroot, drops its
capabilities, sets no-new-privileges and must successfully apply Landlock. Its
filesystem contains read-only image binaries/base/inputs, an isolated writable
Home/workspace, and finite tmpfs storage. The root contains no control/broker
socket, parent `/proc`, or supervisor state. Scope cgroups bound CPU, memory,
swap and descendants. Job FD/file limits, aggregate input/network accounting,
bounded output spool, finite job capacity and wall deadline provide additional
limits. Output overflow fails the job and terminates the namespace tree.

Network namespaces have no direct route. When explicitly requested, a loopback
proxy uses a worker-only Unix broker channel authenticated by kernel peer PID
and UID. The broker resolves and pins approved hosts/ports at creation, denies
private/metadata addresses unless an administrator explicitly names an exact
mediator IP:port, persists aggregate byte budgets, and bounds connection count
and time. The authority permits bounded TCP to those pinned endpoints, including
opaque CONNECT traffic; it does not claim to inspect each application operation
inside a script. Destruction closes broker connections, uses cgroup.kill, waits
for populated=0 and removes storage. Failed cleanup quarantines capacity.

Deployment source is in `docker/native-test-supervisor.service`,
`docker/native-test-start.sh`, `docker/native-test-seccomp.json` and
`docker/native-test-apparmor.profile`. Only the host administrator/systemd
provisions the dedicated subtree and profile. This host-systemd profile requires
systemd 254 or newer and effective `DelegateSubgroup=manager`. systemd must place
the initial and restarted manager in that leaf before executing the startup
script: retained workers leave domain controllers enabled on the unit root,
which cannot also contain processes. The unprivileged startup script checks the
installed systemd version and its actual `/proc/self/cgroup` placement before
writing cgroup controls; it never migrates itself to repair incorrect placement.
Qualification must verify the running manager's version, effective unit property,
manager PID in the `manager` leaf, empty unit-root `cgroup.procs`, and retained
scope/job reconnection after a service restart. `KillMode=process` preserves the
existing workers; scope cancellation still requires the scope's `cgroup.kill`
and populated=0 proof. The systemd unit actually installs the syscall
allowlist; OCI deployments must explicitly apply the shipped JSON. Ubuntu24.04
needs the profile-specific `userns,` rule in
`/etc/apparmor.d/dify-native-userns`; Ubuntu22.04's AppArmor syntax leaves that
optional include absent. That syntax compatibility does not qualify Ubuntu22.04
hosts: systemd versions below 254 are unsupported by this profile, and the actual
Dev node has not passed native deployment qualification. Parse and enforce the
target profile; never substitute privileged mode,
a Docker socket, broad host cgroup access or a globally disabled LSM.

For local Agent settings, `DIFY_AGENT_RUNTIME_BACKEND=local` remains selected.
`DIFY_AGENT_LOCAL_NATIVE_TEST_ENDPOINT` and
`DIFY_AGENT_LOCAL_NATIVE_TEST_AUTH_TOKEN` select only this private supervisor;
ordinary shellctl keeps its original endpoint/token. The native settings never
advertise protocol capabilities by themselves. The actual Linux integration
suite (`make integration-native-test`) requires the provisioned supervisor and
synthetic canary and fails rather than skipping missing prerequisites. Unit
coverage alone does not qualify these isolation capabilities.

The image includes all four canonical deployment files under
`/usr/share/dify-native/`. For a host-systemd deployment, the administrator installs
`native-test-start.sh` as `/usr/local/libexec/dify-native-start`, the unit as
`/etc/systemd/system/dify-native.service`, loads the AppArmor profile and provides
its root-owned EnvironmentFile. Copying these artifacts into an OCI image does
not activate them. Host-systemd integration and native OCI image/deployment
qualification are separate gates.

`disk_bytes` caps the writable payload tmpfs shared by Home, workspace and scratch.
The separate protected spool has a ceiling of input + output + 1 MiB; each of at
most 64 lifetime admitted jobs has a read-only script tmpfs capped at input +
4 KiB. Input is cumulatively charged before admission and output is cumulatively
reserved in the existing worker SQLite catalog before PTY/stdout/stderr writes;
deleting jobs or reopening streams does not refund either budget. Network reads
and writes reserve bytes before transfer (short reads may conservatively charge
extra), and each dial consumes an additional connection unit. Worker proxy
connections are capped at four and 60 seconds. Job-only seccomp denies new
namespaces, mounts and capability changes after trusted setup, including through
clone flags; clone3 returns ENOSYS to allow libc's ordinary-thread clone fallback.

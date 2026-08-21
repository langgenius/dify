# Rust shell runtime

This directory contains the Rust implementation of the Dify shell runtime.
It keeps the Go runtime's HTTP contract and artifact layout so it can be
introduced without changing the Python agent sandbox.

Both job modes from the current contract are supported: `pty` remains the
default and merges terminal output, while `stdio` captures stdout and stderr
separately and rejects interactive input. Existing state databases are
migrated in place with legacy jobs assigned to `pty`.

## Binaries

- `shellctl` — HTTP server for tmux-backed jobs.
- `shellctl-runner` — gated job runner with optional Landlock isolation.
- `shellctl-runner-exit` — idempotent SQLite exit recorder kept as a
  compatibility/fallback utility; the server normally reconciles exit metadata
  in its long-lived background thread.
- `shellctl-sanitize-pty` — streaming ANSI/PTY output sanitizer.

## Build and test

```bash
cargo build --release --bins
cargo test
```

Landlock is compiled on Linux through the `landlock` crate. On macOS and
other unsupported platforms the runner logs a warning and continues without
filesystem isolation, matching the existing best-effort behavior.

The Go implementation remains the default and fallback runtime during the
migration. The Rust server is built as a separate image and owns separate
SQLite, tmux, Home, Workspace, and Snapshot state.

## Safe canary rollout

Start the normal stack plus the opt-in Rust service:

```bash
cd docker
DIFY_AGENT_LOCAL_SANDBOX_RUST_CANARY_PERCENT=1 \
  docker compose \
  -f docker-compose.yaml \
  -f docker-compose.rust-runtime.yaml \
  up -d --build
```

The agent backend makes a deterministic decision only for a new, unpinned
Binding. It sends a bounded health preflight to Rust and assigns that Binding
to Go if the preflight fails. Once a mutating request has reached a runtime it
is never replayed against the other implementation. Rust-owned refs use a
`rust+` prefix and remain pinned to Rust for their full lifecycle; Go refs keep
their existing representation and remain compatible with a Go-only rollback.

To roll back admission without stranding Rust-owned resources, leave
`DIFY_AGENT_LOCAL_SANDBOX_RUST_ENDPOINT` configured and set
`DIFY_AGENT_LOCAL_SANDBOX_RUST_CANARY_PERCENT=0`. Remove the Rust service only
after all `rust+` Bindings, Workspaces, and Home Snapshots have drained.

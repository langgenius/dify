# Local Codex A2A bridge

This example exposes the installed Codex CLI as an
[A2A 1.0 HTTP+JSON](https://a2a-protocol.org/latest/specification/) agent. It is
the local development adapter for Dify's Bring Your Own Agent flow, not a
multi-tenant production runtime.

Implemented A2A operations:

- `GET /.well-known/agent-card.json`
- `POST /message:send`
- `POST /message:stream` using Server-Sent Events
- `GET /tasks/{id}`
- `GET /tasks/{id}:subscribe` using Server-Sent Events
- `POST /tasks/{id}:cancel`

Each A2A task is one Codex turn. A new message that reuses a prior `contextId`
starts `codex exec resume <thread_id>` and therefore keeps the Codex
conversation. The task metadata exposes the non-secret `codexThreadId` and
token usage returned by the CLI.

## Start locally

Authenticate the normal Codex installation first, then start the bridge from
`dify-agent/`:

```bash
codex --version

export DIFY_BYOA_CODEX_WORKSPACE_ROOT=/absolute/path/to/the/allowed/repository
export DIFY_BYOA_CODEX_PUBLIC_URL=http://127.0.0.1:8765

PYTHONPATH=examples/dify_agent \
  uv run --extra server python -m dify_agent_examples.codex_a2a_bridge \
  --host 127.0.0.1 \
  --port 8765
```

The current development machine has `codex-cli 0.132.0`. Its user-selected
`gpt-5.6-sol` requires a newer CLI, so this example defaults to `gpt-5.5` with
`xhigh` reasoning. Override either value through
`DIFY_BYOA_CODEX_MODEL`/`DIFY_BYOA_CODEX_REASONING_EFFORT` or the matching CLI
flags when the local installation changes.

When Dify runs in Docker Desktop, make the host bridge reachable from the API
container and advertise that address:

```bash
export DIFY_BYOA_CODEX_PUBLIC_URL=http://host.docker.internal:8765
export DIFY_BYOA_CODEX_API_TOKEN=replace-with-a-local-development-token
export DIFY_BYOA_CODEX_ALLOW_INSECURE_PUBLIC_URL=true

PYTHONPATH=examples/dify_agent \
  uv run --extra server python -m dify_agent_examples.codex_a2a_bridge \
  --workspace-root /absolute/path/to/the/allowed/repository \
  --host 0.0.0.0 \
  --port 8765
```

Dify's outbound client is deny-by-default for private destinations. Add only
the Docker host alias to `docker/.env`, then restart the Dify API and SSRF proxy:

```bash
SSRF_PROXY_ALLOW_PRIVATE_DOMAINS=host.docker.internal
```

That exception applies globally to requests using Dify's SSRF proxy. Keep it
limited to a trusted local development installation rather than allowing broad
private address ranges.

Keep the bearer token in the environment. There is intentionally no token CLI
flag, so it is not exposed as a command-line argument. The bridge removes this
credential before spawning Codex. The public Agent Card advertises the matching
bearer requirement when the token is configured, and a non-loopback bind fails
closed when the token is absent. Non-loopback HTTP also fails closed unless the
operator explicitly enables `DIFY_BYOA_CODEX_ALLOW_INSECURE_PUBLIC_URL` for a
trusted development network. Terminate TLS before exposing this adapter to any
other network.

## Simulate remote Dify through the public Internet

To exercise the real network boundary while both Dify and Codex happen to run
on the same development machine, keep the bridge on loopback and publish it
through an outbound HTTPS tunnel. Dify must store and call only the public URL.

The bundled launcher defaults to an ephemeral Cloudflare Quick Tunnel. Because
TryCloudflare buffers Server-Sent Events, the launcher advertises
`streaming=false`; Dify then uses A2A `message:send`, so real Codex execution
works in blocking mode instead of hanging on `message:stream`. When
`DIFY_BYOA_CODEX_API_TOKEN` is absent, each launch generates a fresh Bearer token
and replaces the current macOS Keychain item
`dify-byoa-public-bridge` / `api-token`. It starts the bridge only after the
public URL is known, verifies both the local and public Agent Cards, and
supervises both processes so either one exiting stops the other. It uses an
installed `cloudflared` binary when available and otherwise runs the pinned
Cloudflare image through Docker:

```bash
export DIFY_BYOA_CODEX_WORKSPACE_ROOT=/absolute/path/to/the/allowed/repository

./examples/dify_agent/dify_agent_examples/codex_a2a_bridge/run_public_tunnel.sh
```

For the local Docker Desktop simulation, run Dify's SSRF proxy with the BYOA
DNS override. This prevents its embedded resolver from retaining an NXDOMAIN
answer for a newly issued Quick Tunnel hostname:

```bash
docker compose \
  -p dify-middlewares-dev \
  -f docker/docker-compose.middleware.yaml \
  -f docker/docker-compose.byoa.yaml \
  up -d --force-recreate ssrf_proxy
```

Use the printed `https://...` origin as the Dify External Agent endpoint and
select Bearer authentication with the newly rotated Keychain token. Update both
the Endpoint and Token after every reconnect; an old Dify connection snapshot is
intentionally unable to call the next tunnel. The Agent Card advertises that
same HTTPS origin, so Dify's same-origin check proves it is not silently falling
back to localhost. Both Console discovery and Workflow execution go through
Dify's SSRF-controlled HTTP client and then the public tunnel. The public
launcher defaults Codex to `read-only`; explicitly set
`DIFY_BYOA_CODEX_SANDBOX=workspace-write` only for a repository and Dify account
you trust.

The Keychain item is created without a pre-authorized reader. macOS may ask the
operator to approve access when copying the current token into Dify; do not
grant blanket access to unattended processes.

This launcher is for architecture simulation, not availability testing: the
free hostname is ephemeral and changes after reconnect. Set
`DIFY_BYOA_TUNNEL_PROVIDER=localhost-run` to use the legacy SSE-capable SSH
tunnel, but its anonymous hostname is also ephemeral. Use a Cloudflare Named
Tunnel or the planned outbound Connector/Relay transport for a persistent URL
with streaming support.

The tunnel provider terminates HTTPS and is therefore inside this development
setup's trust boundary: its operator can observe the Bearer header, prompts,
and results. Do not send sensitive repository content through a free relay. A
production design should use an operator-controlled relay/private network and
end-to-end service authentication, or an outbound Connector that keeps local
credentials and execution behind the user's machine boundary.

## Try the protocol

Discover the agent:

```bash
curl http://127.0.0.1:8765/.well-known/agent-card.json
```

Run a blocking turn:

```bash
curl --request POST http://127.0.0.1:8765/message:send \
  --header 'A2A-Version: 1.0' \
  --header 'Content-Type: application/a2a+json' \
  --data '{
    "message": {
      "messageId": "message-1",
      "contextId": "demo-conversation",
      "role": "ROLE_USER",
      "parts": [{"text": "Summarize this repository"}]
    }
  }'
```

Run a second turn with a new `messageId` and the same `contextId` to resume the
Codex thread. Do not send the completed `taskId` as the continuation target.

Stream task/status/artifact events:

```bash
curl --no-buffer --request POST http://127.0.0.1:8765/message:stream \
  --header 'Content-Type: application/a2a+json' \
  --data '{
    "message": {
      "messageId": "message-2",
      "role": "ROLE_USER",
      "parts": [{"text": "List the main packages"}]
    }
  }'
```

For asynchronous polling, send
`"configuration":{"returnImmediately":true}`, retain the returned task ID,
then call `GET /tasks/{id}` or `POST /tasks/{id}:cancel`.
While the task is non-terminal, `GET /tasks/{id}:subscribe` returns a current
Task snapshot, retained artifact chunks, and future SSE updates. Artifact text
is chunked so each serialized event remains below Dify's 1 MiB event limit.

## Operator-owned settings

| Environment variable | CLI flag | Default |
| --- | --- | --- |
| `DIFY_BYOA_CODEX_WORKSPACE_ROOT` | `--workspace-root` | required |
| `DIFY_BYOA_CODEX_HOST` | `--host` | `127.0.0.1` |
| `DIFY_BYOA_CODEX_PUBLIC_URL` | `--public-url` | `http://127.0.0.1:8765` |
| `DIFY_BYOA_CODEX_ALLOW_INSECURE_PUBLIC_URL` | `--allow-insecure-public-url` | `false` |
| `DIFY_BYOA_CODEX_STREAMING` | `--streaming` / `--no-streaming` | `true` |
| `DIFY_BYOA_CODEX_BIN` | `--codex-bin` | `codex` |
| `DIFY_BYOA_CODEX_MODEL` | `--model` | `gpt-5.5` |
| `DIFY_BYOA_CODEX_REASONING_EFFORT` | `--reasoning-effort` | `xhigh` |
| `DIFY_BYOA_CODEX_SANDBOX` | `--sandbox` | `workspace-write` |
| `DIFY_BYOA_CODEX_IGNORE_USER_CONFIG` | `--ignore-user-config` | `false` |
| `DIFY_BYOA_CODEX_MAX_CONCURRENT_TASKS` | `--max-concurrent-tasks` | `1` |
| `DIFY_BYOA_CODEX_API_TOKEN` | none | optional only for loopback binds |

The public launcher additionally supports `DIFY_BYOA_TUNNEL_PROVIDER`
(`cloudflare-quick` by default, or `localhost-run`) and
`DIFY_BYOA_CLOUDFLARED_IMAGE`. The legacy SSH provider supports
`DIFY_BYOA_CODEX_KNOWN_HOSTS_FILE` and defaults it to a dedicated persistent
TOFU file under `~/.ssh`. The launcher's sandbox default is `read-only`; the
table above describes the direct bridge CLI default.

Only `read-only` and `workspace-write` sandbox modes are accepted. The A2A
request cannot select a working directory, model, sandbox, Codex thread, or
executable. Prompts are sent over stdin to a shell-free subprocess whose cwd is
always the resolved workspace root, and Codex runs with approval policy `never`.
Resume is allowed only for thread IDs that this process observed from its own
Codex tasks.

Operation failures use the A2A 1.0 HTTP+JSON representation of
`google.rpc.Status` with `google.rpc.ErrorInfo` details. Without a configured
token, the Agent Card exposes empty `securitySchemes` and
`securityRequirements` so connection validation can distinguish open and
Bearer-protected bridge instances.

The JSONL adapter retains event type names, agent messages, thread ID, and
numeric usage. It deliberately discards Codex stderr and command execution
payloads because those may contain local paths, file contents, or credentials.

## Validate

```bash
uv run pytest tests/local/examples/test_codex_a2a_bridge.py -q
uv run ruff check examples/dify_agent/dify_agent_examples/codex_a2a_bridge \
  tests/local/examples/test_codex_a2a_bridge.py
uv run basedpyright --level error examples/dify_agent/dify_agent_examples/codex_a2a_bridge \
  tests/local/examples/test_codex_a2a_bridge.py
```

## Prototype limitations

- Tasks, events, context-to-thread mappings, and process handles are in memory
  and disappear when the bridge restarts.
- Streaming follows Codex JSONL item events; the CLI does not expose token
  deltas through `--json`.
- Text parts are supported; A2A files, data parts, push notifications, task
  listing, and durable queues are not implemented.
- Cancellation terminates the local Codex process group and is best effort for
  side effects that completed before cancellation.
- Bind to loopback for normal use. A non-loopback development binding requires
  the bearer token and should use a host firewall; production deployment requires TLS,
  persistent storage, tenant isolation, rate limits, and stronger credentials.

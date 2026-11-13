# Official SDK interoperability

The peer pins [`a2a-sdk` 1.3.0](https://github.com/a2aproject/a2a-python/releases/tag/v1.3.0),
upstream commit `0d9dafb92328144384eca58a6e8ab80cb8f7d445`. The
[official compatibility table](https://github.com/a2aproject/a2a-python/blob/v1.3.0/README.md#-compatibility)
includes A2A 1.0 HTTP+JSON clients and servers. SDK version and protocol version are separate:
the Card and requests in this suite use protocol `1.0`; the 0.3 compatibility adapter is disabled.

`official_sdk_server.py` supplies agent work through `AgentExecutor` and `TaskUpdater`.
The unmodified SDK owns Card serialization, REST routes/dispatcher, request validation,
`DefaultRequestHandlerV2`, Task storage, Send/Stream/Get/Cancel, and SSE serialization.
Admin observations count every HTTP attempt and record only synthetic identities, sizes,
and hashes. They cannot change a Task or inject an identity into Dify.

Install the peer in a separate Python 3.12 environment. These dependencies are optional
test infrastructure and do not change Dify's runtime lockfile:

```bash
uv venv --python 3.12 /tmp/byoa-official-sdk
uv pip install --python /tmp/byoa-official-sdk/bin/python --require-hashes \
  -r api/tests/e2e_tests/external_agents/official_sdk_requirements.txt
```

Serve only inside the isolated acceptance network, with a hostname covered by the test CA:

```bash
export BYOA_SDK_PUBLIC_URL=https://byoa-sdk-fixture
export BYOA_SDK_CERT=/run/byoa-tls/server.crt
export BYOA_SDK_KEY=/run/byoa-tls/server.key
export BYOA_SDK_PORT=443
PYTHONPATH=api /tmp/byoa-official-sdk/bin/python \
  -m tests.e2e_tests.external_agents.official_sdk_server
```

Keep the unauthenticated `/admin/state` reachable only inside that network. Configure the
dedicated Dify stack's existing SSRF policy and TLS trust for this peer; do not disable TLS
verification. The server's two Cards are `/.well-known/agent-card.json` (ordinary Send)
and `/stream/.well-known/agent-card.json` (SSE); their interface URLs are distinct.

Run the product acceptance in Dify's existing environment with real Console credentials
provided transiently. Reuse `DIFY_TEST_URL`, `DIFY_TEST_EMAIL`, `DIFY_TEST_PASSWORD`,
`DIFY_TEST_CA_FILE`, and `BYOA_FIXTURE_CA_FILE`. The latter selects the SDK peer's trusted CA.
The SDK does not need those Dify credentials.

```bash
export BYOA_SDK_PUBLIC_URL=https://byoa-sdk-fixture
export BYOA_SDK_ADMIN_URL=https://byoa-sdk-fixture/admin
export BYOA_SDK_ACCEPTANCE_OUTPUT=/tmp/byoa-sdk-acceptance.json
PYTHONPATH=api uv run --frozen --project api python \
  -m tests.e2e_tests.external_agents.official_sdk_acceptance
```

The runner asserts seven business requests: direct Message; asynchronous Task resolved
by GetTask; explicit input file checked by SHA-256; raw output materialized as a Dify file;
confirmed cancellation; SSE followed by GetTask; and a real Start→External→End Workflow
with durable pause/checkpoint/resume. It independently checks SDK HTTP/executor counts,
precise public-Card Verify scope, no Verify business Send, and no Subscribe. The SSE Task
takes 35 seconds so the unchanged 30-second product listening window must hand off to
GetTask. Run this suite sequentially against its peer; allow several minutes.

A quicker local wire smoke is available in the optional SDK environment:

```bash
PYTHONPATH=api /tmp/byoa-official-sdk/bin/python \
  -m tests.e2e_tests.external_agents.official_sdk_gateway_smoke
```

That smoke starts one temporary loopback socket, uses the production Dify gateway over
real HTTP, and closes the client/server in `finally`. Its explicit injected loopback HTTP
and one-second SSE window are local test choices. It is not evidence of verified-TLS
Console/Workflow dev acceptance and does not change production network settings or timing.

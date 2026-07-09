# Shell layer

The shell layer lets a Dify Agent run expose a `shellctl`-backed workspace to the
model. This page is for Dify Agent clients that build `CreateRunRequest`
payloads. It explains how to add the layer to a run composition and how the
server-side runtime must be wired.

The layer type id is `dify.shell`. Its public config is intentionally empty:

```python
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.protocol import RunLayerSpec

RunLayerSpec(
    name="shell",
    type=DIFY_SHELL_LAYER_TYPE_ID,
    config=DifyShellLayerConfig(),
)
```

Server-only settings, such as the `shellctl` HTTP entrypoint and auth token, are
injected by the Dify Agent runtime provider. They are not part of
`DifyShellLayerConfig` and should not be submitted by clients in the public run
request.

## Runtime requirements

When a run includes `dify.shell`, the Dify Agent server must construct its layer
providers with a non-empty shellctl entrypoint:

```python
from dify_agent.runtime.compositor_factory import create_default_layer_providers

layer_providers = create_default_layer_providers(
    plugin_daemon_url="http://localhost:5002",
    plugin_daemon_api_key="replace-with-plugin-daemon-key",
    shellctl_entrypoint="http://127.0.0.1:5004",
    shellctl_auth_token="replace-with-shellctl-token",  # optional; defaults to no token
)
```

In the FastAPI server, these values are read from environment-backed
`ServerSettings` fields:

```env
DIFY_AGENT_SHELLCTL_ENTRYPOINT=http://127.0.0.1:5004
DIFY_AGENT_SHELLCTL_AUTH_TOKEN=replace-with-shellctl-token
```

`DIFY_AGENT_SHELLCTL_AUTH_TOKEN` defaults to `None`/empty, which keeps the shell
client on the no-token path. Set it only when the shellctl server is started with
bearer authentication.

To let commands inside user-visible shell jobs call back to the Dify Agent server
with `dify-agent ...`, also enable the Agent Stub:

```env
DIFY_AGENT_STUB_API_BASE_URL=https://agent.example.com/agent-stub
DIFY_AGENT_SERVER_SECRET_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY
```

HTTP `DIFY_AGENT_STUB_API_BASE_URL` may be either the service root or the
explicit `/agent-stub` API root; the server normalizes the service root to
`/agent-stub`. Other HTTP paths are rejected at startup.

The supplied Docker and `.example.env` configs use a development
`DIFY_AGENT_SERVER_SECRET_KEY`. Override it in production with unpadded base64url
text for exactly 32 decoded bytes. One way to generate it is:

```bash
python -c 'import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode())'
```

## Client request shape

A client adds the shell layer as an ordinary composition layer. Basic shell jobs
do not need dependencies. To inject `DIFY_AGENT_STUB_API_BASE_URL`,
`DIFY_AGENT_STUB_AUTH_JWE`, and `DIFY_AGENT_STUB_DRIVE_BASE` into user-visible
`shell.run` jobs, declare the execution-context layer as the shell layer's
`execution_context` dependency. When the run also includes `dify.drive`, declare
it as the shell layer's `drive` dependency; the injected drive base is then
computed from the fixed Agent Stub drive mount and the drive reference, for
example `/mnt/drive/agent-123`. Without a drive dependency, the CLI keeps the
historical `/mnt/drive` fallback. A typical run still also includes:

- a prompt layer that supplies the task;
- an execution-context layer carrying tenant/user context;
- an LLM layer named `llm`.

When clients want the shell workspace and shellctl job records to be removed at
the end of the run, set `on_exit.default` to `delete`.

## Example: CSV analysis run

The following example mirrors a verified run with a real Gemini model and a
temporary shellctl server. The client gives the model a small CSV-shaped dataset
and asks for computed metrics without prescribing the exact shell commands.

### Request

```python {test="skip" lint="skip"}
from agenton.layers import ExitIntent
from agenton_collections.layers.plain import PromptLayerConfig
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig
from dify_agent.layers.execution_context import (
    DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
    DifyExecutionContextLayerConfig,
)
from dify_agent.layers.shell import DIFY_SHELL_LAYER_TYPE_ID, DifyShellLayerConfig
from dify_agent.protocol import DIFY_AGENT_MODEL_LAYER_ID
from dify_agent.protocol.schemas import CreateRunRequest, LayerExitSignals, RunComposition, RunLayerSpec


request = CreateRunRequest(
    composition=RunComposition(
        layers=[
            RunLayerSpec(
                name="prompt",
                type="plain.prompt",
                config=PromptLayerConfig(
                    prefix="You are a practical data analyst. Give a concise final answer.",
                    user="""Analyze this small sales dataset with pandas. Use any local computation you think is useful.

region,product,units,unit_price
north,widget,12,3.50
north,gadget,5,9.00
south,widget,7,3.50
south,gadget,9,9.00
west,widget,4,3.50
west,gadget,11,9.00

Report the total revenue, the region with the most revenue, total units by
product, and a SHA-256 hash of the CSV content.""",
                ),
            ),
            RunLayerSpec(
                name="shell",
                type=DIFY_SHELL_LAYER_TYPE_ID,
                deps={"execution_context": "execution_context"},
                config=DifyShellLayerConfig(),
            ),
            RunLayerSpec(
                name="execution_context",
                type=DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
                config=DifyExecutionContextLayerConfig(
                    tenant_id="92cca973-2d6f-45e0-906e-0b7eda5f2ccf",
                    invoke_from="workflow_run",
                ),
            ),
            RunLayerSpec(
                name=DIFY_AGENT_MODEL_LAYER_ID,
                type="dify.plugin.llm",
                deps={"execution_context": "execution_context"},
                config=DifyPluginLLMLayerConfig(
                    plugin_id="langgenius/gemini",
                    model_provider="google",
                    model="gemini-3.5-flash",
                    credentials={"google_api_key": "<redacted>"},
                ),
            ),
        ]
    ),
    on_exit=LayerExitSignals(default=ExitIntent.DELETE),
)
```

The same request serialized as JSON has these important layer entries:

```json
{
  "composition": {
    "schema_version": 1,
    "layers": [
      {"name": "prompt", "type": "plain.prompt"},
      {
        "name": "shell",
        "type": "dify.shell",
        "deps": {"execution_context": "execution_context"},
        "config": {}
      },
      {"name": "execution_context", "type": "dify.execution_context"},
      {
        "name": "llm",
        "type": "dify.plugin.llm",
        "deps": {"execution_context": "execution_context"}
      }
    ]
  },
  "on_exit": {"default": "delete", "layers": {}}
}
```

### Final answer

The terminal `run_succeeded` output was:

````markdown
Here is the analysis of the sales dataset:

* **Total Revenue:** **$305.50**
* **Top Region:** **west** with **$113.00**
* **Total Units by Product:** gadget: 25 units, widget: 23 units
* **SHA-256 Hash:** `e86521a0d759037a09b059cb3cb2419f0a3f06e674db8151ccf2f93811dac0b8`
````

## Running the local sandbox in Docker

Build the local sandbox image from the Dify Agent package root:

```bash
docker build -f docker/local-sandbox/Dockerfile -t dify-agent-local-sandbox:local .
```

Run it with a bearer token and publish the API on localhost:

```bash
docker run --rm --name dify-agent-local-sandbox \
  -e SHELLCTL_AUTH_TOKEN=replace-with-a-token \
  -p 127.0.0.1:5004:5004 \
  dify-agent-local-sandbox:local
```

The image starts `shellctl serve --listen 0.0.0.0:5004` as the non-root
`dify` user. It also sets the fallback `DIFY_AGENT_STUB_DRIVE_BASE=/mnt/drive`
and pre-creates that directory with write access for the same user.

## Docker image contents

The provided `docker/local-sandbox/Dockerfile` installs:

- `tmux`, required by `shellctl` to manage shell jobs;
- common shell workspace tools: `git`, `openssh-client`, `jq`, `ripgrep`,
  `unzip`, `zip`, `file`, `procps`, and `less`;
- `dify-agent[grpc,shellctl-server]` as a standalone uv tool, which provides
  both the Agent Stub client CLI and the built-in `shellctl` CLI/server;
- `uv`, so uv shebang scripts with PEP 723 metadata can run inside the shell
  workspace and Python CLI tools can be installed with isolated tool
  environments;
- `node==22.22.1` and `pnpm==11.9.0`, so JavaScript and TypeScript tooling can
  run inside the shell workspace without per-job installation;
- a non-root default user named `dify`.

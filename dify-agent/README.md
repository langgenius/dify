# Dify Agent

Dify Agent runs Pydantic AI with native capabilities and toolsets. Module
configuration and session state are JSON data; infrastructure services and
operation resources have explicit owners.

In the sandbox, `dify-agent config prompt pull` exports the raw system prompt to
`./.dify_conf/prompt.md`; `dify-agent config prompt push` saves local edits to the
current account's build draft. Only later requests built from that draft use
the saved prompt. See the runtime documentation for access rules and stdin usage.

## Async agent loop PoC

Run the local example from `dify-agent/` (no API keys or services required):

```bash
uv run python examples/dify_agent/dify_agent_examples/run_async_agent_loop.py
```

A scripted model demonstrates human steering inputs enqueued during a model
call being delivered once and in FIFO order on the next turn. The example does
not change the production runner or persist queued inputs.

See [runtime documentation](docs/dify-agent/index.md) and the
[operations guide](docs/dify-agent/guide/index.md). Run `make docs` to build docs.

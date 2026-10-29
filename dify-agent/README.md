# Dify Agent

Dify Agent runs Pydantic AI with native capabilities and toolsets. Module
configuration and session state are JSON data; infrastructure services and
operation resources have explicit owners.

In the sandbox, `dify-agent config prompt pull` exports the raw system prompt to
`./.dify_conf/prompt.md`; `dify-agent config prompt push` saves local edits to the
current account's build draft. Only later requests built from that draft use
the saved prompt. See the runtime documentation for access rules and stdin usage.

See [runtime documentation](docs/dify-agent/index.md) and the
[operations guide](docs/dify-agent/guide/index.md). Run `make docs` to build docs.

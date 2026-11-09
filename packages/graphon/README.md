<!-- knowledge
last_checked: "2026-09-08T17:06:16Z"
-->
# Graphon

Graphon is a Python graph execution engine for agentic AI workflows.

The repository is still evolving, but it already contains a working execution
engine, built-in workflow nodes, model runtime abstractions, integration
protocols, and a runnable end-to-end example.

## Highlights

- Queue-based `Engine` orchestration with event-driven execution
- Graph parsing, validation, and fluent graph building
- Shared runtime state, variable pool, and workflow execution state
- Built-in node implementations for common workflow patterns
- DSL import support with Slim-backed LLM nodes
- HTTP, file, tool, and human-input integration protocols
- Extensible engine layers and external command channels

Repository modules currently cover node types such as `start`, `end`, `answer`,
`llm`, `if-else`, `code`, `template-transform`, `question-classifier`,
`http-request`, `tool`, `variable-aggregator`, `variable-assigner`, `loop`,
`iteration`, `parameter-extractor`, `document-extractor`, `list-operator`, and
`human-input`.

## Quick Start

Graphon is currently easiest to evaluate from a source checkout.

### Requirements

- Python 3.12 or 3.13
- [`uv`](https://docs.astral.sh/uv/)
- [`just`](https://just.systems/)
- [`fd`](https://github.com/sharkdp/fd)

Python 3.14 is currently unsupported because `unstructured`, which backs part
of the document extraction stack, currently declares `Requires-Python: <3.14`.

### Set up the repository

```bash
just dev
source .venv/bin/activate
just test
```

`just dev` installs the project, syncs development dependencies, and sets up
[`prek`](https://prek.j178.dev/) Git hooks. `just test` is the progressive
local validation entrypoint: it formats, applies lint fixes, runs `ty check`,
and then runs [`pytest`](https://docs.pytest.org/).

## Run the Example Workflows

The repository includes minimal runnable Slim LLM examples at
[`examples/slim_llm`](examples/slim_llm).

Both versions execute this workflow:

```text
start -> llm -> answer
```

To run it:

```bash
just dev
source .venv/bin/activate
cd examples/slim_llm
cp credentials.example.json credentials.json
python3 dsl.py "Reply with only the word Graphon."
python3 code.py "Reply with only the word Graphon."
```

Before running the example, fill in the required values in `credentials.json`.

The example currently expects:

- OpenAI-compatible model credentials in `model_credentials`
- `slim.mode` set to either `local` or `remote`
- `dify-plugin-daemon-slim` in `PATH`, `SLIM_BINARY_PATH`, or a local `slim`
  binary in the example directory
- for remote mode, `daemon_addr` and `daemon_key`

For the exact credential shape and runtime notes, see
[examples/slim_llm/README.md](examples/slim_llm/README.md).

## How Graphon Fits Together

At a high level, direct Graphon usage looks like this:

1. Prepare `RuntimeState` with the workflow ID and seed the `VariablePool`.
2. Configure model, file, HTTP, tool, or human-input adapters as needed.
3. Instantiate nodes with that state and build them into a `Graph`.
4. Run `Engine` and consume emitted engine events; a local command channel is
   created automatically unless an external channel is supplied.
5. Read final outputs from runtime state.

For Dify DSL documents, use `graphon.dsl.loads()` to build the engine from the
workflow YAML and credentials. The resulting engine uses the DSL Slim adapter
for LLM nodes:

```python
engine = loads(
    dsl,
    credentials=credentials,
    workflow_id="example-dsl-openai-slim",
    start_inputs={"query": query},
)

events = list(engine.run())
```

See [examples/slim_llm/dsl.py](examples/slim_llm/dsl.py) for the DSL import
version and [examples/slim_llm/code.py](examples/slim_llm/code.py) for the
Python graph construction version.

The default DSL node set is defined by
[`SlimDslNodeFactory.NODE_BUILDERS`](src/graphon/dsl/node_factory.py).
HTTP request import covers text request bodies and text responses; file request
bodies still require application-level file adapters.

For direct Python graph construction, use `graphon.dsl.slim.SlimLLM` as the
standard Slim-backed LLM runtime. Integrations that need to replace model
execution, routing, credential injection, or token counting can implement
`graphon.protocols.LLMProtocol`. A higher-level model factory/resolver layer is
planned as a separate follow-up.

## Project Layout

- `src/graphon/graph`: graph structures, parsing, validation, and builders
- `src/graphon/engine`: dispatch, workers, commands, events, and layers
- `src/graphon/runtime`: runtime state, read-only wrappers, and variable pool
- `src/graphon/nodes`: built-in workflow node implementations
- `src/graphon/model_runtime`: provider/model abstractions and shared model
  entities
- `src/graphon/dsl`: DSL import support, including Slim-backed runtime adapters
- `src/graphon/node_events`: payloads emitted by node implementations before
  execution context is attached
- `src/graphon/engine_events`: complete events emitted by the engine
- `src/graphon/http`: HTTP client abstractions and default implementation
- `src/graphon/file`: workflow file models and file runtime helpers
- `src/graphon/protocols`: public protocol re-exports for integrations
- `examples/`: runnable examples
- `tests/`: unit and integration-style coverage

## Internal Docs

- [Repository knowledge](docs/README.md): architecture, development guide,
  component references, and maintenance
- [Architecture](ARCHITECTURE.md): execution flow, boundaries, and invariants
- [Contributing](CONTRIBUTING.md): contributor workflow, CI, commit/PR rules

## Development

Contributor setup, tooling details, CLA notes, and commit/PR conventions live
in [CONTRIBUTING.md](CONTRIBUTING.md).

CI currently validates pull request titles, runs `just check` including
`uv.lock` freshness validation, and runs `uv run pytest` on Python 3.12 and
3.13. Python 3.14 is currently excluded because `unstructured` does not yet
support it.

## License

Apache-2.0. See [LICENSE](LICENSE).

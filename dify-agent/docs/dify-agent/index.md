# Dify Agent runtime

Dify Agent hosts native Pydantic AI runs behind FastAPI. Implementations remain
under `src/dify_agent`; there is no separate agent composition framework.

Each module declares Pydantic `Config`, `State`, and exactly one native
`Capability` or `Toolset`. The server registry maps a name to a module. Names
identify configuration, state and instances; aliases can use the same module
with independent state. New instances are created for every run.

`ctx.deps.layers[name]` contains JSON `config` and `state`. Config is read-only
within a run and comes from the current request. State belongs to its module;
validated models are copies, so mutations require explicit
`entry["state"] = state.model_dump(mode="json")` writeback. Stateful tools that
read and modify across awaits execute sequentially.

`deps.services` borrows lifespan clients and server settings. `deps.resources`
holds only operation leases, shell sessions and temporary credentials. The
capability that acquires a resource releases it in `wrap_run` using `finally`,
including failures and cancellation. The API owns durable Binding/Workspace
retirement and saves snapshots in the owning session.

Registered production names are `agent_soul_prompt`, `workflow_node_job_prompt`,
`workflow_user_prompt`, `agent_app_user_prompt`, `execution_context`, `runtime`,
`shell`, `config`, `history`, `llm`, `tools`, `core_tools`, `knowledge`, `output`,
plus `prompt` and `user_prompt` convenience names. HTTP input cannot supply an
import path. Cross-module references live in Config, for example
`execution_context`, `runtime`, and `shell`; the loader validates their targets
before I/O. Instruction ordering is unspecified. Native capability ordering
preserves Runtime → Shell → Config resource scopes.

An enabled Local runtime requires a nonblank deployment auth token matching
shellctl. When shellctl path isolation is enabled, Landlock setup errors abort
the job before its user script executes. Deployment settings may explicitly
disable path isolation. See the [operations guide](guide/index.md) for setup.

Model, output type, current user content and initial history use explicit runner
assembly and native Agent arguments. Knowledge eager results stay in the user
role through a native model-request hook. Tool dispatch, instructions and
capability hooks use native Pydantic AI interfaces.

The sandbox's installed `dify-agent` CLI can read the saved Agent Soul system
prompt with `dify-agent config prompt pull [--to PATH]`. It writes UTF-8 text to
`./.dify_conf/prompt.md` by default and prints the file's absolute path. The text
includes raw, unexpanded mention markers; whitespace and line endings are preserved.
The prompt is fetched separately and is not included in the config manifest.

To persist an edit, use `dify-agent config prompt push [PATH|-]`. Omitting PATH
reads the default file; `-` reads stdin. Push fully replaces the prompt and prints
`{"prompt": "saved text"}` as JSON. Empty text clears it. A missing file, invalid
UTF-8, missing prompt field, or JSON null is an error. Local edits alone do not
change Agent configuration.

Authenticated `GET/PUT /agent-stub/config/prompt` exchange `{"prompt": "raw text"}`
with `GET/PUT /inner/api/agent-config/<agent_id>/prompt`. The Stub derives tenant,
agent, user, and version scope solely from the signed execution context. Reads
follow snapshot, shared-draft, and personal build-draft access rules. Writes are
allowed only to the current account's build draft and only replace
`AgentSoulConfig.prompt.system_prompt`. Later requests built from that draft use
the saved prompt and resolve its mentions; already-built requests keep their
prompt. Draft merge and publication retain their existing lifecycle.

See [run lifecycle](concepts/run-lifecycle/index.md),
[resources](concepts/runtime-resources/index.md), and the
[operations guide](guide/index.md).

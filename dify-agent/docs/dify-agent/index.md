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

Model, output type, current user content and initial history use explicit runner
assembly and native Agent arguments. Knowledge eager results stay in the user
role through a native model-request hook. Tool dispatch, instructions and
capability hooks use native Pydantic AI interfaces.

See [run lifecycle](concepts/run-lifecycle/index.md),
[resources](concepts/runtime-resources/index.md), and the
[operations guide](guide/index.md).

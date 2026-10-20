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

See [run lifecycle](concepts/run-lifecycle/index.md),
[resources](concepts/runtime-resources/index.md), and the
[operations guide](guide/index.md).

Confirmed Builder Test Runs may borrow the existing ordinary Workspace for
configured CLI tools, skills and files. The immutable request and current API
Workspace owner are checked before acquiring the lease; each shell/bootstrap or
configuration pull spends its exact durable operation permit before command
execution. Config reads carry that claimed dispatch through the encrypted Agent
Stub token and strict Run-bound API transport. Config writes and generic file
upload/download remain unavailable in this profile.

Preparation waits retain their stage and resume through the same API ledger.
Completed results are read back; an unknown operation or lost claim response
never triggers automatic replay. The runtime releases its borrowed lease but
does not force-delete tracked jobs on confirmed Run exit. Workspace retirement
stays with its existing owner, and an HTTP timeout does not prove remote process
cleanup.

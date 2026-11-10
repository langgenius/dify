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

`DIFY_AGENT_INNER_API_URL` may include a reverse-proxy mount path, such as
`https://api.example.com/dify`. Ordinary and confirmed API clients retain that
prefix. The strict runtime transport sends its bearer only to the configured
origin, exact mount prefix and allowed runtime routes; redirects and encoded
route aliases remain rejected.

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

A configured service bearer also exposes the private Execution Binding
`POST /execution-bindings/keep-alive` operation. It accepts only `binding_ref`
and returns `supported`: Enterprise touches the existing sandbox through the
Gateway's shellctl health endpoint; Local, E2B and OpenShell return false without
performing health I/O. Health never allocates a replacement, runs a command,
spends a tool permit or retries a lost operation. Missing bindings return a fixed
410 `binding_lost`; other health failures return fixed502 diagnostics without
provider text or binding credentials. The endpoint is absent in anonymous
migration mode. The owning API decides whether a Run remains eligible for this
bounded infrastructure operation; the immutable test scope and grants are not renewed.

For confirmed native shell calls, the result callback may include a typed
`shell_job` receipt captured from the structured command result and the actual
borrowed lease's binding handle. The replayable result stays unchanged. Model
output, including tagged metadata printed by a script, never supplies this
receipt. Missing receipt evidence cannot authorize a completed-ACK config read.

Authenticated deployments expose `POST /execution-bindings/job-status`, selected
by `binding_ref` and `job_id`, through the SDK's `read_execution_binding_job`
(and synchronous `read_execution_binding_job_sync`). Local and Enterprise
connections issue only Shellctl's status GET and close their transient client;
they do not acquire or release a runtime, run a command, allocate a binding, or
refresh its TTL. The response contains only `job_id`, `status`, `done`, and
`exit_code`. Unsupported contexts, missing jobs, mismatched or inconsistent
responses, and transport failures refuse the read. Anonymous deployments do not
mount this route. A status response alone grants no execution or config access.

Authenticated deployments also expose private `POST /execution-bindings/inspect`
with exact `binding_ref` and `workspace_ref`, through `inspect_execution_binding`
and `inspect_execution_binding_sync`. Its immutable response binds those refs,
`adapter`, `state` (`usable`, `definitively_gone`, `uncertain`, `unsupported`) and
one bounded `evidence_code`. Local runs a fixed read-only Python probe through
shellctl: accessible configured roots and exact directory paths prove usability;
only exact `lstat` ENOENT/ENOTDIR under validated roots proves absence. Symlinks,
permissions, inaccessible roots, malformed output and transport errors remain
uncertain. The probe closes its client and deletes only its transient control
job. Inspection uses a single five-second absolute I/O deadline, measured
before lease construction, with one second reserved for bounded job deletion
and client/owned-transport close. Polling never renews this budget. Any probe
or cleanup timeout/error yields uncertainty; cleanup warnings include only
fixed phase/category/status fields, without raw exceptions, paths or tracebacks.
A timed-out probe never proves remote process termination. Inspection never
acquires, creates or destroys a Binding or Workspace.

Enterprise first reads the existing sandbox's health endpoint; an exact healthy
response returns immediately. Otherwise one GET of the exact escaped retained ID
at `/v1/sandboxes/{id}` uses the same existing Gateway authentication and total
five-second budget (or the shorter configured proxy timeout). Only HTTP 404 with
integer `code: 404` and exact `reason: sandbox_not_found` in an unambiguous bounded
error object yields `definitively_gone` / `sandbox_not_found`. Generic/proxy/job
404, sandbox-expired, auth/transport errors, redirects and malformed/oversized or
foreign responses remain uncertain. Ambiguous path identifiers are refused.
Both reads cap response bodies at 4096 bytes and perform no retries. This is the
Gateway's exact control-plane resource absence contract, backed by its initialized
informer cache; it does not prove physical process death or absence of effects.
Replacement still requires all protected waiting-child, scope, generation,
reconstructibility, no-in-flight/no-unknown and fresh-consent checks. E2B,
OpenShell and native test scopes remain unsupported. Keep-alive's legacy 410 is
not inspection evidence. Inspection is absent in anonymous migration mode.
The shared confirmed-recovery relation and
handoff DTOs describe protected predecessor/successor refs and generations only;
parsing them performs no allocation, CAS, resume, model or tool invocation.

The private authenticated `POST /runs/{run_id}/confirmed-recovery-successor`
installs a protected successor only in an unclaimed, uncancelled confirmed wait.
`Client.install_confirmed_recovery_successor` and its synchronous counterpart
accept the typed request and return the exact durable receipt. A configured
confirmed API owner must independently authorize the selected immutable relation,
configurations, reconstruction manifest and checkpoint; parsing a request cannot
authorize a handoff. The first whitelist accepts only empty/default reconstructible
state with empty bootstrap and no jobs, dynamic files, eager pulls or pending
shell/file/bootstrap work. The API separately proves that every substituted
pending operation has never been attempted or physically claimed.

The Redis CAS preserves the original create digest and acceptance, retains the
predecessor immutably, selects the sanitized checkpoint and current config identity,
and emits one new wait event. Repeating the identical request reads back its
receipt without scheduling; conflicting selection, cancellation, active claims,
changed checkpoints and missing original waits refuse the handoff. History,
completed result references, original call IDs and the operation cursor remain
unchanged. Fresh pending keys include the workspace recovery generation and
require current API decisions. Old config identities cannot claim, stop, save a
checkpoint or send through a stale runtime scope. Handoff runs no model, tool,
bootstrap or binding lifecycle operation. API readiness alone still cannot resume
the child until the successor receipt and refreshed wait are durably acknowledged.

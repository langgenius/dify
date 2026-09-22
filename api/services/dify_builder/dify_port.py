"""The real ``DifyPort`` adapter -- direct in-process calls into Dify's own services.

Port of dify-enterprise/server/pkg/enterprise/data/dify_builder_dify.go, minus the
token-forwarding (the P1 port plan's Global Constraints / ADR drop
``ForwardAuth`` entirely -- see ``core.dify_builder.ports.DifyPort``).

``WorkflowServiceDifyPort`` wires the pure P1 domain (``core.dify_builder``)
and the pure Task 1-3 helpers in this package (``graph_ops``, ``run_mapping``,
``identity``) to ``WorkflowService`` / ``AppGenerateService`` / the node-
execution repository. It satisfies ``DifyPort`` structurally (the Protocol is
``@runtime_checkable``) -- there is no explicit inheritance.

Each method opens its own ``Session`` via
``sessionmaker(bind=db.engine, expire_on_commit=False)`` and resolves
account/app through the Task 3 helpers. The OSS gotchas baked in here (see
the P2 plan's Global Constraints):

- ``sync_draft_workflow`` has no server-side patch primitive -- ``apply_repair``
  reads the whole draft graph, mutates it client-side via
  ``graph_ops.apply_set_node_config``, and writes the whole mutated graph
  back with ``graph_only=True``/``sync_agent_bindings=False`` so only the
  graph changes, nothing else. A ``WorkflowHashNotEqualError`` (the draft
  changed since it was read) is re-mapped to the domain ``HashMismatchError``.
- ``run_draft`` invokes ``AppGenerateService.generate`` with
  ``invoke_from=InvokeFrom.DEBUGGER`` (runs the *draft*, not the published
  workflow) and ``streaming=True``, so ``on_event`` fires while the run is
  still going instead of replaying finished rows afterwards. It selects
  ``workflow_execution_mode="in_process"`` so the native generator runs inside
  the existing Builder task. Enqueuing a child task and waiting for its stream
  deadlocks a worker that consumes both queues with only one execution slot.
  If the stream ends WITHOUT a terminal frame, the
  outcome is recovered from the workflow-run row rather than synthesised as a
  failure -- reporting a run that actually succeeded as failed would feed the
  repair loop a lie.
- ``publish`` MUST update ``app.workflow_id`` in the same transaction as
  ``publish_workflow``: ``publish_workflow`` only creates the new published
  ``Workflow`` row: it does not repoint the app at it. Skipping that update
  makes publish a silent no-op. The agent-retirement tail
  (``WorkflowAgentRetirementService.retire_unowned`` /
  ``enqueue_agent_resource_collection``) is intentionally skipped -- it only
  matters for Agent-node workflows and is not part of this port's contract.
"""

from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.dify_builder.changes import describe_changed_nodes
from core.dify_builder.contract import CanvasEvent
from core.dify_builder.models import (
    Actor,
    ApplyResult,
    Graph,
    Inputs,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    Run,
)
from core.workflow import graph_normalizers
from extensions.ext_database import db
from graphon.enums import BuiltinNodeTypes
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import set_login_user
from models.account import Account
from models.model import App
from models.workflow import Workflow
from repositories.factory import DifyAPIRepositoryFactory
from services.app_generate_service import AppGenerateService
from services.dify_builder import graph_ops
from services.dify_builder.errors import HashMismatchError, PreflightError, WorkflowNotInitializedError
from services.dify_builder.identity import load_app, resolve_account
from services.dify_builder.preflight import preflight_errors
from services.dify_builder.revision import execution_revision
from services.dify_builder.run_mapping import (
    error_from_stream_chunk,
    is_unfinished_run_status,
    map_error_frame_run,
    map_run_result,
    map_unknown_run_outcome,
    node_event_from_stream_chunk,
    run_id_from_stream_chunk,
    run_result_data_from_run_row,
    run_result_data_from_terminal_chunk,
    stream_chunk_as_mapping,
)
from services.errors.app import WorkflowHashNotEqualError
from services.workflow_draft_sync_service import notify_workflow_draft_changed
from services.workflow_service import WorkflowService

__all__ = ["WorkflowServiceDifyPort"]


_CREATE_NODE_CANVAS_EVENTS: dict[str, CanvasEvent] = {
    BuiltinNodeTypes.START: CanvasEvent.ADD_START_NODE,
    BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: CanvasEvent.ADD_KNOWLEDGE_NODE,
    BuiltinNodeTypes.LLM: CanvasEvent.ADD_LLM_NODE,
    BuiltinNodeTypes.END: CanvasEvent.ADD_OUTPUT_NODE,
}


def _canvas_event_for_intent(intent: MutationIntent) -> CanvasEvent:
    """Map an applied ``MutationIntent`` to the canvas event that narrates it
    (spec Sec 6). ``create_node`` dispatches by ``node_type`` to the matching
    ``add_*_node`` event; ``set_node_config`` (Fix's only verb today) maps to
    ``apply_error_fix``; every other verb (``delete_node``/``connect``/
    ``insert_between``) and any unmapped ``node_type`` default to the
    generic ``apply_edit_plan`` batch-mutation event.
    """
    if intent.op == "create_node":
        return _CREATE_NODE_CANVAS_EVENTS.get(intent.args.get("node_type", ""), CanvasEvent.APPLY_EDIT_PLAN)
    if intent.op == "set_node_config":
        return CanvasEvent.APPLY_ERROR_FIX
    return CanvasEvent.APPLY_EDIT_PLAN


def _canvas_payload(intent: MutationIntent, changed: list[str]) -> dict[str, Any]:
    """Build the ``{"event": ..., "node_id"?/"edge"?}`` dict passed to ``on_canvas``."""
    payload: dict[str, Any] = {"event": str(_canvas_event_for_intent(intent))}
    if intent.op == "connect":
        payload["edge"] = {"source": intent.args.get("from_node"), "target": intent.args.get("to_node")}
    elif intent.op == "delete_node":
        payload["node_id"] = intent.args.get("node_id")
    else:  # create_node | insert_between | set_node_config
        payload["node_id"] = changed[0] if changed else None
    return payload


def _session_factory() -> sessionmaker[Session]:
    """One session per adapter call -- never shared/held across calls."""
    return sessionmaker(bind=db.engine, expire_on_commit=False)


def _unwrap_status(status: Any) -> Any:
    """Unwrap a ``graphon`` ``StrEnum``'s ``.value`` if present, else pass through.

    Mirrors ``run_mapping._status_value`` locally so this module doesn't reach
    into another module's private helper.
    """
    return getattr(status, "value", status)


def _load_draft_workflow_or_raise(app: App, *, session: Session) -> Workflow:
    workflow = WorkflowService().get_draft_workflow(app, session=session)
    if workflow is None:
        raise WorkflowNotInitializedError(f"app has no draft workflow: {app.id}")
    return workflow


def _sync_graph_only(
    app: App,
    graph: Graph,
    workflow: Workflow,
    unique_hash: str,
    account: Account,
    session: Session,
    app_id: str,
) -> Workflow:
    """Write ``graph`` back to the draft via the graph-only sync both
    ``apply_repair`` and ``restore_graph`` use (no server-side patch
    primitive -- see the module docstring). Remaps
    ``WorkflowHashNotEqualError`` (the draft changed since it was read) to
    the domain ``HashMismatchError``."""
    try:
        return WorkflowService().sync_draft_workflow(
            app_model=app,
            graph=graph,
            features=dict(workflow.features_dict),
            unique_hash=unique_hash,
            account=account,
            environment_variables=[],
            conversation_variables=workflow.conversation_variables,
            session=session,
            graph_only=True,
            sync_agent_bindings=False,
            commit=True,
            preserve_environment_variables=True,
        )
    except WorkflowHashNotEqualError as exc:
        raise HashMismatchError(f"draft workflow changed since read: {app_id}") from exc


class WorkflowServiceDifyPort:
    """``DifyPort`` implementation backed directly by Dify's own services."""

    def read_graph(self, app_id: str, actor: Actor) -> tuple[Graph, str]:
        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            return dict(workflow.graph_dict), execution_revision(workflow)

    def node_outputs(self, app_id: str, actor: Actor, run_id: str) -> list[NodeOutput]:
        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            tenant_id = app.tenant_id

        node_execs = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            sessionmaker(bind=db.engine)
        ).get_executions_by_workflow_run(tenant_id, app_id, run_id)

        return [
            NodeOutput(
                node_id=node_exec.node_id,
                title=node_exec.title,
                status=_unwrap_status(node_exec.status),
                error=node_exec.error or "",
                inputs=node_exec.inputs_dict or {},
                outputs=node_exec.outputs_dict or {},
            )
            for node_exec in node_execs
        ]

    def apply_repair(
        self,
        app_id: str,
        actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict], None] | None = None,
        *,
        expected_revision: str,
    ) -> ApplyResult:
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)

            # Lock AND refresh before inspecting the graph: this Session may
            # already contain an older Workflow in its identity map. Keep the
            # execution check and mutation in the same short transaction.
            session.refresh(workflow, with_for_update=True)
            revision = execution_revision(workflow)
            if revision != expected_revision:
                raise HashMismatchError(f"workflow execution configuration changed: {app_id}")

            before_graph: Graph = dict(workflow.graph_dict)
            graph: Graph = before_graph
            unique_hash = workflow.unique_hash

            # Idempotent re-entry (interrupted-step Retry): a re-applied fix.apply
            # re-sends the same intents against an already-mutated draft. Drop
            # create_node for an id already present and connect for an edge already
            # present so the re-apply is a clean no-op. Uses the ORIGINAL draft graph
            # (before_graph) as the reference, so an in-batch duplicate of a NEW id
            # still reaches graph_ops and raises (validation preserved).
            #
            # Mirror handlers_build.py's M2 guard: ids targeted by a delete_node in
            # THIS SAME batch must not count as "already present" for the filter
            # above. A from-scratch build sends delete_node(placeholder_start) +
            # create_node(same id) in one batch (recreating the id the placeholder
            # occupied); without this exclusion the create_node would be dropped as
            # already-present while the delete_node still runs, deleting the node
            # with no re-create.
            _deleted_ids = {i.args.get("node_id") for i in intents if i.op == "delete_node"}
            _present_node_ids = {n.get("id") for n in before_graph.get("nodes", [])} - _deleted_ids
            _present_edges = {
                (e.get("source"), e.get("target"))
                for e in before_graph.get("edges", [])
                if e.get("source") not in _deleted_ids and e.get("target") not in _deleted_ids
            }

            def _already_present(intent: MutationIntent) -> bool:
                if intent.op == "create_node":
                    return intent.args.get("node_id") in _present_node_ids
                if intent.op == "connect":
                    return (intent.args.get("from_node"), intent.args.get("to_node")) in _present_edges
                return False

            intents = [intent for intent in intents if not _already_present(intent)]

            changed_nodes: list[str] = []
            for intent in intents:
                apply_fn = graph_ops.APPLY_FNS.get(intent.op)
                if apply_fn is None:
                    continue
                graph_ops.validate_intent_args(intent)
                graph, changed = apply_fn(graph, **intent.args)
                changed_nodes.extend(changed)
                if on_canvas is not None:
                    on_canvas(_canvas_payload(intent, changed))

            if not changed_nodes:
                return ApplyResult(
                    changed_nodes=[],
                    new_hash=revision,
                    changes=[],
                    scope="",
                    structure_fingerprint=graph_ops.structural_fingerprint(before_graph),
                )

            # The same pure value repairs the generator's postprocess applies
            # (core.workflow.graph_normalizers), for the intents the generator
            # never saw: a Fix/Edit repair that writes a condition value as a
            # JSON number (ESQ1-285's flip-flop) or an http body item without
            # ``type``. Must run BEFORE the preflight, which would reject them.
            # Both scan every node in ``graph``, not just the ones the intents
            # named, so a node they heal may not be in ``changed_nodes`` yet --
            # fold their returned ids in (order-preserving, deduped) so it
            # agrees with ``diff_graphs`` below, which sees the healed node too.
            healed_ids = [
                *graph_normalizers.normalize_condition_values(graph.get("nodes", [])),
                *graph_normalizers.normalize_http_request_bodies(graph.get("nodes", [])),
            ]
            for node_id in healed_ids:
                if node_id not in changed_nodes:
                    changed_nodes.append(node_id)

            # Dry-validate what the draft would become. Whatever raises here
            # would raise at Graph.init and kill the very first test run
            # (ESQ1-302 and ESQ1-303 both died there). Only NEW problems count:
            # a pre-existing broken node the repair did not touch must not veto
            # an unrelated fix -- and a repair that heals it passes.
            known_problems = set(preflight_errors(before_graph))
            new_problems = [problem for problem in preflight_errors(graph) if problem not in known_problems]
            if new_problems:
                raise PreflightError("the draft would not start: " + "; ".join(new_problems))

            changes, scope = graph_ops.diff_graphs(before_graph, graph)

            updated = _sync_graph_only(app, graph, workflow, unique_hash, account, session, app_id)
            notify_workflow_draft_changed(updated, previous_graph=before_graph)

            return ApplyResult(
                changed_nodes=changed_nodes,
                nodes=describe_changed_nodes(changed_nodes, before_graph, graph),
                new_hash=execution_revision(updated),
                changes=changes,
                scope=scope,
                structure_fingerprint=graph_ops.structural_fingerprint(graph),
            )

    def structural_fingerprint(self, graph: Graph) -> str:
        return graph_ops.structural_fingerprint(graph)

    def graph_node_ids(self, graph: Graph) -> list[str]:
        return graph_ops.node_ids(graph)

    def restore_graph(self, app_id: str, actor: Actor, graph: Graph, *, expected_revision: str) -> str:
        """Restore the draft to a prior snapshot graph (Slice 4 revert): write
        the whole graph back via the same graph-only sync apply_repair uses.
        Returns the new execution revision. Raises HashMismatchError if the
        execution configuration changed since the caller read it."""
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            session.refresh(workflow, with_for_update=True)
            if execution_revision(workflow) != expected_revision:
                raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
            updated = _sync_graph_only(app, graph, workflow, workflow.unique_hash, account, session, app_id)
            notify_workflow_draft_changed(updated)
            return execution_revision(updated)

    def run_draft(
        self,
        app_id: str,
        actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
        *,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
    ) -> Run:
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            tenant_id = app.tenant_id

            # Match the native workflow task's user context before the runtime
            # copies it into its execution thread/greenlet.
            set_login_user(account)
            # The native generator prepares its configuration eagerly and its
            # execution thread owns its own Session. Consume the event stream
            # outside this block rather than pinning this DB connection.
            response = AppGenerateService.generate(
                app_model=app,
                user=account,
                args={"inputs": inputs},
                invoke_from=InvokeFrom.DEBUGGER,
                session=session,
                streaming=True,
                workflow_execution_mode="in_process",
            )

        final: dict[str, Any] = {}
        stream_run_id = ""
        # The first explicit ``event: error`` frame, if any. It is NOT a
        # terminal frame (no run status), so it is only consulted when no
        # terminal frame arrives -- see ``_finish_run``.
        error_frame: dict[str, str] | None = None

        # A completed mapping response carries terminal data directly. Iterating
        # its keys as stream chunks would lose the run ID and final status.
        if isinstance(response, Mapping):
            final = dict(response.get("data") or {})
            if not final.get("id"):
                final["id"] = str(response.get("workflow_run_id") or "")
            return self._finish_run(tenant_id, app_id, final, stream_run_id="")

        try:
            for chunk in response:
                # Streaming yields SSE-formatted strings ("data: {...}" events
                # and "event: ping" keep-alives), not dicts.
                payload = stream_chunk_as_mapping(chunk)
                if payload is None:
                    continue
                if on_workflow_event is not None:
                    on_workflow_event(payload)
                # Lifecycle events identify the run before its terminal frame
                # arrives; Chatflow message events may omit the run ID.
                stream_run_id = stream_run_id or run_id_from_stream_chunk(payload)
                node_event = node_event_from_stream_chunk(payload)
                if node_event is not None:
                    on_event(node_event)
                    continue
                terminal = run_result_data_from_terminal_chunk(payload)
                if terminal is not None:
                    final = terminal
                error_frame = error_frame or error_from_stream_chunk(payload)
        finally:
            # In streaming mode ``_run_with_guardrails`` does NOT release the
            # app's rate-limit slot; only closing the generator does. Normal
            # exhaustion self-closes, so this only matters when ``on_event``
            # raises -- but a leaked slot blocks every later test run.
            close = getattr(response, "close", None)
            if callable(close):
                close()

        return self._finish_run(tenant_id, app_id, final, stream_run_id, error_frame=error_frame)

    def _finish_run(
        self,
        tenant_id: str,
        app_id: str,
        final: dict[str, Any],
        stream_run_id: str,
        *,
        error_frame: dict[str, str] | None = None,
    ) -> Run:
        """Turn the run's terminal data into a ``Run``. Shared by the blocking
        and streaming paths so they can never disagree about the outcome.

        Precedence: terminal frame > error frame > nothing. A stream that ended
        on an explicit error frame is a FAILED run carrying that error; only a
        stream that ended with neither is an unknown outcome.
        """
        run_id = str(final.get("id") or stream_run_id or "")

        # Backend diagnosis still uses persisted node-execution rows to build
        # ``per_node[].outputs``; the frontend consumes the full event stream.
        node_execs = (
            DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
                sessionmaker(bind=db.engine)
            ).get_executions_by_workflow_run(tenant_id, app_id, run_id)
            if run_id
            else []
        )

        if final:
            return map_run_result(final, node_execs)

        # The pipeline said the run threw (ESQ1-302: Graph.init rejected a node
        # before workflow_started, so there is no run row at all). That is a
        # failure with a reason, not an outcome we lost sight of.
        if error_frame is not None:
            return map_error_frame_run(error_frame, run_id, node_execs)

        # The stream ended without a terminal frame. The stream is no longer
        # the authority on how the run went; the database is. Synthesising
        # "failed" here would report a run that may well have SUCCEEDED as a
        # failed build and feed the repair loop a lie.
        return self._run_result_without_terminal_frame(tenant_id, app_id, run_id, node_execs)

    @staticmethod
    def _run_result_without_terminal_frame(tenant_id: str, app_id: str, run_id: str, node_execs: list[Any]) -> Run:
        """Recover a truncated stream's outcome from the workflow-run row."""
        run_row = (
            DifyAPIRepositoryFactory.create_api_workflow_run_repository(
                sessionmaker(bind=db.engine)
            ).get_workflow_run_by_id(tenant_id=tenant_id, app_id=app_id, run_id=run_id)
            if run_id
            else None
        )
        if run_row is None:
            # No id, or no row: nothing can say how this went.
            return map_unknown_run_outcome({"id": run_id}, node_execs)

        recovered = run_result_data_from_run_row(run_row)
        if is_unfinished_run_status(recovered["status"]):
            # The row says the run is still going, so its outcome is genuinely
            # unknown rather than bad.
            return map_unknown_run_outcome(recovered, node_execs)
        return map_run_result(recovered, node_execs)

    def publish(self, app_id: str, actor: Actor) -> None:
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)

            workflow = WorkflowService().publish_workflow(
                session=session,
                app_model=app,
                account=account,
            )

            app_in_session = session.get(App, app_id)
            assert app_in_session is not None, f"app disappeared mid-transaction: {app_id}"
            app_in_session.workflow_id = workflow.id
            app_in_session.updated_by = account.id
            app_in_session.updated_at = naive_utc_now()

            session.commit()

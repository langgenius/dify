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
  the existing Builder task. Every Builder run is admitted and bound to saved
  session/test-input identity before native generation; unsupported workflows
  return a typed refusal without a native run ID.
  Enqueuing a child task and waiting for its stream
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

import logging
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.workflow_ui_based_app.variables.manager import WorkflowVariablesConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.dify_builder.changes import describe_changed_nodes
from core.dify_builder.contract import CanvasEvent
from core.dify_builder.execution_policy import (
    BuilderExecutionContext,
    BuilderExecutionPolicyError,
    BuilderExecutionRecorder,
    BuilderExecutionRefusal,
    ExecutionEvidenceSummary,
    HttpFixtureSetV1,
    HttpResponseFixtureV1,
    TrustedExecutionCompletion,
    admit_restricted_workflow,
    admitted_node_bindings,
    scalar_inputs_digest,
)
from core.dify_builder.handlers_fix import run_finished_without_output
from core.dify_builder.models import (
    Actor,
    ApplyResult,
    Graph,
    Inputs,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    PublishResult,
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
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService, restricted_admission_snapshot
from services.dify_builder.identity import load_app, resolve_account
from services.dify_builder.node_policy import proposal_policy_rejections
from services.dify_builder.output_evidence import collect_output_findings
from services.dify_builder.preflight import new_preflight_problems
from services.dify_builder.revision import executable_graph_revision, execution_revision, merge_canvas_presentation
from services.dify_builder.run_mapping import (
    is_unfinished_run_status,
    map_error_frame_run,
    map_run_result,
    map_unknown_run_outcome,
    node_event_from_stream_chunk,
    run_id_from_stream_chunk,
    run_result_data_from_run_row,
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


@dataclass
class _BuilderExecutionLaunch:
    """One invocation's admission and recorder, retained by the completion owner."""

    service: BuilderExecutionPolicyService
    context: BuilderExecutionContext
    recorder: BuilderExecutionRecorder | None = None
    refusal: BuilderExecutionPolicyError | None = None
    _lock: threading.Lock = field(default_factory=threading.Lock, init=False)
    _launch_thread: threading.Thread = field(default_factory=threading.current_thread, init=False)
    _preworker_refusal: BuilderExecutionPolicyError | None = field(default=None, init=False)
    _claim: tuple[str, str] | None = field(default=None, init=False)
    _candidate: tuple[threading.Thread, str, str, Literal["returned", "policy_refused", "stopped", "failed"]] | None = (
        field(default=None, init=False)
    )
    _invalid: bool = field(default=False, init=False)
    _completion: TrustedExecutionCompletion | None = field(default=None, init=False)
    finalization_closed: bool = field(default=False, init=False)

    def on_worker_finished(
        self,
        *,
        context: BuilderExecutionContext,
        native_run_id: str,
        task_id: str,
        recorder: BuilderExecutionRecorder | None,
        worker_thread: threading.Thread,
        exit_kind: Literal["returned", "policy_refused", "stopped", "failed"],
    ) -> None:
        with self._lock:
            try:
                if (
                    context != self.context
                    or worker_thread is not threading.current_thread()
                    or recorder is not self.recorder
                    or (self._claim is not None and self._claim != (native_run_id, task_id))
                    or self._preworker_refusal is not None
                    or exit_kind not in {"returned", "policy_refused", "stopped", "failed"}
                ):
                    raise BuilderExecutionPolicyError("invalid_worker_completion")
                candidate = (worker_thread, native_run_id, task_id, exit_kind)
                if self._candidate is not None and self._candidate != candidate:
                    raise BuilderExecutionPolicyError("conflicting_worker_completion")
                if not self.finalization_closed:
                    self._candidate = candidate
            except BaseException:
                self._invalid = True
                raise

    def finish(
        self, *, response_completed: bool, setup_refusal: BuilderExecutionPolicyError | None = None
    ) -> TrustedExecutionCompletion:
        """One nonblocking snapshot after the native response's existing close/join."""
        with self._lock:
            if self._completion is not None:
                return self._completion
            self.finalization_closed = True
            candidate = self._candidate
            finished = candidate is not None and not self._invalid and not candidate[0].is_alive()
            preworker = (
                self._preworker_refusal is not None
                and self._preworker_refusal is self.refusal
                and not self._invalid
                and self._claim is None
                and self.recorder is None
                and candidate is None
            )
            self._completion = TrustedExecutionCompletion(
                context=self.context,
                native_run_id=self._claim[0] if self._claim else None,
                task_id=self._claim[1] if self._claim else None,
                worker_finished=finished,
                worker_exit=candidate[3] if candidate is not None else "not_observed",
                recorder_healthy=self.recorder is not None and self.recorder.healthy and not self._invalid,
                response_completed=(
                    response_completed if setup_refusal is None else preworker and self.refusal is setup_refusal
                ),
                preworker_refusal=preworker,
                refusal=BuilderExecutionRefusal(reason_code=self.refusal.reason_code) if self.refusal else None,
            )
            return self._completion

    def on_refusal(self, error: BuilderExecutionPolicyError, *, preworker: bool = False) -> None:
        with self._lock:
            if preworker and (
                threading.current_thread() is not self._launch_thread
                or self._claim is not None
                or self.recorder is not None
                or self._candidate is not None
                or self._invalid
                or self.finalization_closed
                or (self.refusal is not None and self.refusal is not error)
            ):
                self._invalid = True
                raise BuilderExecutionPolicyError("invalid_preworker_refusal")
            if self._preworker_refusal is not None and self._preworker_refusal is not error:
                self._invalid = True
            if not self.finalization_closed:
                self.refusal = error
                if preworker:
                    self._preworker_refusal = error

    def admit_raw(self, workflow: Workflow, app: App) -> None:
        admit_restricted_workflow(self.context, restricted_admission_snapshot(workflow, app))

    def __call__(
        self,
        workflow: Workflow,
        app: App,
        entity: WorkflowAppGenerateEntity,
        root_node_id: str,
        resume: bool,
    ) -> BuilderExecutionRecorder:
        try:
            config = entity.app_config
            if (
                entity.builder_execution != self.context
                or entity.files
                or entity.single_iteration_run is not None
                or entity.single_loop_run is not None
                or entity.invoke_from != InvokeFrom.DEBUGGER
                or (config.app_id, config.tenant_id, config.workflow_id, config.app_mode)
                != (app.id, app.tenant_id, workflow.id, "workflow")
            ):
                raise BuilderExecutionPolicyError("execution_owner_mismatch")
            self.service.revalidate(
                context=self.context,
                workflow=workflow,
                app=app,
                actor_id=entity.user_id,
                effective_inputs=dict(entity.inputs),
                root_node_id=root_node_id,
                call_depth=entity.call_depth,
                transport="in_process",
                resume=resume,
            )
            self.service.claim_launch(
                context=self.context,
                native_run_id=entity.workflow_execution_id,
                task_id=entity.task_id,
            )
            with self._lock:
                if self._preworker_refusal is not None:
                    self._invalid = True
                self._claim = (entity.workflow_execution_id, entity.task_id)
            recorder = self.service.recorder(
                context=self.context,
                native_run_id=entity.workflow_execution_id,
                task_id=entity.task_id,
            )
            with self._lock:
                self.recorder = recorder
            return recorder
        except BuilderExecutionPolicyError as error:
            self.on_refusal(error)
            raise


def _unsupported_run(error: BuilderExecutionPolicyError) -> Run:
    return Run(status="failed", execution_refusal=BuilderExecutionRefusal(reason_code=error.reason_code))


class WorkflowServiceDifyPort:
    """``DifyPort`` implementation backed directly by Dify's own services."""

    def stamp_http_fixtures(
        self, app_id: str, actor: Actor, *, base_app_revision: str, fixtures: tuple[HttpResponseFixtureV1, ...]
    ) -> HttpFixtureSetV1:
        from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService

        return BuilderExecutionPolicyService(_session_factory()).stamp_http_fixtures(
            app_id, actor, base_app_revision=base_app_revision, fixtures=fixtures
        )

    def get_app_mode(self, app_id: str, actor: Actor) -> str:
        """Read mode from the persisted app using the same tenant guard as graphs."""
        with _session_factory()() as session:
            return load_app(session, app_id, actor).mode

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
                outputs_available=isinstance(node_exec.outputs_dict, Mapping)
                and not getattr(node_exec, "outputs_truncated", False),
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
        # Build and validate against a snapshot outside the write transaction.
        # The final row lock rechecks this revision before replacing the graph.
        before_graph, revision = self.read_graph(app_id, actor)
        if revision != expected_revision:
            raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
        # A direct write must enforce the same boundary as candidate preflight.
        # Check after the owner/revision read and before any mutation or events.
        policy_rejections = proposal_policy_rejections(before_graph, intents)
        if policy_rejections:
            raise PreflightError("Builder node policy: " + "; ".join(policy_rejections))
        graph: Graph = before_graph

        # Idempotent re-entry (interrupted-step Retry): a re-applied fix.apply
        # re-sends the same intents against an already-mutated draft. Drop
        # create_node for an id already present and connect for an edge already
        # present so the re-apply is a clean no-op. Uses the ORIGINAL draft graph
        # (before_graph) as the reference, so an in-batch duplicate of a NEW id
        # still reaches graph_ops and raises (validation preserved).
        #
        # The rule itself lives in graph_ops (including handlers_build.py's M2
        # guard for a delete_node + create_node of the same id in one batch),
        # because graph_ops.filter_applicable's dry run has to skip exactly what
        # this drops: otherwise the dry run rejects a duplicate create_node the
        # write would have quietly no-op'd, and burns the corrective re-prompt.
        _already_present = graph_ops.already_present_predicate(before_graph, intents)
        intents = [intent for intent in intents if not _already_present(intent)]

        changed_nodes: list[str] = []
        canvas_events: list[dict[str, Any]] = []
        # The nodes whose DATA this batch wrote, which is a narrower set
        # than the change set and is kept separately for that reason: the
        # preflight below gives a node in it no exemption at all, so an id
        # that lands here wrongly turns someone else's pre-existing defect
        # into a veto. ``connect`` writes an EDGE -- ``apply_connect``
        # reports both endpoints, correctly for a diff, but adding an edge
        # cannot change either endpoint's ``validate_node_config`` verdict.
        # Mirrors ``graph_ops.filter_applicable``, which must produce the
        # same set or the dry run would be predicting a different write.
        written_nodes: list[str] = []
        for intent in intents:
            apply_fn = graph_ops.APPLY_FNS.get(intent.op)
            if apply_fn is None:
                continue
            graph_ops.validate_intent_args(intent)
            graph, changed = apply_fn(graph, **intent.args)
            changed_nodes.extend(changed)
            if intent.op != "connect":
                written_nodes.extend(changed)
            if on_canvas is not None:
                canvas_events.append(_canvas_payload(intent, changed))

        if not changed_nodes:
            with _session_factory()() as session:
                app = load_app(session, app_id, actor)
                workflow = _load_draft_workflow_or_raise(app, session=session)
                session.refresh(workflow, with_for_update=True)
                if execution_revision(workflow) != revision:
                    raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
            return ApplyResult(
                changed_nodes=[],
                new_hash=revision,
                changes=[],
                scope="",
                structure_fingerprint=graph_ops.structural_fingerprint(before_graph),
            )

        # ``written_nodes`` is complete at this point and is deliberately
        # NOT extended by the heal below: the healer scans the whole graph,
        # so a node it merely normalized is not one this batch is
        # answerable for.
        #
        # The deterministic heal set every pre-preflight caller shares
        # (core.workflow.graph_normalizers.heal_nodes_for_preflight), for
        # the intents the generator never saw: a Fix/Edit repair that
        # writes an ASCII comparison operator (F4's ``>=``) or a condition
        # value as a JSON number (ESQ1-285's flip-flop), an http body item
        # without ``type``, or a parameter-extractor ``query`` written as
        # an array of selector arrays (Blocker A). Must run BEFORE the
        # preflight, which would reject them. It scans every node in
        # ``graph``, not just the ones the intents named, so a node it
        # heals may not be in ``changed_nodes`` yet -- fold its returned
        # ids in (order-preserving, deduped) so it agrees with
        # ``diff_graphs`` below, which sees the healed node too.
        healed_ids = graph_normalizers.heal_nodes_for_preflight(graph.get("nodes", []))
        for node_id in healed_ids:
            if node_id not in changed_nodes:
                changed_nodes.append(node_id)

        # Dry-validate what the draft would become. Whatever raises here
        # would raise at Graph.init and kill the very first test run
        # (ESQ1-302 and ESQ1-303 both died there). A node this batch WROTE
        # must be startable -- a repair that leaves its own culprit refused
        # is not a repair, however little it changed about why. Every other
        # node keeps the new-problems-only exemption: one the repair did not
        # touch must not veto an unrelated fix, and a repair that heals it
        # passes. The same function the Edit/Fix dry run predicts this
        # refusal with (``preflight.vet_intents``), on the same ``touched``
        # set, so the two cannot answer differently.
        new_problems = new_preflight_problems(before_graph, graph, written_nodes)
        if new_problems:
            raise PreflightError("the draft would not start: " + "; ".join(new_problems))

        changes, scope = graph_ops.diff_graphs(before_graph, graph)
        nodes = describe_changed_nodes(changed_nodes, before_graph, graph)
        fingerprint = graph_ops.structural_fingerprint(graph)

        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            session.refresh(workflow, with_for_update=True)
            if execution_revision(workflow) != revision:
                raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
            committed_previous_graph = dict(workflow.graph_dict)
            graph = merge_canvas_presentation(before_graph, graph, committed_previous_graph)
            updated = _sync_graph_only(app, graph, workflow, workflow.unique_hash, account, session, app_id)
            new_hash = execution_revision(updated)

        notify_workflow_draft_changed(updated, previous_graph=committed_previous_graph)
        if on_canvas is not None:
            for event in canvas_events:
                on_canvas(event)

        return ApplyResult(
            changed_nodes=changed_nodes,
            nodes=nodes,
            new_hash=new_hash,
            changes=changes,
            scope=scope,
            structure_fingerprint=fingerprint,
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
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None = None,
    ) -> Run:
        launch: _BuilderExecutionLaunch | None = None
        try:
            with _session_factory()() as session:
                account = resolve_account(session, actor)
                app = load_app(session, app_id, actor)
                tenant_id = app.tenant_id
                draft = _load_draft_workflow_or_raise(app, session=session)
                snapshot = restricted_admission_snapshot(draft, app)
                admitted_node_bindings(snapshot)
                scalar_inputs_digest(inputs)
                try:
                    effective_inputs = dict(
                        BaseAppGenerator()._prepare_user_inputs(
                            user_inputs=inputs,
                            variables=WorkflowVariablesConfigManager.convert(draft),
                            tenant_id=tenant_id,
                        )
                    )
                except ValueError:
                    raise BuilderExecutionPolicyError("unsupported_input_value") from None
                policy = BuilderExecutionPolicyService(_session_factory())
                context = policy.prepare(
                    session_id=session_id,
                    test_input_id=test_input_id,
                    app_id=app_id,
                    actor=actor,
                    workflow=draft,
                    submitted_inputs=inputs,
                    effective_inputs=effective_inputs,
                )
                launch = _BuilderExecutionLaunch(policy, context)
                set_login_user(account)
                response = AppGenerateService.generate(
                    app_model=app,
                    user=account,
                    args={"inputs": effective_inputs},
                    invoke_from=InvokeFrom.DEBUGGER,
                    session=session,
                    streaming=True,
                    workflow_execution_mode="in_process",
                    builder_execution=context,
                    builder_execution_admit=launch,
                )
        except BuilderExecutionPolicyError as error:
            if launch is None:
                return _unsupported_run(error)
            launch.on_refusal(error)
            return self._finalize_launch(launch, actor, response_completed=False, setup_refusal=error)
        except BaseException:
            if launch is not None:
                self._close_failed_launch(launch)
            raise

        completed = False
        primary: BaseException | None = None
        candidate_ids: set[str] = set()
        try:
            if isinstance(response, Mapping):
                candidate = str((response.get("data") or {}).get("id") or response.get("workflow_run_id") or "")
                if candidate:
                    candidate_ids.add(candidate)
            else:
                for chunk in response:
                    payload = stream_chunk_as_mapping(chunk)
                    if payload is None:
                        continue
                    if on_workflow_event is not None:
                        on_workflow_event(payload)
                    candidate = run_id_from_stream_chunk(payload)
                    if candidate:
                        candidate_ids.add(candidate)
                    node_event = node_event_from_stream_chunk(payload)
                    if node_event is not None:
                        on_event(node_event)
            completed = True
        except BaseException as error:
            primary = error
            raise
        finally:
            try:
                close = getattr(response, "close", None)
                if callable(close):
                    close()
            except BaseException:
                completed = False
                if primary is None:
                    self._close_failed_launch(launch)
                    raise
                logging.getLogger(__name__).warning("Builder response close failed after primary failure")
            finally:
                if primary is not None:
                    self._close_failed_launch(launch)
        return self._finalize_launch(launch, actor, response_completed=completed, candidate_ids=candidate_ids)

    @staticmethod
    def _close_failed_launch(launch: _BuilderExecutionLaunch) -> None:
        try:
            launch.service.seal(
                request_id=launch.context.request_id, completion=launch.finish(response_completed=False)
            )
        except Exception:
            logging.getLogger(__name__).warning("Builder incomplete execution could not be sealed")

    def _finalize_launch(
        self,
        launch: _BuilderExecutionLaunch,
        actor: Actor,
        *,
        response_completed: bool,
        candidate_ids: set[str] | None = None,
        setup_refusal: BuilderExecutionPolicyError | None = None,
    ) -> Run:
        completion = launch.finish(response_completed=response_completed, setup_refusal=setup_refusal)
        if candidate_ids and candidate_ids != {completion.native_run_id}:
            completion = completion.model_copy(update={"response_completed": False})
        try:
            summary = launch.service.seal(request_id=launch.context.request_id, completion=completion)
        except Exception:
            logging.getLogger(__name__).warning("Builder execution seal unavailable")
            summary = ExecutionEvidenceSummary(
                request_id=launch.context.request_id,
                mode=launch.context.mode,
                sealed=False,
                safety_outcome="execution_evidence_unknown",
                sandbox_profile=launch.context.sandbox_profile,
                fixture_digest=launch.context.fixture_digest,
            )
        # SQL status/outputs are authoritative; terminal SSE is only a consistency candidate.
        result = self._finish_run(launch.context.tenant_id, launch.context.app_id, {}, summary.native_run_id or "")
        run, _ = result
        if run.verification is None:
            from core.dify_builder.models import RunVerification

            run.verification = RunVerification(
                execution_revision="",
                executed_graph_revision="",
                terminal_outputs=None,
                output_findings=[],
                executed_node_ids=[],
                no_output_dead_branch=False,
            )
        run.verification.execution_evidence = summary
        if completion.refusal is not None:
            run.execution_refusal = completion.refusal
            if not summary.native_run_id:
                run.error = ""
                if summary.safety_outcome == "unsupported_safe_execution":
                    run.status = "failed"
        return self._bind_run(
            result, launch.context.app_id, actor, launch.context.execution_revision, launch.context.graph_revision
        )

    def graph_revision(self, graph: Graph) -> str:
        return executable_graph_revision(graph)

    def _bind_run(
        self,
        result: tuple[Run, Any],
        app_id: str,
        actor: Actor,
        before_revision: str,
        before_graph_revision: str,
        *,
        execution_recorder: BuilderExecutionRecorder | None = None,
    ) -> Run:
        """Bind only the actual persisted run graph and equal before/after full revisions.

        Native persistence does not snapshot non-graph configuration: a transient
        non-graph A→B→A change is outside this guarantee. No execution transaction
        is held open across stream consumption or provider I/O.
        """
        run, row = result
        if execution_recorder is not None and not execution_recorder.healthy:
            run.execution_refusal = BuilderExecutionRefusal(reason_code="execution_recorder_unhealthy")
            return run
        native_graph = getattr(row, "graph_dict", None)
        evidence = run.verification
        if evidence is None or not isinstance(native_graph, dict) or not isinstance(native_graph.get("nodes"), list):
            return run
        native_revision = executable_graph_revision(native_graph)
        evidence.executed_graph_revision = native_revision
        evidence.output_findings = collect_output_findings(native_graph, run.per_node)
        evidence.no_output_dead_branch = run_finished_without_output(native_graph, run.per_node)
        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            draft = _load_draft_workflow_or_raise(app, session=session)
            try:
                restricted_admission_snapshot(draft, app)
            except BuilderExecutionPolicyError as error:
                run.execution_refusal = BuilderExecutionRefusal(reason_code=error.reason_code)
                return run
            graph, after_revision = dict(draft.graph_dict), execution_revision(draft)
        if (
            before_revision
            and before_revision == after_revision
            and native_revision == before_graph_revision == executable_graph_revision(graph)
        ):
            evidence.execution_revision = before_revision
        return run

    def _finish_run(
        self,
        tenant_id: str,
        app_id: str,
        final: dict[str, Any],
        stream_run_id: str,
        *,
        error_frame: dict[str, str] | None = None,
    ) -> tuple[Run, Any]:
        """Turn the run's terminal data into a ``Run``. Shared by the blocking
        and streaming paths so they can never disagree about the outcome.

        Precedence: terminal frame > error frame > nothing. A stream that ended
        on an explicit error frame is a FAILED run carrying that error; only a
        stream that ended with neither is an unknown outcome.
        """
        run_id = str(final.get("id") or stream_run_id or "")

        run_row = (
            DifyAPIRepositoryFactory.create_api_workflow_run_repository(
                sessionmaker(bind=db.engine)
            ).get_workflow_run_by_id(tenant_id=tenant_id, app_id=app_id, run_id=run_id)
            if run_id
            else None
        )

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
            return map_run_result(final, node_execs), run_row

        # The pipeline said the run threw (ESQ1-302: Graph.init rejected a node
        # before workflow_started, so there is no run row at all). That is a
        # failure with a reason, not an outcome we lost sight of.
        if error_frame is not None:
            return map_error_frame_run(error_frame, run_id, node_execs), run_row

        # The stream ended without a terminal frame. The stream is no longer
        # the authority on how the run went; the database is. Synthesising
        # "failed" here would report a run that may well have SUCCEEDED as a
        # failed build and feed the repair loop a lie.
        return self._run_result_without_terminal_frame(run_id, node_execs, run_row), run_row

    @staticmethod
    def _run_result_without_terminal_frame(run_id: str, node_execs: Sequence[Any], run_row: Any) -> Run:
        """Recover a truncated stream's outcome from the scoped workflow-run row."""
        if run_row is None:
            # No id, or no row: nothing can say how this went.
            return map_unknown_run_outcome({"id": run_id}, node_execs)

        recovered = run_result_data_from_run_row(run_row)
        if is_unfinished_run_status(recovered["status"]):
            # The row says the run is still going, so its outcome is genuinely
            # unknown rather than bad.
            return map_unknown_run_outcome(recovered, node_execs)
        return map_run_result(recovered, node_execs)

    def publish(
        self, app_id: str, actor: Actor, *, expected_revision: str, expected_graph_revision: str
    ) -> PublishResult:
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)

            draft = _load_draft_workflow_or_raise(app, session=session)
            session.refresh(draft, with_for_update=True)
            if (
                not expected_revision
                or not expected_graph_revision
                or execution_revision(draft) != expected_revision
                or executable_graph_revision(dict(draft.graph_dict)) != expected_graph_revision
            ):
                raise HashMismatchError(f"workflow verification is stale: {app_id}")
            # Reselect only this locked identity, even if duplicate draft rows exist.
            workflow = WorkflowService().publish_workflow(
                session=session,
                app_model=app,
                account=account,
                expected_draft_id=draft.id,
            )

            app_in_session = session.get(App, app_id)
            assert app_in_session is not None, f"app disappeared mid-transaction: {app_id}"
            app_in_session.workflow_id = workflow.id
            app_in_session.updated_by = account.id
            app_in_session.updated_at = naive_utc_now()

            session.commit()
            return PublishResult(
                version_name=getattr(workflow, "marked_name", None) or f"# {workflow.version_number}",
                status="live",
            )

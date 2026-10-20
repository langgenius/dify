"""The real ``DifyPort`` adapter -- direct in-process calls into Dify's own services.

Port of dify-enterprise/server/pkg/enterprise/data/dify_builder_dify.go, minus the
token-forwarding (the P1 port plan's Global Constraints / ADR drop
``ForwardAuth`` entirely -- see ``services.dify_builder.application.ports.DifyPort``).

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
  back with ``graph_only=True``/``sync_agent_bindings=False``. Confirmed native
  Agent selections use one binding owner in the same graph transaction; all
  final Agent nodes must be explicitly selected and prepared before sync. A ``WorkflowHashNotEqualError`` (the draft
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

import hashlib
import json
import logging
import threading
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Any, Literal
from uuid import NAMESPACE_URL, uuid4, uuid5

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.app_config.workflow_ui_based_app.variables.manager import WorkflowVariablesConfigManager
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.dify_builder.changes import describe_changed_nodes
from core.dify_builder.contract import CanvasEvent
from core.dify_builder.input_schema import SYSTEM_QUERY, validate_query
from core.dify_builder.models import (
    Actor,
    ApplyResult,
    DifyBuilderContext,
    Graph,
    Inputs,
    MutationIntent,
    NodeEvent,
    NodeOutput,
    PublishResult,
    Run,
    RunVerification,
)
from extensions.ext_database import db
from graphon.enums import BuiltinNodeTypes
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import set_login_user
from models.account import Account
from models.dify_builder import DifyBuilderRun, DifyBuilderSession, DifyBuilderSessionCommit, DifyBuilderTestInput
from models.enums import CreatorUserRole
from models.model import App
from models.tools import BuiltinToolProvider
from models.workflow import Workflow, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from runtime_contracts.builder.execution import canonical_digest
from services.app_generate_service import AppGenerateService
from services.dify_builder import graph_ops
from services.dify_builder.application.execution_policy import (
    BuilderExecutionContext,
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    BuilderExecutionRecorder,
    BuilderExecutionRefusal,
    ConfirmedToolExecutionContext,
    ExecutionEvidenceSummary,
    HttpFixtureSetV1,
    HttpResponseFixtureV1,
    JsonToolExecutionContext,
    TrustedExecutionCompletion,
    admitted_node_bindings,
    scalar_inputs_digest,
)
from services.dify_builder.application.handlers_fix import run_finished_without_output
from services.dify_builder.effect_disclosure import EffectDisclosure, disclose
from services.dify_builder.errors import HashMismatchError, PreflightError, WorkflowNotInitializedError
from services.dify_builder.execution_policy_service import (
    BuilderExecutionPolicyService,
    _is_json_parse_candidate,
    admit_execution_workflow,
    restricted_admission_snapshot,
)
from services.dify_builder.identity import load_app, resolve_account
from services.dify_builder.json_tool_execution import admit_json_workflow
from services.dify_builder.node_policy import proposal_policy_rejections
from services.dify_builder.output_evidence import collect_output_findings
from services.dify_builder.preflight import new_preflight_problems
from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService, ServiceConfirmedToolGuard
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision, execution_revision, merge_canvas_presentation
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
    sanitize_confirmed_node_event,
    sanitize_confirmed_run,
    sanitize_confirmed_stream_event,
    stream_chunk_as_mapping,
)
from services.errors.app import WorkflowHashNotEqualError
from services.workflow_draft_sync_service import notify_workflow_draft_changed
from services.workflow_generation import graph_normalizers
from services.workflow_service import WorkflowService

if TYPE_CHECKING:
    from services.dify_builder.native_testing.agent_binding import (
        AgentBindingAuthorization,
        AgentBindingSelection,
        AgentBindingService,
    )


__all__ = ["ConfirmedLaunchRecorder", "WorkflowServiceDifyPort"]


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


def _confirmed_agent_selections(
    graph: Graph,
    resource_ids: Sequence[str] | None,
    *,
    retained: Mapping[str, "AgentBindingSelection"] | None = None,
) -> dict[str, "AgentBindingSelection"]:
    from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
    from services.dify_builder.native_testing.agent_binding import AgentBindingSelection, has_native_roster_binding

    confirmed = {}
    for resource_id in resource_ids or ():
        if resource_id.startswith("agent:"):
            selection = AgentBindingSelection.from_resource_id(resource_id)
            identity = (selection.agent_id, selection.snapshot_id)
            if identity in confirmed and confirmed[identity] != selection:
                raise BuilderExecutionPolicyError("agent_binding_not_prepared")
            confirmed[identity] = selection
    result = {}
    for node_id, data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph):
        if not has_native_roster_binding(data):
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        binding = data["agent_binding"]
        selection = confirmed.get((binding["agent_id"], binding["current_snapshot_id"]))
        if selection is None:
            selection = (retained or {}).get(node_id)
        if selection is None or (selection.agent_id, selection.snapshot_id) != (
            binding["agent_id"],
            binding["current_snapshot_id"],
        ):
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        result[node_id] = selection
    return result


def _agent_binding_stamp(binding) -> str:
    return canonical_digest(
        {
            "id": binding.id,
            "agent_id": binding.agent_id,
            "snapshot_id": binding.current_snapshot_id,
            "binding_type": str(binding.binding_type),
            "job": binding.node_job_config_dict,
        }
    )


def _retained_native_agent_selections(*, session: Session, actor: Actor, workflow: Workflow, graph: Graph):
    """Retain only an unchanged same-node SQL binding, never a graph-supplied pin.

    Current catalog access/publication is resolved before the writer. The binding
    stamp is rechecked under its draft lock before the normal prepare/sync owner.
    """
    from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
    from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.native_testing.agent_binding import AgentBindingSelection, native_node_data
    from services.dify_builder.native_testing.agent_catalog import AgentCatalogService
    from services.dify_builder.revision import node_config_digest

    def execution_data(data):
        # Native Agent title/description and revision-owned canvas transients
        # carry no Agent job, published Soul, binding or capability authority.
        return node_config_digest({key: value for key, value in data.items() if key not in {"title", "desc"}})

    baseline = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(workflow.graph_dict))
    unchanged = {
        node_id: data
        for node_id, data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph)
        if node_id in baseline and execution_data(data) == execution_data(baseline[node_id])
    }
    if not unchanged:
        return {}, {}
    rows = session.scalars(
        select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.tenant_id == actor.tenant_id,
            WorkflowAgentNodeBinding.app_id == workflow.app_id,
            WorkflowAgentNodeBinding.workflow_id == workflow.id,
            WorkflowAgentNodeBinding.workflow_version == workflow.version,
            WorkflowAgentNodeBinding.node_id.in_(unchanged),
        )
    ).all()
    by_node = {row.node_id: row for row in rows}
    for node_id, data in unchanged.items():
        row = by_node.get(node_id)
        if row is None or row.binding_type != WorkflowAgentBindingType.ROSTER_AGENT:
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        expected = native_node_data(
            agent_id=row.agent_id,
            snapshot_id=row.current_snapshot_id,
            node_job=WorkflowNodeJobConfig.model_validate(row.node_job_config_dict),
        )
        if any(data.get(key) != value for key, value in expected.items() if key != "title"):
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
    candidates = AgentCatalogService(session).resolve_candidates(
        tenant_id=actor.tenant_id,
        actor_id=actor.account_id,
        app_id=workflow.app_id,
        agent_ids=frozenset(row.agent_id for row in rows),
    )
    by_agent = {candidate.agent_id: candidate for candidate in candidates}
    retained, stamps = {}, {}
    for node_id, row in by_node.items():
        candidate = by_agent.get(row.agent_id)
        if candidate is None or candidate.snapshot_id != row.current_snapshot_id:
            raise BuilderExecutionPolicyError("agent_not_available")
        retained[node_id] = AgentBindingSelection(
            agent_id=row.agent_id, snapshot_id=row.current_snapshot_id, capability_digest=candidate.capability_digest
        )
        stamps[node_id] = _agent_binding_stamp(row)
    return retained, stamps


def _prepare_native_agent_graph(
    *,
    session: Session,
    actor: Actor,
    workflow: Workflow,
    graph: Graph,
    selections: Mapping[str, "AgentBindingSelection"],
    authorization: "AgentBindingAuthorization | None",
    retained_binding_stamps: Mapping[str, str] | None = None,
) -> tuple[Graph, "AgentBindingService | None"]:
    """Prepare all final Agent projections through one owner, in the caller's transaction."""
    from copy import deepcopy

    from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
    from models.agent import WorkflowAgentNodeBinding
    from services.agent.workflow_publish_service import WorkflowAgentPublishService
    from services.dify_builder.native_testing.agent_binding import AgentBindingService, has_native_roster_binding

    graph = deepcopy(graph)
    nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph))
    existing = {
        row.node_id: row
        for row in session.scalars(
            select(WorkflowAgentNodeBinding)
            .where(
                WorkflowAgentNodeBinding.tenant_id == actor.tenant_id,
                WorkflowAgentNodeBinding.app_id == workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == workflow.id,
                WorkflowAgentNodeBinding.workflow_version == workflow.version,
            )
            .order_by(WorkflowAgentNodeBinding.node_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).all()
    }
    for node_id, stamp in (retained_binding_stamps or {}).items():
        if node_id not in existing or _agent_binding_stamp(existing[node_id]) != stamp:
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
    if not nodes and not existing and not selections:
        return graph, None
    if (
        not selections
        or set(selections) != set(nodes)
        or not set(existing).issubset(nodes)
        or any(not has_native_roster_binding(data) for data in nodes.values())
    ):
        raise BuilderExecutionPolicyError("agent_binding_not_prepared")
    service = AgentBindingService(session, authorization=authorization)
    workflow.graph = json.dumps(graph)
    for node_id in sorted(nodes):
        data = nodes[node_id]
        selection = selections[node_id]
        if (data["agent_binding"]["agent_id"], data["agent_binding"]["current_snapshot_id"]) != (
            selection.agent_id,
            selection.snapshot_id,
        ):
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        job = WorkflowAgentPublishService._node_job_config_from_node_data(
            node_data=data,
            existing_binding=existing.get(node_id),
        )
        prepared = service.prepare_node(
            actor=actor,
            workflow=workflow,
            node_id=node_id,
            selection=selection,
            node_job=job,
            existing_node_data=data if node_id in (retained_binding_stamps or {}) else None,
        )
        for node in graph["nodes"]:
            if node["id"] == node_id:
                node["data"] = prepared
        workflow.graph = json.dumps(graph)
    return graph, service


def _sync_graph_only(
    app: App,
    graph: Graph,
    workflow: Workflow,
    unique_hash: str,
    account: Account,
    session: Session,
    app_id: str,
    *,
    commit: bool = True,
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
            commit=commit,
            preserve_environment_variables=True,
        )
    except WorkflowHashNotEqualError as exc:
        raise HashMismatchError(f"draft workflow changed since read: {app_id}") from exc


@dataclass
class ConfirmedLaunchRecorder:
    """The launch recorder of one confirmed Run, which also issues its service-owned guard.

    Built only by the launch admission after ``claim_launch`` captured this
    Run's identity. ``confirmed_guard`` is called by the native Tool runtime at
    Graphon's actual node binding: it claims the grant through the consent
    owner for exactly this native Run and returns ``ServiceConfirmedToolGuard``.
    It never caches, rebuilds or deserializes a guard; a second claim refuses
    in the consent owner. A confirmed run records no restricted observations.
    """

    base: BuilderExecutionRecorder
    consent: BuilderRealCallConsentService
    context: ConfirmedToolExecutionContext
    native_run_id: str

    @property
    def healthy(self) -> bool:
        return self.base.healthy

    def record(self, observation: BuilderExecutionObservation) -> None:
        self.base.record(observation)

    def confirmed_guard(
        self, *, node_id: str, native_run_id: str, native_node_execution_id: str
    ) -> ServiceConfirmedToolGuard:
        if not self.base.healthy:
            raise BuilderExecutionPolicyError("execution_recorder_unhealthy")
        if native_run_id != self.native_run_id:
            raise BuilderExecutionPolicyError("execution_launch_mismatch")
        binding = self.consent.claim_tool(
            context=self.context,
            node_id=node_id,
            native_run_id=native_run_id,
            native_node_execution_id=native_node_execution_id,
        )
        return ServiceConfirmedToolGuard(self.consent, binding)


@dataclass
class _BuilderExecutionLaunch:
    """One invocation's admission and recorder, retained by the completion owner.

    ``consent`` is set exactly for a confirmed context; the admission then
    hands the native factory a ``ConfirmedLaunchRecorder``.
    """

    service: BuilderExecutionPolicyService
    context: BuilderExecutionContext | ConfirmedToolExecutionContext | JsonToolExecutionContext
    consent: BuilderRealCallConsentService | None = None
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
        context: BuilderExecutionContext | ConfirmedToolExecutionContext | JsonToolExecutionContext,
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
        admit_execution_workflow(self.context, restricted_admission_snapshot(workflow, app))

    def __call__(
        self,
        workflow: Workflow,
        app: App,
        entity: WorkflowAppGenerateEntity,
        root_node_id: str,
        resume: bool,
    ) -> BuilderExecutionRecorder:
        try:
            if isinstance(self.context, ConfirmedToolExecutionContext) and self.consent is None:
                raise BuilderExecutionPolicyError("missing_confirmed_tool_guard")
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
            recorder: BuilderExecutionRecorder = self.service.recorder(
                context=self.context,
                native_run_id=entity.workflow_execution_id,
                task_id=entity.task_id,
            )
            if isinstance(self.context, ConfirmedToolExecutionContext):
                assert self.consent is not None  # refused before the launch claim below
                recorder = ConfirmedLaunchRecorder(recorder, self.consent, self.context, entity.workflow_execution_id)
            with self._lock:
                self.recorder = recorder
            return recorder
        except BuilderExecutionPolicyError as error:
            self.on_refusal(error)
            raise


# Refusals meaning another delivery already owns this reserved command's launch.
_DUPLICATE_LAUNCH_REASONS = frozenset({"execution_already_launched", "execution_already_claimed"})


def _tool_account_metadata(
    session: Session, tenant_id: str, graph: Mapping[str, Any]
) -> tuple[dict[str, str], dict[str, str]]:
    """Resolve display aliases and opaque identity/version bindings without decrypting credentials."""
    selections: dict[str, tuple[str, str]] = {}
    for node in graph.get("nodes") or []:
        data = node.get("data") if isinstance(node, Mapping) else None
        if not isinstance(data, Mapping) or data.get("type") != BuiltinNodeTypes.TOOL:
            continue
        if data.get("provider_type") not in {"builtin", "plugin"} or not isinstance(data.get("provider_id"), str):
            continue
        selections[str(node.get("id"))] = (data["provider_id"], str(data.get("credential_id") or ""))
    if not selections:
        return {}, {}
    from models.provider_ids import ToolProviderID

    provider_aliases: dict[str, set[str]] = {}
    for provider, _ in selections.values():
        aliases = {provider}
        try:
            native_id = ToolProviderID(provider)
            if str(ToolProviderID(native_id.provider_name)) == str(native_id):
                aliases.add(native_id.provider_name)
        except (ValueError, TypeError):
            pass
        provider_aliases[provider] = aliases
    rows = session.scalars(
        select(BuiltinToolProvider).where(
            BuiltinToolProvider.tenant_id == tenant_id,
            BuiltinToolProvider.provider.in_(set().union(*provider_aliases.values())),
        )
    ).all()
    names: dict[str, str] = {}
    bindings: dict[str, str] = {}
    for node_id, (provider, credential_id) in selections.items():
        candidates = [row for row in rows if row.provider in provider_aliases[provider]]
        if credential_id:
            chosen = next((row for row in candidates if row.id == credential_id), None)
        else:
            chosen = next((row for row in candidates if row.is_default), None) or min(
                candidates, key=lambda row: row.created_at, default=None
            )
        if chosen is not None:
            names[node_id] = chosen.name or ""
            from services.tools.draft_tool_setup import tool_credential_fingerprint

            bindings[node_id] = tool_credential_fingerprint(chosen)
    return names, bindings


def _effect_scope_binding(workflow: Workflow) -> str:
    """Hash semantic namespace values, as execution_revision does; expose only the digest.

    Secret re-encryption during an unchanged autosave must not invalidate a
    disclosure. Resolved values exist only in this local hash input.
    """
    state = [
        sorted(
            (variable.model_dump(mode="json") for variable in variables),
            key=lambda variable: str(variable.get("name") or variable.get("id") or ""),
        )
        for variables in (workflow.environment_variables, workflow.conversation_variables)
    ]
    if not any(state):
        return ""
    return hashlib.sha256(json.dumps(state, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _unsupported_run(error: BuilderExecutionPolicyError) -> Run:
    return Run(status="failed", execution_refusal=BuilderExecutionRefusal(reason_code=error.reason_code))


def _code_scope_binding(workflow: Workflow) -> str:
    """Code explanations bind execution features as well as namespace values."""
    return canonical_digest({"features": workflow.features_dict, "namespace": _effect_scope_binding(workflow)})


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

    def prepare_code_risks(
        self,
        app_id: str,
        actor: Actor,
        *,
        session_id: str,
        inputs: Mapping[str, Any],
        context: DifyBuilderContext,
    ) -> dict[str, dict[str, Any]]:
        """Reason once outside DB sessions; revalidate facts before exposing the snapshot."""
        from services.dify_builder.code_risk_assessment import (
            assess_code,
            builder_code_reasoner,
            code_facts,
            unavailable,
            validated_assessments,
        )

        if not dify_config.DIFY_BUILDER_CONFIRMED_RUN_ENABLED or self._restricted_admissible(app_id, actor):
            return {}

        def current_facts():
            with _session_factory()() as session:
                app = load_app(session, app_id, actor)
                owner = session.get(DifyBuilderSession, session_id)
                if owner is None or (owner.app_id, owner.tenant_id, owner.owner_account_id) != (
                    app_id,
                    actor.tenant_id,
                    actor.account_id,
                ):
                    raise BuilderExecutionPolicyError("execution_owner_mismatch")
                draft = _load_draft_workflow_or_raise(app, session=session)
                return code_facts(
                    dict(draft.graph_dict),
                    inputs=inputs,
                    goal_text=context.goal_text,
                    model_config=context.model_config,
                    scope_binding=_code_scope_binding(draft),
                    reply_language=context.reply_language,
                )

        before = current_facts()
        prior = validated_assessments(context.code_risk_assessments)
        results = {}
        for node_id, facts in before.items():
            saved = prior.get(node_id)
            if saved is not None and saved["facts_digest"] == facts.digest:
                results[node_id] = saved
            elif not context.goal_text or not context.model_config:
                results[node_id] = unavailable(facts).model_dump(mode="json")
            else:
                results[node_id] = assess_code(
                    facts,
                    reason=builder_code_reasoner(
                        tenant_id=actor.tenant_id,
                        model_config=context.model_config,
                    ),
                ).model_dump(mode="json")
        after = current_facts()
        # A concurrent edit cannot inherit reasoning about the previous draft.
        # Do not retry the model automatically; show unavailable/Mock instead.
        return {
            node_id: results[node_id]
            if node_id in before and before[node_id].digest == facts.digest
            else unavailable(facts).model_dump(mode="json")
            for node_id, facts in after.items()
        }

    def disclose_effects(
        self,
        app_id: str,
        actor: Actor,
        *,
        inputs: Mapping[str, Any] | None = None,
        code_risk_context: DifyBuilderContext | None = None,
    ) -> EffectDisclosure:
        """What a Test Run of the current draft would touch, with each Tool's credential name.

        Empty unless the run takes the confirmed full run: the restricted
        runtime keeps its own fixture and consent rules.
        """
        if not dify_config.DIFY_BUILDER_CONFIRMED_RUN_ENABLED or self._restricted_admissible(app_id, actor):
            return EffectDisclosure()
        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            graph = dict(workflow.graph_dict)
            names, bindings = _tool_account_metadata(session, app.tenant_id, graph)
            from services.dify_builder.code_risk_assessment import code_facts

            context = code_risk_context or DifyBuilderContext()
            facts = code_facts(
                graph,
                inputs=inputs or {},
                goal_text=context.goal_text,
                model_config=context.model_config,
                scope_binding=_code_scope_binding(workflow),
                reply_language=context.reply_language,
            )
            return disclose(
                graph,
                names,
                account_bindings=bindings,
                inputs=inputs,
                scope_binding=_effect_scope_binding(workflow),
                code_risk_assessments=context.code_risk_assessments,
                code_facts_digests={node_id: fact.digest for node_id, fact in facts.items()},
            )

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

    def failed_run_context(self, app_id: str, actor: Actor, run_id: str) -> tuple[Graph | None, list[NodeOutput], str]:
        """Read native graph and rows only after complete owner/Run validation.

        Missing graph/Run is unavailable. A mismatched owner or execution is a
        denial, never an unknown that permits handling another tenant's data.
        Offloaded content is not fetched and iteration/retry evidence remains
        unknown even if only one successful row happens to be present.
        """
        from core.dify_builder.errors import NotFoundError

        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            tenant_id = app.tenant_id
        if not run_id:
            return None, [], ""
        run_row = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
            sessionmaker(bind=db.engine)
        ).get_workflow_run_by_id(tenant_id=tenant_id, app_id=app_id, run_id=run_id)
        if run_row is None:
            return None, [], ""
        if (run_row.tenant_id, run_row.app_id, run_row.id) != (tenant_id, app_id, run_id):
            raise NotFoundError("failed Run not found")
        if _unwrap_status(run_row.status) != "failed":
            return None, [], run_row.error or ""
        rows = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            sessionmaker(bind=db.engine)
        ).get_executions_by_workflow_run(tenant_id, app_id, run_id)
        # Validate every row before reading even one inputs/outputs property.
        for row in rows:
            if (row.tenant_id, row.app_id, row.workflow_run_id, row.workflow_id) != (
                tenant_id,
                app_id,
                run_id,
                run_row.workflow_id,
            ):
                raise NotFoundError("failed Run execution not found")
        try:
            graph = run_row.graph_dict
        except (TypeError, ValueError):
            graph = None
        historical = dict(graph) if isinstance(graph, Mapping) and isinstance(graph.get("nodes"), list) else None
        metadata_ambiguous = False
        for row in rows:
            try:
                metadata = row.execution_metadata_dict
            except (TypeError, ValueError):
                metadata = None
            if not isinstance(metadata, Mapping) or any(
                value is not None
                for key, value in metadata.items()
                if any(token in str(key).lower() for token in ("iteration", "loop", "retry"))
            ):
                metadata_ambiguous = True
        outputs = []
        for row in rows:
            raw_outputs = row.outputs_dict
            outputs.append(
                NodeOutput(
                    node_id=row.node_id,
                    title=row.title,
                    status=_unwrap_status(row.status),
                    error=row.error or "",
                    inputs=row.inputs_dict or {},
                    outputs=raw_outputs or {},
                    outputs_available=isinstance(raw_outputs, Mapping)
                    and row.outputs_truncated is False
                    and not metadata_ambiguous
                    and row.finished_at is not None
                    and bool(row.node_execution_id)
                    and _unwrap_status(run_row.status) == "failed",
                )
            )
        return historical, outputs, run_row.error or ""

    def apply_repair(
        self,
        app_id: str,
        actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict], None] | None = None,
        *,
        expected_revision: str,
        failed_run_id: str | None = None,
        confirmed_resource_ids: Sequence[str] | None = None,
        expected_resource_fingerprints: dict[str, str] | None = None,
        expected_node_resources: dict[str, str] | None = None,
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

        from services.dify_builder.resource_grounding import validate_workspace_resources

        if not changed_nodes:
            validate_workspace_resources(
                before_graph,
                graph,
                tenant_id=actor.tenant_id,
                account_id=actor.account_id,
                confirmed_ids=confirmed_resource_ids,
                expected_fingerprints=expected_resource_fingerprints,
                expected_node_resources=expected_node_resources,
            )
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
        # (services.workflow_generation.graph_normalizers.heal_nodes_for_preflight), for
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

        # Read-only workspace metadata is resolved before the write transaction.
        # Unchanged historical resource identities do not veto unrelated edits.
        validate_workspace_resources(
            before_graph,
            graph,
            tenant_id=actor.tenant_id,
            account_id=actor.account_id,
            confirmed_ids=confirmed_resource_ids,
            expected_fingerprints=expected_resource_fingerprints,
            expected_node_resources=expected_node_resources,
        )

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
        if failed_run_id is not None:
            from services.dify_builder.condition_evidence import build_evidence, repair_evidence_rejections

            historical, outputs, native_error = self.failed_run_context(app_id, actor, failed_run_id)
            _, _, _, evidence = build_evidence(
                Run(dify_run_id=failed_run_id, error=native_error), before_graph, historical, outputs
            )
            evidence_problems = repair_evidence_rejections(before_graph, graph, written_nodes, evidence)
            if evidence_problems:
                raise PreflightError("; ".join(evidence_problems))
        new_problems = new_preflight_problems(before_graph, graph, written_nodes)
        if new_problems:
            raise PreflightError("the draft would not start: " + "; ".join(new_problems))

        changes, scope = graph_ops.diff_graphs(before_graph, graph)
        nodes = describe_changed_nodes(changed_nodes, before_graph, graph)
        fingerprint = graph_ops.structural_fingerprint(graph)

        from services.dify_builder.native_testing.agent_binding import AgentBindingService

        retained, retained_stamps = {}, {}
        if any(node.get("data", {}).get("type") == "agent" for node in graph.get("nodes", [])):
            with _session_factory()() as session:
                app = load_app(session, app_id, actor)
                workflow = _load_draft_workflow_or_raise(app, session=session)
                if execution_revision(workflow) != revision:
                    raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
                retained, retained_stamps = _retained_native_agent_selections(
                    session=session, actor=actor, workflow=workflow, graph=graph
                )
        selections = _confirmed_agent_selections(graph, confirmed_resource_ids, retained=retained)
        retirements: set[str] = set()
        authorization = (
            AgentBindingService.authorize(
                actor=actor,
                app_id=app_id,
                agent_ids=frozenset(item.agent_id for item in selections.values()),
            )
            if selections
            else None
        )
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            session.refresh(workflow, with_for_update=True)
            if execution_revision(workflow) != revision:
                raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
            committed_previous_graph = dict(workflow.graph_dict)
            graph = merge_canvas_presentation(before_graph, graph, committed_previous_graph)
            graph, binding_service = _prepare_native_agent_graph(
                session=session,
                actor=actor,
                workflow=workflow,
                graph=graph,
                selections=selections,
                authorization=authorization,
                retained_binding_stamps=retained_stamps,
            )
            updated = _sync_graph_only(
                app,
                graph,
                workflow,
                workflow.unique_hash,
                account,
                session,
                app_id,
                **({"commit": False} if binding_service is not None else {}),
            )
            if binding_service is not None:
                retirements = binding_service.sync_prepared_bindings(
                    actor=actor, workflow=updated, selections=selections
                )
                session.commit()
            new_hash = execution_revision(updated)

        if binding_service is not None:
            from events.app_event import app_draft_workflow_was_synced
            from services.agent.retirement_service import WorkflowAgentRetirementService

            WorkflowAgentRetirementService.retire_unowned(
                tenant_id=actor.tenant_id,
                agent_ids=retirements,
                account_id=actor.account_id,
            )
            app_draft_workflow_was_synced.send(app, synced_draft_workflow=updated)
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
        execution configuration changed since the caller read it. Native Agent
        graph/binding state requires an admitted restore owner and is refused."""
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            session.refresh(workflow, with_for_update=True)
            if execution_revision(workflow) != expected_revision:
                raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
            from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
            from models.agent import WorkflowAgentNodeBinding

            # Legacy Undo only restores a graph. It cannot restore or authorize
            # Agent binding state; reject before either side can diverge.
            if (
                any(WorkflowAgentNodeValidator.iter_agent_v2_nodes(workflow.graph_dict))
                or any(WorkflowAgentNodeValidator.iter_agent_v2_nodes(graph))
                or any(
                    session.scalars(
                        select(WorkflowAgentNodeBinding.id)
                        .where(
                            WorkflowAgentNodeBinding.tenant_id == actor.tenant_id,
                            WorkflowAgentNodeBinding.app_id == app_id,
                            WorkflowAgentNodeBinding.workflow_id == workflow.id,
                            WorkflowAgentNodeBinding.workflow_version == workflow.version,
                        )
                        .limit(1)
                    )
                )
            ):
                raise BuilderExecutionPolicyError("native_restore_unavailable")
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
        confirmed_consent_id: str | None = None,
        command_id: str | None = None,
        effect_confirmation: Mapping[str, str] | None = None,
    ) -> Run:
        if confirmed_consent_id is not None or command_id is not None:
            if not confirmed_consent_id or not command_id:
                return _unsupported_run(BuilderExecutionPolicyError("confirmed_launch_incomplete"))
            return self._run_confirmed_draft(
                app_id,
                actor,
                on_event,
                session_id=session_id,
                test_input_id=test_input_id,
                on_workflow_event=on_workflow_event,
                consent_id=confirmed_consent_id,
                command_id=command_id,
            )
        if self._has_full_run_reservation(session_id, test_input_id) or (
            dify_config.DIFY_BUILDER_CONFIRMED_RUN_ENABLED and not self._restricted_admissible(app_id, actor)
        ):
            return self._run_confirmed_full_draft(
                app_id,
                actor,
                inputs,
                on_event,
                session_id=session_id,
                test_input_id=test_input_id,
                on_workflow_event=on_workflow_event,
                effect_confirmation=effect_confirmation or {},
            )
        launch: _BuilderExecutionLaunch | None = None
        try:
            with _session_factory()() as session:
                account = resolve_account(session, actor)
                app = load_app(session, app_id, actor)
                tenant_id = app.tenant_id
                draft = _load_draft_workflow_or_raise(app, session=session)
                snapshot = restricted_admission_snapshot(draft, app)
                if _is_json_parse_candidate(snapshot):
                    admit_json_workflow(snapshot)
                else:
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
            # The caller's read session has closed before qualified daemon metadata.
            with _session_factory()() as session:
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

        completed, candidate_ids = self._consume_launch(launch, response, on_event, on_workflow_event, sanitize=False)
        return self._finalize_launch(launch, actor, response_completed=completed, candidate_ids=candidate_ids)

    def _restricted_admissible(self, app_id: str, actor: Actor) -> bool:
        """Whether the audited restricted (or JSON) runtime can run the whole draft."""
        with _session_factory()() as session:
            app = load_app(session, app_id, actor)
            draft = _load_draft_workflow_or_raise(app, session=session)
            try:
                snapshot = restricted_admission_snapshot(draft, app)
                if _is_json_parse_candidate(snapshot):
                    admit_json_workflow(snapshot)
                else:
                    admitted_node_bindings(snapshot)
            except BuilderExecutionPolicyError:
                return False
        return True

    @staticmethod
    def _has_full_run_reservation(session_id: str, test_input_id: str) -> bool:
        # Runtime/configuration drift cannot reroute an interrupted full run
        # into a fresh restricted launch with the same saved attempt identity.
        reservation_id = str(uuid5(NAMESPACE_URL, f"dify-builder-full-run:{session_id}:{test_input_id}"))
        with _session_factory()() as session:
            row = session.get(DifyBuilderRun, reservation_id)
            return isinstance(row, DifyBuilderRun) and row.kind == "native_test_launch"

    def _reserve_full_run(
        self,
        session_id: str,
        test_input_id: str,
        before_revision: str,
        before_graph_revision: str,
        mocked: frozenset[str],
    ) -> tuple[Run, bool]:
        """Reserve one saved-input attempt using the existing Run primary key.

        A new explicit test choice gets a fresh TestInput. Re-entering a working
        handler keeps that input, so even a crash before native acknowledgement
        cannot launch it twice. The durable reservation intentionally survives
        an ambiguous launch; this is not provider-side exactly-once execution.
        """
        reservation_id = str(uuid5(NAMESPACE_URL, f"dify-builder-full-run:{session_id}:{test_input_id}"))
        verification = RunVerification(
            execution_revision=before_revision,
            executed_graph_revision=before_graph_revision,
            terminal_outputs=None,
            output_findings=[],
            executed_node_ids=[],
            no_output_dead_branch=False,
            execution_evidence=ExecutionEvidenceSummary(
                request_id=reservation_id,
                policy_version="builder-confirmed-run-v1",
                mode="confirmed_run",
                sealed=False,
                safety_outcome="execution_evidence_unknown",
                simulated_node_ids=tuple(sorted(mocked)),
                sandbox_profile="native",
            ),
        )
        assert verification.execution_evidence is not None
        row = DifyBuilderRun(
            id=reservation_id,
            session_id=session_id,
            kind="native_test_launch",
            inputs_ref=test_input_id,
            status="running",
            immutable=False,
            per_node=[],
            verification={
                **asdict(verification),
                "execution_evidence": verification.execution_evidence.model_dump(mode="json"),
            },
        )
        # The unique primary key, rather than a read-before-write or dispatch
        # lease, elects the only invocation allowed to call the native generator.
        try:
            with _session_factory()() as session, session.begin():
                session.add(row)
                session.flush()
            return SqlDifyBuilderRepository._to_domain_run(row), True
        except IntegrityError:
            with _session_factory()() as session:
                existing = session.get(DifyBuilderRun, reservation_id)
                if existing is None or (existing.session_id, existing.inputs_ref, existing.kind) != (
                    session_id,
                    test_input_id,
                    "native_test_launch",
                ):
                    raise
                return SqlDifyBuilderRepository._to_domain_run(existing), False

    @staticmethod
    def _bind_full_native_id(reservation_id: str, native_run_id: str) -> None:
        """Keep the first native identity durable before exposing any event."""
        if not native_run_id:
            return
        with _session_factory()() as session, session.begin():
            row = session.get(DifyBuilderRun, reservation_id, with_for_update=True)
            if row is None or row.dify_run_id not in (None, "", native_run_id):
                raise BuilderExecutionPolicyError("execution_launch_mismatch")
            row.dify_run_id = native_run_id

    @staticmethod
    def _save_full_run_result(reservation_id: str, run: Run) -> None:
        with _session_factory()() as session, session.begin():
            row = session.get(DifyBuilderRun, reservation_id, with_for_update=True)
            assert row is not None
            row.dify_run_id = run.dify_run_id or row.dify_run_id
            row.status = run.status
            row.error = run.error
            row.per_node = [asdict(node) for node in run.per_node]
            row.verification = (
                {
                    **asdict(run.verification),
                    "execution_evidence": run.verification.execution_evidence.model_dump(mode="json")
                    if run.verification.execution_evidence
                    else None,
                }
                if run.verification is not None
                else None
            )
            row.tokens = run.tokens
            row.elapsed_ms = run.elapsed_ms
            preparation_failed = (
                run.verification is not None
                and run.verification.execution_evidence is not None
                and run.verification.execution_evidence.sealed
                and run.verification.execution_evidence.safety_outcome == "preparation_failed"
            )
            row.immutable = run.status in {"succeeded", "failed"} and (bool(run.dify_run_id) or preparation_failed)

    @staticmethod
    def _prepare_confirmed_agent_execution(*, actor, session_id, test_input_id, expected_version, reservation_id):
        from runtime_contracts.builder.native.agent_context import BuilderAgentExecutionContext
        from services.dify_builder.native_testing.agent_operations import admit_confirmed_agent_execution

        native_run_id = str(uuid4())
        context = admit_confirmed_agent_execution(
            actor=actor,
            session_id=session_id,
            test_input_id=test_input_id,
            expected_version=expected_version,
            native_run_id=native_run_id,
            idempotency_key=reservation_id,
            limits={"calls": 32, "dispatches": 32, "cost_units": 32},
        )
        return BuilderAgentExecutionContext(ref=context.ref, native_run_id=native_run_id)

    @staticmethod
    def _recover_confirmed_agent_parent_id(*, actor, app_id, session_id, test_input_id, graph):
        """A planned ID is a locator, never proof that a Run was launched."""
        if not any(
            isinstance(node, dict) and node.get("data", {}).get("type") == "agent" for node in graph.get("nodes", [])
        ):
            return None
        from models.dify_builder import DifyBuilderExecutionRequest

        with _session_factory()() as session:
            requests = session.scalars(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    DifyBuilderExecutionRequest.app_id == app_id,
                    DifyBuilderExecutionRequest.session_id == session_id,
                    DifyBuilderExecutionRequest.test_input_id == test_input_id,
                )
            ).all()
            actual = []
            for request in requests:
                if request.context.get("profile", {}).get("profile_id") != "builder-agent-confirmed-v1":
                    continue
                if canonical_digest(request.context) != request.context_digest:
                    raise BuilderExecutionPolicyError("native_context_mismatch")
                row = session.scalar(
                    select(WorkflowRun).where(
                        WorkflowRun.id == request.context.get("native_run_id"),
                        WorkflowRun.tenant_id == actor.tenant_id,
                        WorkflowRun.created_by == actor.account_id,
                        WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                        WorkflowRun.app_id == app_id,
                        WorkflowRun.workflow_id == request.workflow_id,
                    )
                )
                if row is not None:
                    actual.append(row.id)
            if len(actual) > 1:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            return actual[0] if actual else None

    @staticmethod
    def _settle_confirmed_agent_parent(*, actor, app_id, session_id, test_input_id, native_run_id, paused):
        from models.dify_builder import DifyBuilderExecutionRequest
        from runtime_contracts.builder.native.contracts import NativeTestContextRef
        from services.dify_builder.wiring import build_confirmed_agent_command_service

        with _session_factory()() as session:
            rows = session.scalars(
                select(DifyBuilderExecutionRequest).where(
                    DifyBuilderExecutionRequest.tenant_id == actor.tenant_id,
                    DifyBuilderExecutionRequest.actor_id == actor.account_id,
                    DifyBuilderExecutionRequest.app_id == app_id,
                    DifyBuilderExecutionRequest.session_id == session_id,
                    DifyBuilderExecutionRequest.test_input_id == test_input_id,
                )
            ).all()
            selected = [
                row
                for row in rows
                if row.context.get("profile", {}).get("profile_id") == "builder-agent-confirmed-v1"
                and row.context.get("native_run_id") == native_run_id
            ]
            if not selected:
                return None
            if len(selected) != 1:
                raise BuilderExecutionPolicyError("native_agent_owner_mismatch")
            row = selected[0]
            ref = NativeTestContextRef(
                request_id=row.id, invocation_id=row.context["invocation_id"], context_digest=row.context_digest
            )
        commands = build_confirmed_agent_command_service(actor=actor)
        return commands.persist_parent_wait(ref=ref) if paused else commands.settle_parent(ref=ref)

    @staticmethod
    def _saved_code_risks(session, *, owner, graph, inputs, draft):
        """Reload server-only assessment at worker boundaries; never call reasoning."""
        from services.dify_builder.code_risk_assessment import code_facts, validated_assessments
        from services.dify_builder.serde import context_from_dict

        if not any(node.get("data", {}).get("type") == "code" for node in graph.get("nodes", [])):
            return {}, {}
        commit = session.scalar(
            select(DifyBuilderSessionCommit)
            .where(
                DifyBuilderSessionCommit.session_id == owner.id,
                DifyBuilderSessionCommit.version == owner.version,
            )
            .order_by(DifyBuilderSessionCommit.created_at.desc())
            .limit(1)
        )
        if commit is None:
            raise BuilderExecutionPolicyError("code_risk_assessment_stale")
        context = context_from_dict(commit.context)
        facts = code_facts(
            graph,
            inputs=inputs,
            goal_text=context.goal_text,
            model_config=context.model_config,
            scope_binding=_code_scope_binding(draft),
            reply_language=context.reply_language,
        )
        risks = validated_assessments(context.code_risk_assessments)
        if any(
            node_id not in risks or risks[node_id]["facts_digest"] != fact.digest for node_id, fact in facts.items()
        ):
            raise BuilderExecutionPolicyError("code_risk_assessment_stale")
        return risks, {node_id: fact.digest for node_id, fact in facts.items()}

    def _run_confirmed_full_draft(
        self,
        app_id: str,
        actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None,
        effect_confirmation: Mapping[str, str],
    ) -> Run:
        """Run one saved-input attempt through the ordinary native debugger.

        Reserve before generation and record its native ID before callbacks.
        Recovery reads that same Run, never dispatches a second native attempt.
        A missing acknowledgement remains unknown and needs an explicit new
        test choice; a previous confirmation cannot authorize that new attempt.
        """
        with _session_factory()() as session:
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            tenant_id = app.tenant_id
            owner = session.get(DifyBuilderSession, session_id)
            if owner is None or (owner.app_id, owner.tenant_id, owner.owner_account_id) != (
                app_id,
                actor.tenant_id,
                actor.account_id,
            ):
                return _unsupported_run(BuilderExecutionPolicyError("execution_owner_mismatch"))
            saved = session.get(DifyBuilderTestInput, test_input_id) if test_input_id else None
            if saved is None or saved.session_id != session_id or saved.inputs != dict(inputs):
                return _unsupported_run(BuilderExecutionPolicyError("test_input_binding_mismatch"))
            draft = _load_draft_workflow_or_raise(app, session=session)
            graph = dict(draft.graph_dict)
            if any(node.get("data", {}).get("type") == "code" for node in graph.get("nodes", [])) and (
                canonical_digest(saved.inputs) != canonical_digest(dict(inputs))
            ):
                return _unsupported_run(BuilderExecutionPolicyError("test_input_binding_mismatch"))
            owner_version = owner.version
            before_revision = execution_revision(draft)
            before_graph_revision = executable_graph_revision(graph)
            names, bindings = _tool_account_metadata(session, tenant_id, graph)
            reservation_id = str(uuid5(NAMESPACE_URL, f"dify-builder-full-run:{session_id}:{test_input_id}"))
            existing = session.get(DifyBuilderRun, reservation_id)
            # Recovery observes its old mock set/Run even if a later edit makes
            # the preparation stale. It must never reassess or redispatch.
            if existing is None:
                try:
                    risks, digests = self._saved_code_risks(
                        session, owner=owner, graph=graph, inputs=inputs, draft=draft
                    )
                except BuilderExecutionPolicyError as error:
                    return _unsupported_run(error)
                mocked = disclose(
                    graph,
                    names,
                    account_bindings=bindings,
                    inputs=inputs,
                    scope_binding=_effect_scope_binding(draft),
                    code_risk_assessments=risks,
                    code_facts_digests=digests,
                ).mocked_node_ids(effect_confirmation)
            else:
                mocked = frozenset()  # _reserve_full_run returns the immutable old reservation below.
            # Only New Agent owns the nested-call confirmation transport. A
            # legacy strategy Agent must not fall through to its ordinary tools.
            if existing is None and any(
                isinstance(node, dict)
                and isinstance(node.get("data"), dict)
                and node["data"].get("type") == "agent"
                and node.get("id") not in mocked
                and (node["data"].get("version"), node["data"].get("agent_node_kind")) != ("2", "dify_agent")
                for node in graph.get("nodes", [])
            ):
                return _unsupported_run(BuilderExecutionPolicyError("unsupported_node_implementation"))
            args: dict[str, Any] = {"inputs": dict(inputs)}
            if app.mode == "advanced-chat":
                validate_query(inputs)
                args = {
                    "query": inputs[SYSTEM_QUERY],
                    "inputs": {key: value for key, value in inputs.items() if key != SYSTEM_QUERY},
                }

        reservation, launch = self._reserve_full_run(
            session_id, test_input_id, before_revision, before_graph_revision, mocked
        )
        if not launch:
            if (
                reservation.verification is not None
                and reservation.verification.execution_evidence is not None
                and reservation.verification.execution_evidence.safety_outcome == "preparation_failed"
            ):
                return reservation
            if not reservation.dify_run_id:
                recovered = self._recover_confirmed_agent_parent_id(
                    actor=actor,
                    app_id=app_id,
                    session_id=session_id,
                    test_input_id=test_input_id,
                    graph=graph,
                )
                if recovered:
                    self._bind_full_native_id(reservation.id, recovered)
                    reservation.dify_run_id = recovered
            if reservation.immutable or not reservation.dify_run_id:
                if not reservation.dify_run_id and reservation.verification is not None:
                    evidence = reservation.verification.execution_evidence
                    if evidence is not None:
                        # The reservation retains mock candidates for recovery;
                        # no acknowledgement means none are observed steps yet.
                        reservation.verification.execution_evidence = evidence.model_copy(
                            update={"simulated_node_ids": ()}
                        )
                return reservation
            assert reservation.verification is not None
            before_revision = reservation.verification.execution_revision
            before_graph_revision = reservation.verification.executed_graph_revision
            evidence = reservation.verification.execution_evidence
            mocked = frozenset(evidence.simulated_node_ids if evidence is not None else ())

        final: dict[str, Any] = {}
        stream_run_id = reservation.dify_run_id
        error_frame: dict[str, str] | None = None
        pending_pause_event = None
        preparation_failure = None
        failed_resource = None
        from services.dify_builder.native_launch_observation import NativeLaunchObservation, resource_node_ids

        if launch:
            observation = NativeLaunchObservation()
            response = None
            try:
                real_agent = any(
                    isinstance(node, dict)
                    and isinstance(node.get("data"), dict)
                    and node["data"].get("type") == "agent"
                    and node.get("id") not in mocked
                    for node in graph.get("nodes", [])
                )
                agent_context = (
                    self._prepare_confirmed_agent_execution(
                        actor=actor,
                        session_id=session_id,
                        test_input_id=test_input_id,
                        expected_version=owner_version,
                        reservation_id=reservation.id,
                    )
                    if real_agent
                    else None
                )
                set_login_user(account)
                # Only native generation owns this session; Builder reads and
                # the durable reservation committed before any provider I/O.
                with _session_factory()() as session:
                    if any(node.get("data", {}).get("type") == "code" for node in graph.get("nodes", [])):
                        current_owner = session.get(DifyBuilderSession, session_id)
                        current_input = session.get(DifyBuilderTestInput, test_input_id)
                        current_draft = _load_draft_workflow_or_raise(app, session=session)
                        if (
                            current_owner is None
                            or current_owner.version != owner_version
                            or (current_owner.app_id, current_owner.tenant_id, current_owner.owner_account_id)
                            != (app_id, actor.tenant_id, actor.account_id)
                            or current_input is None
                            or current_input.session_id != session_id
                            or canonical_digest(current_input.inputs) != canonical_digest(dict(inputs))
                            or execution_revision(current_draft) != before_revision
                        ):
                            return _unsupported_run(BuilderExecutionPolicyError("code_risk_assessment_stale"))
                        try:
                            self._saved_code_risks(
                                session,
                                owner=current_owner,
                                graph=dict(current_draft.graph_dict),
                                inputs=inputs,
                                draft=current_draft,
                            )
                        except BuilderExecutionPolicyError as error:
                            return _unsupported_run(error)
                    with observation.track():
                        response = AppGenerateService.generate(
                            app_model=app,
                            user=account,
                            args=args,
                            invoke_from=InvokeFrom.DEBUGGER,
                            session=session,
                            streaming=True,
                            workflow_execution_mode="in_process",
                            builder_mocked_node_ids=mocked,
                            builder_expected_revision=before_revision,
                            builder_tool_credential_bindings={
                                node_id: binding for node_id, binding in bindings.items() if node_id not in mocked
                            },
                            builder_agent_execution=agent_context,
                        )
                if isinstance(response, Mapping):
                    final = dict(response.get("data") or {})
                    if not final.get("id"):
                        final["id"] = str(response.get("workflow_run_id") or "")
                    stream_run_id = str(final.get("id") or "")
                    self._bind_full_native_id(reservation.id, stream_run_id)
                else:
                    for chunk in response:
                        payload = stream_chunk_as_mapping(chunk)
                        if payload is None:
                            continue
                        native_id = run_id_from_stream_chunk(payload)
                        if native_id:
                            self._bind_full_native_id(reservation.id, native_id)
                            stream_run_id = native_id
                        if on_workflow_event is not None:
                            if agent_context is not None and payload.get("event") == "workflow_paused":
                                pending_pause_event = payload
                            else:
                                on_workflow_event(payload)
                        node_event = node_event_from_stream_chunk(payload)
                        if node_event is not None:
                            on_event(node_event)
                            continue
                        terminal = run_result_data_from_terminal_chunk(payload)
                        if terminal is not None:
                            final = terminal
                        error_frame = error_frame or error_from_stream_chunk(payload)
            except Exception as exc:
                from services.dify_builder import trace_diagnostics

                if observation.failed_before_dispatch:
                    preparation_failure = trace_diagnostics.failure_reason(exc)
                    failed_resource = observation.resource_for(exc)
                    trace_diagnostics.report("native_preparation_failed", error=exc)
                else:
                    trace_diagnostics.report("native_outcome_unknown", error=exc)
                # A dispatch/stream exception cannot prove that no effect ran.
                # Retain the attempt and recover only the observed native ID.
                logging.getLogger(__name__).warning("Builder native test acknowledgement was interrupted")
                final = {}
                error_frame = None
            finally:
                close = getattr(response, "close", None)
                if callable(close):
                    close()

        if not stream_run_id and preparation_failure is None:
            recovered = self._recover_confirmed_agent_parent_id(
                actor=actor,
                app_id=app_id,
                session_id=session_id,
                test_input_id=test_input_id,
                graph=graph,
            )
            if recovered:
                self._bind_full_native_id(reservation.id, recovered)
                stream_run_id = recovered

        # Without a native ID, no terminal claim can establish what launched.
        result = (
            self._finish_run(tenant_id, app_id, final, stream_run_id, error_frame=error_frame)
            if stream_run_id or (launch and error_frame is not None)
            else (map_unknown_run_outcome({"id": ""}, []), None)
        )
        run, _ = result
        if preparation_failure is not None:
            run.status = "failed"
            run.error = "Native test preparation failed before workflow worker dispatch."
        # A real Agent control wait is neither a failed workflow nor permission
        # to diagnose/rebuild it. C04 exposes waiting only after the native
        # WorkflowPause has actually persisted; Builder retains its same Run.
        native_row = result[1]
        native_graph = getattr(native_row, "graph_dict", {})
        has_agent = (
            any(
                isinstance(node, dict) and isinstance(node.get("data"), dict) and node["data"].get("type") == "agent"
                for node in native_graph.get("nodes", [])
            )
            if isinstance(native_graph, dict)
            else False
        )
        if native_row is not None and has_agent:
            try:
                paused = str(native_row.status) == "paused"
                receipt = self._settle_confirmed_agent_parent(
                    actor=actor,
                    app_id=app_id,
                    session_id=session_id,
                    test_input_id=test_input_id,
                    native_run_id=run.dify_run_id,
                    paused=paused,
                )
                if paused and receipt is not None:
                    run.status = "running"
                    run.error = "Agent test is waiting for explicit call confirmation; continue the same Run."
                    if pending_pause_event is not None and on_workflow_event is not None:
                        on_workflow_event(pending_pause_event)
                elif receipt is not None and receipt.status == "unknown":
                    run.status = "running"
                    run.error = "Agent effect acknowledgement is unknown; automatic replay is disabled."
            except Exception:
                run.status = "running"
                run.error = "Agent test recovery is pending; automatic replay is disabled."
        if run.verification is None:
            run.verification = RunVerification(
                execution_revision="",
                executed_graph_revision="",
                terminal_outputs=None,
                output_findings=[],
                executed_node_ids=[],
                no_output_dead_branch=False,
            )
        determinate = bool(run.dify_run_id) and run.status in {"succeeded", "failed"}
        prepared_failure = preparation_failure is not None and not run.dify_run_id
        from services.dify_builder.native_runtime_failure import plugin_service_failure

        runtime_failure = plugin_service_failure(run, native_graph) if isinstance(native_graph, Mapping) else None
        run.verification.execution_evidence = ExecutionEvidenceSummary(
            request_id=reservation.id,
            policy_version="builder-confirmed-run-v1",
            mode="confirmed_run",
            sealed=determinate or prepared_failure,
            safety_outcome=(
                "preparation_failed"
                if prepared_failure
                else "execution_evidence_unknown"
                if not determinate
                else "confirmed_run_completed"
                if run.status == "succeeded"
                else "native_failed"
            ),
            simulated_node_ids=tuple(sorted(mocked & {node.node_id for node in run.per_node})),
            sandbox_profile="native",
            native_run_id=run.dify_run_id or None,
            failure_resource=failed_resource if prepared_failure else runtime_failure[0] if runtime_failure else None,
            failure_node_ids=(
                resource_node_ids(graph, failed_resource)
                if prepared_failure
                else runtime_failure[1]
                if runtime_failure
                else ()
            ),
            failure_phase="preparation" if prepared_failure else "execution" if runtime_failure else None,
            failure_reason=preparation_failure
            if prepared_failure
            else "service_unavailable"
            if runtime_failure
            else None,
        )
        bound = self._bind_run(result, app_id, actor, before_revision, before_graph_revision, restricted=False)
        # Pending attempts keep the original revision/mock facts for a later
        # native-row recovery. A terminal snapshot survives a lost Builder CAS.
        if determinate or prepared_failure:
            self._save_full_run_result(reservation.id, bound)
        return bound

    def _run_confirmed_draft(
        self,
        app_id: str,
        actor: Actor,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None,
        consent_id: str,
        command_id: str,
    ) -> Run:
        """Launch one server-reserved confirmed command through the same native generator.

        Authority is reloaded from the consent owner (reserved command, sidecar,
        lineage), never taken from this call's arguments; the saved approved
        input is the only input. Builder preparation sessions are closed before
        generation starts. Every Builder-side projection is sanitized; the
        native authorized Run keeps the message content.
        """
        consent = BuilderRealCallConsentService(_session_factory())
        policy = BuilderExecutionPolicyService(_session_factory())
        try:
            context = consent.reserved_launch(
                actor=actor, session_id=session_id, consent_id=consent_id, command_id=command_id
            )
        except BuilderExecutionPolicyError as error:
            # Not this invocation's launchable command: the grant is not touched.
            return _unsupported_run(error)
        try:
            if (context.app_id, context.test_input_id) != (app_id, test_input_id):
                raise BuilderExecutionPolicyError("execution_owner_mismatch")
            receipt = consent.get(actor=actor, session_id=session_id, consent_id=consent_id)
            if receipt.state != "confirmed":
                raise BuilderExecutionPolicyError(receipt.reason_code or "consent_not_confirmed")
            context = policy.prepare_confirmed(context)
            with _session_factory()() as session:
                account = resolve_account(session, actor)
                app = load_app(session, app_id, actor)
                draft = _load_draft_workflow_or_raise(app, session=session)
                saved = session.get(DifyBuilderTestInput, context.test_input_id)
                if saved is None or saved.session_id != session_id:
                    raise BuilderExecutionPolicyError("test_input_binding_mismatch")
                inputs = dict(saved.inputs)
                try:
                    effective_inputs = dict(
                        BaseAppGenerator()._prepare_user_inputs(
                            user_inputs=inputs,
                            variables=WorkflowVariablesConfigManager.convert(draft),
                            tenant_id=app.tenant_id,
                        )
                    )
                except ValueError:
                    raise BuilderExecutionPolicyError("unsupported_input_value") from None
            if (
                scalar_inputs_digest(inputs) != context.submitted_inputs_digest
                or scalar_inputs_digest(effective_inputs) != context.effective_inputs_digest
            ):
                raise BuilderExecutionPolicyError("test_input_binding_mismatch")
        except BuilderExecutionPolicyError as error:
            if error.reason_code not in _DUPLICATE_LAUNCH_REASONS:
                # A refusal about this grant itself; a duplicate never settles another launch's grant.
                self._settle_confirmed(consent, context)
            return _unsupported_run(error)
        launch = _BuilderExecutionLaunch(policy, context, consent=consent)
        try:
            set_login_user(account)
            # A fresh session for the native generator only; no Builder read is open.
            with _session_factory()() as session:
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
            launch.on_refusal(error)
            return self._finalize_launch(launch, actor, response_completed=False, setup_refusal=error)
        except BaseException:
            self._close_failed_launch(launch)
            raise
        completed, candidate_ids = self._consume_launch(launch, response, on_event, on_workflow_event, sanitize=True)
        return self._finalize_launch(launch, actor, response_completed=completed, candidate_ids=candidate_ids)

    def _consume_launch(
        self,
        launch: _BuilderExecutionLaunch,
        response: Any,
        on_event: Callable[[NodeEvent], None],
        on_workflow_event: Callable[[Mapping[str, object]], None] | None,
        *,
        sanitize: bool,
    ) -> tuple[bool, set[str]]:
        """Consume the native stream outside any Builder session; close or seal it on every exit.

        ``sanitize`` reduces forwarded frames and node events to IDs and statuses.
        """
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
                        on_workflow_event(sanitize_confirmed_stream_event(payload) if sanitize else payload)
                    candidate = run_id_from_stream_chunk(payload)
                    if candidate:
                        candidate_ids.add(candidate)
                    node_event = node_event_from_stream_chunk(payload)
                    if node_event is not None:
                        on_event(sanitize_confirmed_node_event(node_event) if sanitize else node_event)
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
        return completed, candidate_ids

    @staticmethod
    def _settle_confirmed(consent: BuilderRealCallConsentService, context: ConfirmedToolExecutionContext) -> None:
        """Close the grant from its durable facts; a failure leaves it for the reconcile sweeper."""
        try:
            consent.settle_launch(context=context)
        except Exception:
            logging.getLogger(__name__).warning("Builder confirmed grant could not be settled")

    @classmethod
    def _settle_owned_launch(cls, launch: _BuilderExecutionLaunch, completion: TrustedExecutionCompletion) -> None:
        """Settle only a launch this invocation claimed, or one refused for a grant-level reason.

        A delivery that lost the sidecar launch claim to another one must not
        settle the winner's grant while it may still be running.
        """
        if launch.consent is None or not isinstance(launch.context, ConfirmedToolExecutionContext):
            return
        lost = completion.native_run_id is None and (
            completion.refusal is None or completion.refusal.reason_code in _DUPLICATE_LAUNCH_REASONS
        )
        if not lost:
            cls._settle_confirmed(launch.consent, launch.context)

    @classmethod
    def _close_failed_launch(cls, launch: _BuilderExecutionLaunch) -> None:
        completion = launch.finish(response_completed=False)
        try:
            launch.service.seal(request_id=launch.context.request_id, completion=completion)
        except Exception:
            logging.getLogger(__name__).warning("Builder incomplete execution could not be sealed")
        cls._settle_owned_launch(launch, completion)

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
        context = launch.context
        try:
            summary = launch.service.seal(request_id=context.request_id, completion=completion)
        except Exception:
            logging.getLogger(__name__).warning("Builder execution seal unavailable")
            match context:
                case ConfirmedToolExecutionContext():
                    summary = ExecutionEvidenceSummary(
                        request_id=context.request_id,
                        policy_version=context.policy_version,
                        mode=context.mode,
                        sealed=False,
                        safety_outcome="execution_evidence_unknown",
                        sandbox_profile=context.sandbox_profile,
                        consent_id=context.consent_id,
                    )
                case BuilderExecutionContext():
                    summary = ExecutionEvidenceSummary(
                        request_id=context.request_id,
                        mode=context.mode,
                        sealed=False,
                        safety_outcome="execution_evidence_unknown",
                        sandbox_profile=context.sandbox_profile,
                        fixture_digest=context.fixture_digest,
                    )
                case JsonToolExecutionContext():
                    summary = ExecutionEvidenceSummary(
                        request_id=context.request_id,
                        policy_version=context.policy_version,
                        mode=context.mode,
                        sealed=False,
                        safety_outcome="execution_evidence_unknown",
                        sandbox_profile=context.sandbox_profile,
                    )
        # After the seal, so completion is read from this Run's own sealed proof.
        self._settle_owned_launch(launch, completion)
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
        bound = self._bind_run(
            result, launch.context.app_id, actor, launch.context.execution_revision, launch.context.graph_revision
        )
        if isinstance(context, ConfirmedToolExecutionContext):
            # Output findings were derived from native rows above; Builder keeps no content.
            return sanitize_confirmed_run(bound)
        return bound

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
        restricted: bool = True,
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
            if restricted:
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
        """Read public Tool declarations before locking the verified publication draft."""
        with _session_factory()() as read_session:
            app_to_prepare = load_app(read_session, app_id, actor)
        workflow_service = WorkflowService()
        workflow_service.prepare_draft_tool_publish(app_model=app_to_prepare)
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
            workflow = workflow_service.publish_workflow(
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

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
  Agent selections use one binding owner in the same graph transaction. Every
  final Agent node must have a confirmed or retained selection prepared before
  sync. A ``WorkflowHashNotEqualError`` (the draft
  changed since it was read) is re-mapped to the domain ``HashMismatchError``.
- The saved Builder session and inputs own the test attempt. The ordinary
  Workflow or Chatflow debugger runs the loaded draft in the Builder worker.
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

import json
import logging
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import closing
from dataclasses import asdict
from enum import Enum
from typing import TYPE_CHECKING, Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from pydantic import JsonValue
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.dify_builder.changes import describe_changed_nodes
from core.dify_builder.contract import CanvasEvent
from core.dify_builder.input_schema import SYSTEM_QUERY, validate_query
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
    RunVerification,
)
from events.app_event import app_draft_workflow_was_synced
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import set_login_user
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from models.dify_builder import DifyBuilderRun, DifyBuilderSession, DifyBuilderSessionCommit, DifyBuilderTestInput
from models.enums import CreatorUserRole
from models.model import App
from models.workflow import Workflow, WorkflowRun
from repositories.factory import DifyAPIRepositoryFactory
from runtime_contracts.builder.execution import canonical_digest
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.app_generate_service import AppGenerateService
from services.dify_builder import graph_ops
from services.dify_builder.application.execution_policy import (
    BuilderExecutionPolicyError,
    BuilderExecutionRefusal,
)
from services.dify_builder.application.handlers_fix import run_finished_without_output
from services.dify_builder.errors import HashMismatchError, PreflightError, WorkflowNotInitializedError
from services.dify_builder.execution_policy_service import (
    check_execution_permission,
)
from services.dify_builder.identity import load_app, resolve_account
from services.dify_builder.node_policy import proposal_policy_rejections
from services.dify_builder.output_evidence import collect_output_findings
from services.dify_builder.preflight import new_preflight_problems
from services.dify_builder.repository import SqlDifyBuilderRepository
from services.dify_builder.revision import executable_graph_revision, execution_revision, merge_canvas_presentation
from services.dify_builder.run_mapping import (
    TRUNCATED_STREAM_ERROR,
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
from services.workflow_execution_identity import build_workflow_execution_identity
from services.workflow_generation import graph_normalizers
from services.workflow_run_agg import WorkflowRunAgg
from services.workflow_service import WorkflowService

if TYPE_CHECKING:
    from services.dify_builder.agent_binding import (
        AgentBindingAuthorization,
        AgentBindingSelection,
        AgentBindingService,
    )


__all__ = ["WorkflowServiceDifyPort"]


def _session_factory() -> sessionmaker[Session]:
    """One session per adapter call -- never shared/held across calls."""
    return sessionmaker(bind=db.engine, expire_on_commit=False)


def _unwrap_status(status: Any) -> Any:
    """Unwrap a ``graphon`` ``StrEnum``'s ``.value`` if present, else pass through.

    Mirrors ``run_mapping._status_value`` locally so this module doesn't reach
    into another module's private helper.
    """
    return status.value if isinstance(status, Enum) else status


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
    from services.dify_builder.agent_binding import AgentBindingSelection, has_native_roster_binding

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


def _retained_native_agent_selections(
    *, session: Session, actor: Actor, workflow: Workflow, graph: Graph
) -> tuple[Graph, dict[str, "AgentBindingSelection"], dict[str, str]]:
    """Project saved roster bindings into a candidate with unchanged Agent jobs.

    The editor may omit the published snapshot and job projection fields. Fill
    those from the same-node binding and reject any conflicting explicit fields.
    Return the projected graph, verified selections and binding stamps without
    writing to the draft. The writer rechecks the stamps under the draft lock.
    """
    from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
    from models.agent import WorkflowAgentBindingType, WorkflowAgentNodeBinding
    from models.agent_config_entities import WorkflowNodeJobConfig
    from services.dify_builder.agent_binding import AgentBindingSelection, native_node_data
    from services.dify_builder.agent_catalog import AgentCatalogService
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
        return graph, {}, {}
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
    projected_nodes = {}
    for node_id, data in unchanged.items():
        row = by_node.get(node_id)
        graph_binding = data.get("agent_binding")
        if (
            row is None
            or row.binding_type != WorkflowAgentBindingType.ROSTER_AGENT
            or row.agent_id is None
            or row.current_snapshot_id is None
            or not isinstance(graph_binding, Mapping)
        ):
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        expected = native_node_data(
            agent_id=row.agent_id,
            snapshot_id=row.current_snapshot_id,
            node_job=WorkflowNodeJobConfig.model_validate(row.node_job_config_dict),
        )
        projected = {
            **expected,
            **data,
            "agent_binding": {"current_snapshot_id": row.current_snapshot_id, **graph_binding},
        }
        if any(projected.get(key) != value for key, value in expected.items() if key != "title"):
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        projected_nodes[node_id] = projected
    candidates = AgentCatalogService(session).resolve_candidates(
        tenant_id=actor.tenant_id,
        actor_id=actor.account_id,
        app_id=workflow.app_id,
        agent_ids=frozenset(row.agent_id for row in rows if row.agent_id is not None),
    )
    by_agent = {candidate.agent_id: candidate for candidate in candidates}
    retained, stamps = {}, {}
    for node_id, row in by_node.items():
        if row.agent_id is None or row.current_snapshot_id is None:
            raise BuilderExecutionPolicyError("agent_binding_not_prepared")
        candidate = by_agent.get(row.agent_id)
        if candidate is None or candidate.snapshot_id != row.current_snapshot_id:
            raise BuilderExecutionPolicyError("agent_not_available")
        retained[node_id] = AgentBindingSelection(
            agent_id=row.agent_id, snapshot_id=row.current_snapshot_id, capability_digest=candidate.capability_digest
        )
        stamps[node_id] = _agent_binding_stamp(row)
    projected_graph = {
        **graph,
        "nodes": [
            {**node, "data": projected_nodes[node["id"]]} if node.get("id") in projected_nodes else node
            for node in graph["nodes"]
        ],
    }
    return projected_graph, retained, stamps


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
    from services.dify_builder.agent_binding import AgentBindingService, has_native_roster_binding

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






# Refusals meaning another delivery already owns this reserved command's launch.


def _unsupported_run(error: BuilderExecutionPolicyError) -> Run:
    return Run(status="failed", execution_refusal=BuilderExecutionRefusal(reason_code=error.reason_code))


class WorkflowServiceDifyPort:
    """``DifyPort`` implementation backed directly by Dify's own services."""


    def get_app_mode(self, app_id: str, actor: Actor) -> str:
        """Read mode from the persisted app using the same tenant guard as graphs."""
        with _session_factory()() as session:
            return load_app(session, app_id, actor).mode

    def read_task_dsl(self, app_id: str, actor: Actor) -> tuple[dict, str]:
        """Capture an owned draft's credential-safe continuation context.

        Resolve the current draft under the tenant guard; sanitize a context copy
        only. Binding and execution revision still describe the original draft,
        and neither successful capture nor read failures mutate authored state.
        """
        from services.dify_builder.diagnostic_context import redact_dsl_context

        with _session_factory()() as sql:
            app = load_app(sql, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=sql)
            from services.dify_builder.task_controls import draft_binding

            context = redact_dsl_context(
                {
                    "graph": dict(workflow.graph_dict),
                    "features": dict(workflow.features_dict),
                    "environment_variables": [v.model_dump(mode="json") for v in workflow.environment_variables],
                    "conversation_variables": [v.model_dump(mode="json") for v in workflow.conversation_variables],
                }
            )
            return {
                "_draft_binding": {"workflow_id": workflow.id, "digest": draft_binding(workflow)},
                **context,
            }, execution_revision(workflow)

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
                outputs_available=isinstance(node_exec.outputs_dict, Mapping) and not node_exec.outputs_truncated,
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

    def _business_repair_evidence(
        self,
        session: Session,
        *,
        app_id: str,
        actor: Actor,
        builder_run_id: str,
        workflow: Workflow,
        graph: Graph,
        revision: str,
        lock: bool = False,
    ) -> dict[str, JsonValue]:
        """Reconstruct business authority from persisted, fully owned Run facts.

        The final write holds the workflow and Builder session locks, so a
        changed task, confirmed case or native provenance cannot authorize an
        already prepared candidate. No execution or effect recovery occurs.
        """
        from services.dify_builder.business_acceptance import business_failure_context
        from services.dify_builder.revision import executable_graph_revision

        owner_query = (
            select(DifyBuilderSession)
            .join(DifyBuilderRun, DifyBuilderRun.session_id == DifyBuilderSession.id)
            .where(
                DifyBuilderRun.id == builder_run_id,
                DifyBuilderSession.app_id == app_id,
                DifyBuilderSession.tenant_id == actor.tenant_id,
                DifyBuilderSession.owner_account_id == actor.account_id,
            )
        )
        if lock:
            owner_query = owner_query.with_for_update(of=DifyBuilderSession)
        owner = session.execute(owner_query).scalar_one_or_none()
        if owner is None:
            raise PreflightError("Business repair Run is not owned by this Builder session")
        repository = SqlDifyBuilderRepository(_session_factory())
        run = repository.get_run(builder_run_id)
        builder_session, context = repository.get_session(owner.id)
        native = session.execute(
            select(WorkflowRun).where(
                WorkflowRun.id == run.dify_run_id,
                WorkflowRun.tenant_id == actor.tenant_id,
                WorkflowRun.app_id == app_id,
                WorkflowRun.workflow_id == workflow.id,
                WorkflowRun.created_by == actor.account_id,
                WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
                WorkflowRun.status == "succeeded",
            )
        ).scalar_one_or_none()
        graph_revision = executable_graph_revision(graph)
        if (
            native is None
            or run.session_id != owner.id
            or builder_session.app_id != app_id
            or builder_session.tenant_id != actor.tenant_id
            or builder_session.owner_account_id != actor.account_id
            or executable_graph_revision(dict(native.graph_dict)) != graph_revision
        ):
            raise PreflightError("Business repair native Run provenance is unavailable or stale")
        projection = business_failure_context(
            run,
            builder_session,
            context,
            current_revision=revision,
            current_graph_revision=graph_revision,
        )
        if projection is None:
            raise PreflightError("Business repair requires a current confirmed failed business case")
        return {"business_failure": projection.model_dump(mode="json")}

    def apply_repair(
        self,
        app_id: str,
        actor: Actor,
        intents: list[MutationIntent],
        on_canvas: Callable[[dict], None] | None = None,
        *,
        expected_revision: str,
        failed_run_id: str | None = None,
        business_failure_run_id: str | None = None,
        confirmed_resource_ids: Sequence[str] | None = None,
        expected_resource_fingerprints: dict[str, str] | None = None,
        expected_node_resources: dict[str, str] | None = None,
    ) -> ApplyResult:
        from services.dify_builder.task_controls import check_current, lock_execution

        check_current()
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
        if failed_run_id is not None and business_failure_run_id is not None:
            raise PreflightError("Choose one persisted repair evidence source")
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
            if intent.op != "connect" and not (
                intent.op == "insert_between" and intent.args.get("reuse_existing") is True
            ):
                written_nodes.extend(changed)

        from services.dify_builder.resource_grounding import validate_workspace_resources

        if business_failure_run_id is not None:
            from services.dify_builder.condition_evidence import repair_evidence_rejections

            with _session_factory()() as session:
                app = load_app(session, app_id, actor)
                workflow = _load_draft_workflow_or_raise(app, session=session)
                evidence = self._business_repair_evidence(
                    session,
                    app_id=app_id,
                    actor=actor,
                    builder_run_id=business_failure_run_id,
                    workflow=workflow,
                    graph=before_graph,
                    revision=revision,
                )
            evidence_problems = repair_evidence_rejections(before_graph, graph, written_nodes, evidence)
            if evidence_problems:
                raise PreflightError("; ".join(evidence_problems))

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
                from services.dify_builder.task_controls import lock_execution

                lock_execution(session, app_id=app_id)
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

        from services.dify_builder.agent_binding import AgentBindingService

        retained, retained_stamps = {}, {}
        if any(node.get("data", {}).get("type") == "agent" for node in graph.get("nodes", [])):
            with _session_factory()() as session:
                app = load_app(session, app_id, actor)
                workflow = _load_draft_workflow_or_raise(app, session=session)
                if execution_revision(workflow) != revision:
                    raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
                graph, retained, retained_stamps = _retained_native_agent_selections(
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
            from services.dify_builder.task_controls import lock_execution

            lock_execution(session, app_id=app_id)
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            workflow = _load_draft_workflow_or_raise(app, session=session)
            session.refresh(workflow, with_for_update=True)
            if execution_revision(workflow) != revision:
                raise HashMismatchError(f"workflow execution configuration changed: {app_id}")
            if business_failure_run_id is not None:
                from services.dify_builder.condition_evidence import repair_evidence_rejections

                evidence = self._business_repair_evidence(
                    session,
                    app_id=app_id,
                    actor=actor,
                    builder_run_id=business_failure_run_id,
                    workflow=workflow,
                    graph=before_graph,
                    revision=revision,
                    lock=True,
                )
                evidence_problems = repair_evidence_rejections(before_graph, graph, written_nodes, evidence)
                if evidence_problems:
                    raise PreflightError("; ".join(evidence_problems))
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
                commit=binding_service is None,
                )
            if binding_service is not None:
                retirements = binding_service.sync_prepared_bindings(
                    actor=actor, workflow=updated, selections=selections
                )
                session.commit()
            new_hash = execution_revision(updated)

        if binding_service is not None:
            WorkflowAgentRetirementService.retire_unowned(
                tenant_id=actor.tenant_id, agent_ids=retirements, account_id=actor.account_id
            )
            app_draft_workflow_was_synced.send(app, synced_draft_workflow=updated)
        notify_workflow_draft_changed(updated, previous_graph=committed_previous_graph)

        if on_canvas is not None and graph != committed_previous_graph:
            on_canvas({"event": str(CanvasEvent.GRAPH_CHANGED), "cause": "apply"})

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
            from services.dify_builder.task_controls import lock_execution

            lock_execution(session, app_id=app_id)
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
    ) -> Run:
        from services.dify_builder.task_controls import check_current

        check_current()
        return self._run_draft_debugger(
            app_id,
            actor,
            inputs,
            on_event,
            session_id=session_id,
            test_input_id=test_input_id,
            on_workflow_event=on_workflow_event,
        )

    def _reserve_debugger_run(
        self,
        session_id: str,
        test_input_id: str,
        before_revision: str,
        before_graph_revision: str,
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
            ordinary_draft_run=True,
        )
        row = DifyBuilderRun(
            id=reservation_id,
            session_id=session_id,
            kind="native_test_launch",
            inputs_ref=test_input_id,
            status="running",
            immutable=False,
            per_node=[],
            verification=asdict(verification),
        )
        # The unique primary key, rather than a read-before-write or dispatch
        # lease, elects the only invocation allowed to call the native generator.
        try:
            with _session_factory()() as session, session.begin():
                from services.dify_builder.task_controls import lock_execution

                lock_execution(session)
                owner = session.get(DifyBuilderSession, session_id, with_for_update=True)
                if owner is None:
                    raise BuilderExecutionPolicyError("execution_owner_not_found")
                commit = session.scalar(
                    select(DifyBuilderSessionCommit).where(
                        DifyBuilderSessionCommit.session_id == owner.id,
                        DifyBuilderSessionCommit.version == owner.version,
                    )
                )
                if commit is None:
                    raise BuilderExecutionPolicyError("execution_owner_not_found")
                from services.dify_builder.serde import context_from_dict
                from services.dify_builder.task_lifecycle import task_identity

                row.origin_task_id = task_identity(
                    SqlDifyBuilderRepository._to_domain_session(owner), context_from_dict(commit.context)
                )
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
            if row.immutable:
                return
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

    def _run_draft_debugger(
        self,
        app_id: str,
        actor: Actor,
        inputs: Inputs,
        on_event: Callable[[NodeEvent], None],
        *,
        session_id: str,
        test_input_id: str,
        on_workflow_event: Callable[[Mapping[str, object]], None] | None,
    ) -> Run:
        """Run the owned draft with the ordinary debugger and read back its real result.

        One saved input elects at most one launch. The first observed Workflow
        run ID is recorded before forwarding events, so a retry can read that
        run without reissuing a command that may already have caused effects.
        """
        from services.dify_builder.task_controls import lock_execution

        try:
            check_execution_permission(actor, app_id, _session_factory())
        except BuilderExecutionPolicyError as error:
            return _unsupported_run(error)

        with _session_factory()() as session:
            lock_execution(session, app_id=app_id, session_id=session_id)
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            membership = session.scalar(
                select(TenantAccountJoin.role).where(
                    TenantAccountJoin.tenant_id == actor.tenant_id,
                    TenantAccountJoin.account_id == actor.account_id,
                )
            )
            if (
                app.status != "normal"
                or account.status != AccountStatus.ACTIVE
                or membership is None
                or (not dify_config.RBAC_ENABLED and not TenantAccountRole.is_editing_role(membership))
            ):
                return _unsupported_run(BuilderExecutionPolicyError("execution_permission_denied"))
            tenant_id = app.tenant_id
            owner = session.get(DifyBuilderSession, session_id)
            if owner is None or (owner.app_id, owner.tenant_id, owner.owner_account_id) != (
                app_id,
                tenant_id,
                actor.account_id,
            ):
                return _unsupported_run(BuilderExecutionPolicyError("execution_owner_mismatch"))
            saved = session.get(DifyBuilderTestInput, test_input_id) if test_input_id else None
            if (
                saved is None
                or saved.session_id != session_id
                or canonical_digest(saved.inputs) != canonical_digest(dict(inputs))
            ):
                return _unsupported_run(BuilderExecutionPolicyError("test_input_binding_mismatch"))
            if saved.http_fixtures is not None:
                return _unsupported_run(BuilderExecutionPolicyError("unsupported_workflow"))
            draft = _load_draft_workflow_or_raise(app, session=session)
            before_revision = execution_revision(draft)
            before_graph_revision = executable_graph_revision(dict(draft.graph_dict))
            args: dict[str, Any] = {"inputs": dict(inputs)}
            if app.mode == "advanced-chat":
                validate_query(inputs)
                args = {"query": inputs[SYSTEM_QUERY], "inputs": {k: v for k, v in inputs.items() if k != SYSTEM_QUERY}}

        reservation, launch = self._reserve_debugger_run(
            session_id, test_input_id, before_revision, before_graph_revision
        )
        run_id = reservation.dify_run_id
        if not launch:
            if (
                reservation.immutable
                or not run_id
                or reservation.verification is None
                or not reservation.verification.ordinary_draft_run
            ):
                return reservation
            before_revision = reservation.verification.execution_revision
            before_graph_revision = reservation.verification.executed_graph_revision

        final: dict[str, Any] = {}
        error_frame: dict[str, str] | None = None
        paused = False
        if launch:
            set_login_user(account)
            try:
                with _session_factory()() as session:
                    current = _load_draft_workflow_or_raise(app, session=session)
                    if execution_revision(current) != before_revision:
                        raise BuilderExecutionPolicyError("revision_changed")
                    response = AppGenerateService._run_with_guardrails(
                        app_model=app,
                        streaming=True,
                        action=lambda rate_limit, request_id: rate_limit.generate(
                            self._start_draft_debugger(app=app, account=account, draft=current, args=args, session=session),
                            request_id
                        ),
                    )
                if isinstance(response, Mapping):
                    final = dict(response.get("data") or {})
                    run_id = str(final.get("id") or response.get("workflow_run_id") or "")
                    paused = final.get("status") == "paused"
                    self._bind_full_native_id(reservation.id, run_id)
                else:
                    with closing(response):
                        for chunk in response:
                            payload = stream_chunk_as_mapping(chunk)
                            if payload is not None:
                                candidate = run_id_from_stream_chunk(payload)
                                if candidate and candidate != run_id:
                                    self._bind_full_native_id(reservation.id, candidate)
                                    run_id = candidate
                                if on_workflow_event is not None:
                                    on_workflow_event(payload)
                                event = node_event_from_stream_chunk(payload)
                                if event is not None:
                                    on_event(event)
                                terminal = run_result_data_from_terminal_chunk(payload)
                                if terminal is not None:
                                    final = terminal
                                    paused = payload.get("event") == "workflow_paused"
                                error_frame = error_frame or error_from_stream_chunk(payload)
            except BuilderExecutionPolicyError as error:
                # No generator starts if the loaded draft drifted. Complete the
                # reservation so it never appears as an active test.
                run = _unsupported_run(error)
                self._save_full_run_result(reservation.id, run)
                return run
            except Exception:
                # This stream can fail after dispatch. Only its owned run row
                # can establish the outcome, and the original attempt remains reserved.
                logging.getLogger(__name__).warning("Builder draft debugger stream interrupted")
                final = {}
                error_frame = None

        result = self._finish_run(tenant_id, app_id, final, run_id, error_frame=error_frame)
        run, row = result
        run = self._bind_run(result, app_id, actor, before_revision, before_graph_revision)
        stored_status = str(row.status) if row is not None else ""
        if run.status == "succeeded" and stored_status != "succeeded":
            run.status = "running"
            run.error = TRUNCATED_STREAM_ERROR
        if paused or stored_status == "paused":
            run.status = "running"
            run.error = ""
        if row is not None and run.verification is not None:
            run.verification.ordinary_draft_run = True
        if stored_status in {"succeeded", "failed", "stopped", "partial-succeeded"}:
            self._save_full_run_result(reservation.id, run)
        return run







    @staticmethod
    def _start_draft_debugger(
        app: App, account: Account, draft: Workflow, args: Mapping[str, Any], session: Session
    ) -> Generator[str] | Mapping[str, Any]:
        """Start the existing debugger on the loaded draft and stream its normal events.

        The caller owns the actor, draft revision and durable attempt. The generators
        receive the exact loaded draft and use ordinary execution and pause persistence.
        """
        pause = PauseStateLayerConfig(session_factory=_session_factory(), state_owner_user_id=draft.created_by)
        if app.mode == "advanced-chat":
            generator = AdvancedChatAppGenerator(execution_driver=WorkflowRunAgg.run)
            return generator.convert_to_event_stream(generator.generate(
                app_model=app,
                workflow=draft,
                user=account,
                args=args,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_run_id=str(uuid4()),
                streaming=True,
                pause_state_config=pause,
                session=session,
            ))
        session.commit()
        generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
        return generator.convert_to_event_stream(generator.generate(
            app_model=app,
            workflow=draft,
            execution_identity=build_workflow_execution_identity(account),
            user=account,
            args=args,
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
            call_depth=0,
            pause_state_config=pause,
        ))

    def graph_revision(self, graph: Graph) -> str:
        return executable_graph_revision(graph)

    def _bind_run(
        self,
        result: tuple[Run, Any],
        app_id: str,
        actor: Actor,
        before_revision: str,
        before_graph_revision: str,
    ) -> Run:
        """Bind only the actual persisted run graph and equal before/after full revisions.

        Native persistence does not snapshot non-graph configuration: a transient
        non-graph A→B→A change is outside this guarantee. No execution transaction
        is held open across stream consumption or provider I/O.
        """
        run, row = result
        native_graph = row.graph_dict if row is not None else None
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
        """Publish the owned draft only while its verified revision still matches."""
        workflow_service = WorkflowService()
        with _session_factory()() as session:
            from services.dify_builder.task_controls import lock_execution

            lock_execution(session, app_id=app_id)
            account = resolve_account(session, actor)
            app = load_app(session, app_id, actor)
            # Publication writes the App pointer after locking the draft. Keep
            # metadata writers App-first while graph-only callers stay row-first.
            owner_id = session.scalar(
                select(App.id).where(App.id == app_id, App.tenant_id == actor.tenant_id).with_for_update()
            )
            if owner_id is None:
                from core.dify_builder.errors import NotFoundError

                raise NotFoundError(f"app not found: {app_id}")

            draft = _load_draft_workflow_or_raise(app, session=session)
            session.refresh(draft, with_for_update=True)
            if (
                not expected_revision
                or not expected_graph_revision
                or execution_revision(draft) != expected_revision
                or executable_graph_revision(dict(draft.graph_dict)) != expected_graph_revision
            ):
                raise HashMismatchError(f"workflow verification is stale: {app_id}")
            workflow = workflow_service.publish_workflow(
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
            return PublishResult(
                version_name=workflow.marked_name or f"# {workflow.version_number}",
                status="live",
            )

"""Node Output Inspector service (Stage 4 §8).

PRD §Node Output Inspector renames every workflow "Variable" to a "Node Output"
and re-organizes the panel by **producer node** rather than consumer node. This
service backs the new REST surface
``/apps/{app_id}/workflows/draft/runs/{run_id}/node-outputs[/...]`` with three
read-only views:

* :meth:`snapshot_workflow_run` — every node + its declared outputs + per-output
  status, for one debug workflow run.
* :meth:`node_detail` — the same shape filtered down to one node.
 * :meth:`output_preview` — full payload for one output, with signed download
   URL when the output is a canonical Agent v2 file mapping.

Design constraints baked into this version:

1. **No new tables** (§8.1). Topology comes from ``WorkflowRun.graph`` (the
   graph snapshot taken at execution time so the view stays consistent even
   if the draft was edited mid-run). Execution facts come from
   ``WorkflowNodeExecutionModel`` rows already produced by the workflow
   runtime.
2. **Draft + published runs** (decision D-1 lifted 2026-05-26). The Inspector
   accepts ``WorkflowRunTriggeredFrom.DEBUGGING`` (draft test runs) as well as
   ``APP_RUN`` / ``WEBHOOK`` / ``SCHEDULE`` / ``PLUGIN`` / ``RAG_PIPELINE_*``
   triggers; the underlying graph + executions are uniform across all of them.
   Cross-tenant / cross-app rows still 404 via the standard tenant/app scope.
3. **Declared outputs by node kind**:
   * Agent v2 nodes resolve their declared list via
     :class:`WorkflowAgentBindingResolver` (the binding owns the canonical
     ``DeclaredOutputConfig`` list and falls back to PRD defaults when empty).
   * Other node kinds don't have a declared-output schema yet; we surface the
     keys present in the execution payload as a best-effort list typed
     ``unknown`` so the panel can still render them.
4. **Per-output status** is derived from the metadata the agent_v2 stack
   already records (``output_type_check`` and ``output_check`` blobs); falling
   back to the node's overall status when those signals aren't present.
5. **SSE stream** (design §8.5) lives in
   :mod:`controllers.console.app.workflow_node_output_inspector` alongside the
   REST endpoints. The Inspector and the babysit chat SSE share the
   ``{event, data, id}`` envelope per decision D-5.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.workflow.nodes.agent_v2.binding_resolver import (
    WorkflowAgentBindingError,
    WorkflowAgentBindingResolver,
)
from core.workflow.nodes.agent_v2.runtime_request_builder import (
    WorkflowAgentRuntimeRequestBuilder,
)
from factories.file_factory.builders import build_from_mapping
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionStatus,
)
from graphon.file import helpers as file_helpers
from core.app.file_access import DatabaseFileAccessController
from models import App
from models.agent_config_entities import DeclaredOutputConfig, DeclaredOutputType
from models.workflow import WorkflowNodeExecutionModel, WorkflowRun

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Public dataclasses / enums (Pydantic — these go straight on the wire)
# ──────────────────────────────────────────────────────────────────────────────


class NodeOutputStatus(StrEnum):
    """Lifecycle status of a single declared output within a run."""

    PENDING = "pending"  # node not started
    RUNNING = "running"  # node running, output not ready yet
    READY = "ready"
    TYPE_CHECK_FAILED = "type_check_failed"
    OUTPUT_CHECK_FAILED = "output_check_failed"
    NOT_PRODUCED = "not_produced"  # node succeeded but did not produce this declared output
    FAILED = "failed"  # node itself failed/exception/stopped


class NodeStatus(StrEnum):
    """Coarse node-level status used by Inspector to pick a banner."""

    IDLE = "idle"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


class CheckResultView(BaseModel):
    """``type_check`` / ``output_check`` per-output summary block."""

    model_config = ConfigDict(extra="forbid")

    passed: bool
    reason: str | None = None


class NodeOutputView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    type: DeclaredOutputType | None = None
    status: NodeOutputStatus
    value_preview: Any = None
    type_check: CheckResultView | None = None
    output_check: CheckResultView | None = None
    retried: int = 0


class NodeOutputsView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str
    node_kind: str
    node_display_name: str
    node_status: NodeStatus
    node_started_at: datetime | None = None
    node_completed_at: datetime | None = None
    outputs: list[NodeOutputView] = Field(default_factory=list)


class WorkflowRunSnapshotView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_run_id: str
    workflow_run_status: WorkflowExecutionStatus
    node_outputs: list[NodeOutputsView] = Field(default_factory=list)


class OutputPreviewView(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str
    output_name: str
    type: DeclaredOutputType | None = None
    status: NodeOutputStatus
    value: Any = None  # full value (with signed URL for file refs)


class NodeOutputInspectorError(Exception):
    """Raised when a request cannot be served (404-level conditions)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers — declared outputs per node
# ──────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class _ResolvedDeclaration:
    """Declared output the Inspector should expose, with a normalized type.

    ``inferred`` is ``True`` when the node kind has no declared-output schema
    (we derived the list from the execution payload). The frontend can use
    this to dim the type column.
    """

    name: str
    declared_type: DeclaredOutputType | None
    array_item_type: DeclaredOutputType | None
    inferred: bool


def _is_agent_v2_node(node: Mapping[str, Any]) -> bool:
    """A graph node is Agent v2 iff its ``data.type`` is the AGENT builtin
    AND its ``data.version`` is ``"2"``.

    ``BuiltinNodeTypes.AGENT`` is a ``ClassVar[NodeType]`` (plain string), not
    a StrEnum, so we compare against it directly without ``.value``.
    """
    data = node.get("data") or {}
    if not isinstance(data, Mapping):
        return False
    if data.get("type") != BuiltinNodeTypes.AGENT:
        return False
    return str(data.get("version", "")) == "2"


def _graph_nodes(workflow_run: WorkflowRun) -> list[Mapping[str, Any]]:
    """Parse ``WorkflowRun.graph`` (LongText JSON) into a node list.

    The graph blob may be missing / unparseable for very old runs; we treat
    that as "no nodes" rather than failing the Inspector, so the panel still
    renders an empty state.
    """
    if not workflow_run.graph:
        return []
    try:
        parsed = json.loads(workflow_run.graph)
    except (json.JSONDecodeError, TypeError):
        logger.warning("NodeOutputInspector: workflow_run %s has unparseable graph blob", workflow_run.id)
        return []
    if not isinstance(parsed, Mapping):
        return []
    nodes = parsed.get("nodes")
    if not isinstance(nodes, list):
        return []
    return [n for n in nodes if isinstance(n, Mapping) and "id" in n]


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers — per-output status derivation
# ──────────────────────────────────────────────────────────────────────────────


def _decode_json_blob(blob: str | None) -> Mapping[str, Any] | None:
    if not blob:
        return None
    try:
        decoded = json.loads(blob)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(decoded, Mapping):
        return None
    return decoded


def _node_status_for(execution: WorkflowNodeExecutionModel | None) -> NodeStatus:
    if execution is None:
        return NodeStatus.IDLE
    if execution.status == WorkflowNodeExecutionStatus.RUNNING:
        return NodeStatus.RUNNING
    if execution.status == WorkflowNodeExecutionStatus.SUCCEEDED:
        return NodeStatus.READY
    return NodeStatus.FAILED


def _type_check_by_name(metadata: Mapping[str, Any] | None) -> dict[str, Mapping[str, Any]]:
    if not metadata:
        return {}
    block = metadata.get("output_type_check")
    if not isinstance(block, Mapping):
        return {}
    results = block.get("results") or []
    if not isinstance(results, list):
        return {}
    indexed: dict[str, Mapping[str, Any]] = {}
    for r in results:
        if isinstance(r, Mapping) and isinstance(r.get("name"), str):
            indexed[r["name"]] = r
    return indexed


def _output_check_by_name(metadata: Mapping[str, Any] | None) -> dict[str, Mapping[str, Any]]:
    if not metadata:
        return {}
    block = metadata.get("output_check")
    if not isinstance(block, Mapping):
        return {}
    results = block.get("results") or []
    if not isinstance(results, list):
        return {}
    indexed: dict[str, Mapping[str, Any]] = {}
    for r in results:
        if isinstance(r, Mapping) and isinstance(r.get("name"), str):
            indexed[r["name"]] = r
    return indexed


def _retried_attempt_count(metadata: Mapping[str, Any] | None) -> int:
    """The agent_v2 runtime records the final attempt index in metadata.

    ``attempt`` is 0-indexed so a single execution with no retry has
    ``attempt == 0`` and a Inspector-friendly ``retried == 0``.
    """
    if not metadata:
        return 0
    attempt = metadata.get("attempt")
    if isinstance(attempt, int) and attempt > 0:
        return attempt
    return 0


# ──────────────────────────────────────────────────────────────────────────────
# Value preview (file refs get signed URLs)
# ──────────────────────────────────────────────────────────────────────────────


_PREVIEW_TEXT_LIMIT = 500
def _looks_like_file_ref(value: Any) -> bool:
    """Return whether ``value`` looks like a canonical Agent v2 file mapping."""
    if not isinstance(value, Mapping):
        return False
    transfer_method = value.get("transfer_method")
    if transfer_method == "remote_url":
        return isinstance(value.get("url"), str) and bool(value.get("url"))
    return isinstance(transfer_method, str) and isinstance(value.get("reference"), str) and bool(value.get("reference"))


def _resolve_preview_url(value: Mapping[str, Any], *, tenant_id: str) -> str | None:
    """Resolve one canonical file mapping into its preview/download URL.

    Agent v2 output files now use the same ``transfer_method`` +
    ``reference``/``url`` mapping contract as the back-proxy download request,
    so the Inspector rebuilds a graphon ``File`` through the standard factory
    path instead of trying to special-case upload/tool file ids itself.
    """
    file = build_from_mapping(
        mapping=value,
        tenant_id=tenant_id,
        access_controller=DatabaseFileAccessController(),
    )
    return file_helpers.resolve_file_url(file)


def _value_preview(value: Any, *, tenant_id: str, declaration: _ResolvedDeclaration) -> Any:
    """Compact preview suitable for the snapshot endpoint.

    Canonical file mappings are augmented with a signed download URL only when
    the declared output is ``FILE`` or ``ARRAY[FILE]``. Canonical-looking
    mappings nested inside ``OBJECT`` or non-file arrays remain plain JSON so
    the Inspector does not introduce a nested file protocol the runtime itself
    does not promise. Long strings are truncated; other scalar / dict / list
    shapes are returned as-is (the Pydantic layer enforces JSON-safety on
    serialization).
    """
    if declaration.declared_type == DeclaredOutputType.FILE and _looks_like_file_ref(value):
        assert isinstance(value, Mapping)
        try:
            preview_url = _resolve_preview_url(value, tenant_id=tenant_id)
        except Exception:
            logger.warning("NodeOutputInspector: signed URL failed for file mapping=%s", value, exc_info=True)
            preview_url = None
        return {**dict(value), "preview_url": preview_url}
    if (
        declaration.declared_type == DeclaredOutputType.ARRAY
        and declaration.array_item_type == DeclaredOutputType.FILE
        and isinstance(value, list)
        and all(_looks_like_file_ref(item) for item in value)
    ):
        resolved_items: list[Any] = []
        for item in value:
            assert isinstance(item, Mapping)
            try:
                preview_url = _resolve_preview_url(item, tenant_id=tenant_id)
            except Exception:
                logger.warning("NodeOutputInspector: signed URL failed for file mapping=%s", item, exc_info=True)
                preview_url = None
            resolved_items.append({**dict(item), "preview_url": preview_url})
        return resolved_items
    if isinstance(value, str) and len(value) > _PREVIEW_TEXT_LIMIT:
        return value[:_PREVIEW_TEXT_LIMIT] + "…"
    return value


def _full_value(value: Any, *, tenant_id: str, declaration: _ResolvedDeclaration) -> Any:
    """Same shape as :func:`_value_preview` minus the truncation.

    As with preview values, only outputs declared as ``FILE`` or
    ``ARRAY[FILE]`` get signed URL augmentation; non-file outputs keep their raw
    JSON payload unchanged even if it resembles a canonical file mapping.
    """
    if declaration.declared_type == DeclaredOutputType.FILE and _looks_like_file_ref(value):
        assert isinstance(value, Mapping)
        try:
            preview_url = _resolve_preview_url(value, tenant_id=tenant_id)
        except Exception:
            logger.warning("NodeOutputInspector: signed URL failed for file mapping=%s", value, exc_info=True)
            preview_url = None
        return {**dict(value), "preview_url": preview_url}
    if (
        declaration.declared_type == DeclaredOutputType.ARRAY
        and declaration.array_item_type == DeclaredOutputType.FILE
        and isinstance(value, list)
        and all(_looks_like_file_ref(item) for item in value)
    ):
        resolved_items: list[Any] = []
        for item in value:
            assert isinstance(item, Mapping)
            try:
                preview_url = _resolve_preview_url(item, tenant_id=tenant_id)
            except Exception:
                logger.warning("NodeOutputInspector: signed URL failed for file mapping=%s", item, exc_info=True)
                preview_url = None
            resolved_items.append({**dict(item), "preview_url": preview_url})
        return resolved_items
    return value


# ──────────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────────


class NodeOutputInspectorService:
    """Read-only Inspector for draft + published workflow runs.

    The service is dependency-light: it holds a single
    :class:`WorkflowAgentBindingResolver` so agent v2 nodes can map to their
    declared outputs without re-implementing binding lookup. All other I/O
    uses the global session factory so workflow runs / executions stay on the
    repo-default code path.

    Tenancy is enforced via ``app_model.tenant_id`` + ``app_model.id`` on
    every load — the same scope guard regardless of trigger source.
    """

    def __init__(self, binding_resolver: WorkflowAgentBindingResolver | None = None) -> None:
        self._binding_resolver = binding_resolver or WorkflowAgentBindingResolver()

    # ── public API ────────────────────────────────────────────────────────

    def snapshot_workflow_run(self, *, app_model: App, workflow_run_id: str) -> WorkflowRunSnapshotView:
        """Build the per-node snapshot for one debug workflow run."""
        workflow_run, executions = self._load_run_and_executions(app_model=app_model, workflow_run_id=workflow_run_id)
        executions_by_node = self._index_executions_by_node(executions)
        graph_nodes = _graph_nodes(workflow_run)

        node_views: list[NodeOutputsView] = []
        for raw_node in graph_nodes:
            node_id = str(raw_node["id"])
            execution = executions_by_node.get(node_id)
            view = self._build_node_view(
                tenant_id=app_model.tenant_id,
                app_id=app_model.id,
                workflow_id=workflow_run.workflow_id,
                raw_node=raw_node,
                execution=execution,
            )
            node_views.append(view)

        return WorkflowRunSnapshotView(
            workflow_run_id=workflow_run.id,
            workflow_run_status=workflow_run.status,
            node_outputs=node_views,
        )

    def node_detail(self, *, app_model: App, workflow_run_id: str, node_id: str) -> NodeOutputsView:
        """Per-node Inspector entry — returns one ``NodeOutputsView``."""
        workflow_run, executions = self._load_run_and_executions(app_model=app_model, workflow_run_id=workflow_run_id)
        graph_nodes = _graph_nodes(workflow_run)
        raw_node = next((n for n in graph_nodes if str(n.get("id")) == node_id), None)
        if raw_node is None:
            raise NodeOutputInspectorError(
                "node_not_in_workflow_run",
                f"Node {node_id!r} does not appear in workflow run {workflow_run_id!r}.",
            )

        execution = self._index_executions_by_node(executions).get(node_id)
        return self._build_node_view(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_id=workflow_run.workflow_id,
            raw_node=raw_node,
            execution=execution,
        )

    def output_preview(
        self,
        *,
        app_model: App,
        workflow_run_id: str,
        node_id: str,
        output_name: str,
    ) -> OutputPreviewView:
        """Full payload for one declared output (with signed file URL)."""
        workflow_run, executions = self._load_run_and_executions(app_model=app_model, workflow_run_id=workflow_run_id)
        graph_nodes = _graph_nodes(workflow_run)
        raw_node = next((n for n in graph_nodes if str(n.get("id")) == node_id), None)
        if raw_node is None:
            raise NodeOutputInspectorError(
                "node_not_in_workflow_run",
                f"Node {node_id!r} does not appear in workflow run {workflow_run_id!r}.",
            )

        execution = self._index_executions_by_node(executions).get(node_id)
        detail = self._build_node_view(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_id=workflow_run.workflow_id,
            raw_node=raw_node,
            execution=execution,
        )
        view = next((o for o in detail.outputs if o.name == output_name), None)
        if view is None:
            raise NodeOutputInspectorError(
                "node_output_not_declared",
                f"Output {output_name!r} is not declared on node {node_id!r}.",
            )
        declaration = next((d for d in self._resolve_declared_outputs(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            workflow_id=workflow_run.workflow_id,
            node_id=node_id,
            raw_node=raw_node,
            execution=execution,
        ) if d.name == output_name), _ResolvedDeclaration(name=output_name, declared_type=view.type, array_item_type=None, inferred=True))

        # ``node_detail`` already produced a truncated value_preview; reload
        # the raw value from the execution payload so the preview endpoint can
        # return the full thing (still wrapped through ``_full_value`` for
        # signed file URLs).
        full_value: Any = None
        if execution is not None:
            outputs = _decode_json_blob(execution.outputs) or {}
            if output_name in outputs:
                full_value = _full_value(outputs[output_name], tenant_id=app_model.tenant_id, declaration=declaration)

        return OutputPreviewView(
            node_id=node_id,
            output_name=output_name,
            type=view.type,
            status=view.status,
            value=full_value,
        )

    # ── DB loading ────────────────────────────────────────────────────────

    def _load_run_and_executions(
        self, *, app_model: App, workflow_run_id: str
    ) -> tuple[WorkflowRun, Sequence[WorkflowNodeExecutionModel]]:
        """Fetch the ``WorkflowRun`` row + every execution that belongs to it.

        Enforces:
          * row exists,
          * row belongs to the app's tenant + app.

        The trigger source (DEBUGGING vs. APP_RUN / WEBHOOK / SCHEDULE / ...) is
        deliberately not checked here — D-1 was lifted 2026-05-26 and the
        Inspector now serves both draft and published runs.
        """
        with session_factory.create_session() as session:
            workflow_run = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == workflow_run_id,
                    WorkflowRun.app_id == app_model.id,
                    WorkflowRun.tenant_id == app_model.tenant_id,
                )
            )
            if workflow_run is None:
                raise NodeOutputInspectorError("workflow_run_not_found", "Workflow run not found.")

            executions = session.scalars(
                select(WorkflowNodeExecutionModel).where(
                    WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                    WorkflowNodeExecutionModel.tenant_id == app_model.tenant_id,
                    WorkflowNodeExecutionModel.app_id == app_model.id,
                )
            ).all()

        return workflow_run, executions

    @staticmethod
    def _index_executions_by_node(
        executions: Sequence[WorkflowNodeExecutionModel],
    ) -> dict[str, WorkflowNodeExecutionModel]:
        """Keep the latest execution per ``node_id``.

        A given node may have multiple rows when retries or iterations occur;
        ``index`` is the per-run sequence counter, so we keep the one with
        the highest index as the canonical "current" view.
        """
        latest: dict[str, WorkflowNodeExecutionModel] = {}
        for execution in executions:
            existing = latest.get(execution.node_id)
            if existing is None or execution.index > existing.index:
                latest[execution.node_id] = execution
        return latest

    # ── Per-node view construction ────────────────────────────────────────

    def _build_node_view(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        raw_node: Mapping[str, Any],
        execution: WorkflowNodeExecutionModel | None,
    ) -> NodeOutputsView:
        node_id = str(raw_node["id"])
        data = raw_node.get("data") or {}
        if not isinstance(data, Mapping):
            data = {}

        node_kind = str(data.get("type") or (execution.node_type if execution else "") or "unknown")
        display_name = str(data.get("title") or (execution.title if execution else node_id))
        node_status = _node_status_for(execution)

        declarations = self._resolve_declared_outputs(
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            node_id=node_id,
            raw_node=raw_node,
            execution=execution,
        )

        outputs_dict = _decode_json_blob(execution.outputs) if execution else None
        metadata_dict = _decode_json_blob(execution.execution_metadata) if execution else None
        type_check_by_name = _type_check_by_name(metadata_dict)
        output_check_by_name = _output_check_by_name(metadata_dict)
        retried = _retried_attempt_count(metadata_dict)

        output_views: list[NodeOutputView] = []
        for declaration in declarations:
            output_views.append(
                self._build_output_view(
                    tenant_id=tenant_id,
                    declaration=declaration,
                    node_status=node_status,
                    outputs_dict=outputs_dict,
                    type_check_by_name=type_check_by_name,
                    output_check_by_name=output_check_by_name,
                    retried=retried,
                )
            )

        return NodeOutputsView(
            node_id=node_id,
            node_kind=node_kind,
            node_display_name=display_name,
            node_status=node_status,
            node_started_at=execution.created_at if execution else None,
            node_completed_at=execution.finished_at if execution else None,
            outputs=output_views,
        )

    def _build_output_view(
        self,
        *,
        tenant_id: str,
        declaration: _ResolvedDeclaration,
        node_status: NodeStatus,
        outputs_dict: Mapping[str, Any] | None,
        type_check_by_name: Mapping[str, Mapping[str, Any]],
        output_check_by_name: Mapping[str, Mapping[str, Any]],
        retried: int,
    ) -> NodeOutputView:
        name = declaration.name
        declared_type = declaration.declared_type

        if node_status == NodeStatus.IDLE:
            return NodeOutputView(
                name=name,
                type=declared_type,
                status=NodeOutputStatus.PENDING,
                retried=retried,
            )
        if node_status == NodeStatus.RUNNING:
            return NodeOutputView(
                name=name,
                type=declared_type,
                status=NodeOutputStatus.RUNNING,
                retried=retried,
            )
        if node_status == NodeStatus.FAILED:
            return NodeOutputView(
                name=name,
                type=declared_type,
                status=NodeOutputStatus.FAILED,
                retried=retried,
            )

        # ── node succeeded ────────────────────────────────────────────
        type_check_result = type_check_by_name.get(name)
        output_check_result = output_check_by_name.get(name)
        type_check_view = self._coerce_check_view(type_check_result)
        output_check_view = self._coerce_check_view(output_check_result)

        # type check loses first; output check next; otherwise ready.
        status: NodeOutputStatus
        if type_check_result and not _is_passing(type_check_result):
            status = NodeOutputStatus.TYPE_CHECK_FAILED
        elif output_check_result and not _is_passing(output_check_result):
            status = NodeOutputStatus.OUTPUT_CHECK_FAILED
        elif outputs_dict is not None and name not in outputs_dict:
            status = NodeOutputStatus.NOT_PRODUCED
        else:
            status = NodeOutputStatus.READY

        value_preview = (
            _value_preview(outputs_dict.get(name), tenant_id=tenant_id, declaration=declaration)
            if outputs_dict and name in outputs_dict
            else None
        )

        return NodeOutputView(
            name=name,
            type=declared_type,
            status=status,
            value_preview=value_preview,
            type_check=type_check_view,
            output_check=output_check_view,
            retried=retried,
        )

    @staticmethod
    def _coerce_check_view(result: Mapping[str, Any] | None) -> CheckResultView | None:
        if not result:
            return None
        # type_check rows use ``status``; output_check rows use ``status`` too —
        # both record per-output state. We treat ``status == "ready"``/"passed"
        # as passing and everything else as failing, so the view stays
        # stable regardless of which producer wrote the metadata.
        return CheckResultView(passed=_is_passing(result), reason=result.get("reason"))

    # ── Declared-output resolution ────────────────────────────────────────

    def _resolve_declared_outputs(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
        raw_node: Mapping[str, Any],
        execution: WorkflowNodeExecutionModel | None,
    ) -> list[_ResolvedDeclaration]:
        if _is_agent_v2_node(raw_node):
            agent_decl = self._declared_outputs_for_agent_v2(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                node_id=node_id,
            )
            if agent_decl is not None:
                return [
                    _ResolvedDeclaration(
                        name=o.name,
                        declared_type=o.type,
                        array_item_type=o.array_item.type if o.array_item is not None else None,
                        inferred=False,
                    )
                    for o in agent_decl
                ]

        # Non-agent (or agent-binding-missing) fall back to inferring from the
        # produced payload so the Inspector still has something to show.
        return self._infer_outputs_from_payload(execution=execution)

    def _declared_outputs_for_agent_v2(
        self,
        *,
        tenant_id: str,
        app_id: str,
        workflow_id: str,
        node_id: str,
    ) -> list[DeclaredOutputConfig] | None:
        try:
            bundle = self._binding_resolver.resolve(
                tenant_id=tenant_id,
                app_id=app_id,
                workflow_id=workflow_id,
                node_id=node_id,
            )
        except WorkflowAgentBindingError:
            return None
        try:
            from models.agent_config_entities import WorkflowNodeJobConfig

            node_job = WorkflowNodeJobConfig.model_validate(bundle.binding.node_job_config_dict)
        except Exception:
            logger.warning(
                "NodeOutputInspector: malformed node_job_config for binding %s", bundle.binding.id, exc_info=True
            )
            return None
        return list(WorkflowAgentRuntimeRequestBuilder.effective_declared_outputs(list(node_job.declared_outputs)))

    @staticmethod
    def _infer_outputs_from_payload(*, execution: WorkflowNodeExecutionModel | None) -> list[_ResolvedDeclaration]:
        if execution is None:
            return []
        outputs = _decode_json_blob(execution.outputs)
        if not outputs:
            return []
        return [_ResolvedDeclaration(name=name, declared_type=None, array_item_type=None, inferred=True) for name in outputs]


def _is_passing(result: Mapping[str, Any]) -> bool:
    """A check-result row is "passing" when its ``status`` is the ready/passed
    sentinel emitted by the type-checker / output-check executor."""
    status = result.get("status")
    if status in {"ready", "passed", "not_produced"}:
        return True
    return False

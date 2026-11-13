"""Thin Graphon adapters for External agents; durable business state lives in services."""

from __future__ import annotations

import json
from collections.abc import Callable, Generator, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any, Literal, override
from uuid import uuid4

from pydantic import Field, model_validator
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.workflow_references import WORKFLOW_VARIABLE_PATTERN, extract_workflow_variable_selectors
from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext, InvokeFrom, UserFrom
from core.app.file_access import get_current_file_access_scope, grant_upload_file_access
from core.workflow.system_variables import SystemVariableKey, get_system_text
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.pause_reason import ExternalWaitReason
from graphon.enums import (
    BuiltinNodeTypes,
    ErrorStrategy,
    NodeType,
    WorkflowExecutionStatus,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.file import File
from graphon.file.enums import FileTransferMethod
from graphon.node_events import NodeEventPayload, NodeRunResult, StreamCompletedEvent
from graphon.node_events.node import PauseRequestedEvent
from graphon.nodes.base.node import Node
from graphon.runtime import InitParams, RuntimeState
from graphon.variables.segments import ArrayFileSegment, FileSegment
from models.external_agent import ExternalAgentCommand
from models.external_agent_trace import ExternalAgentDataTombstone
from models.workflow import WorkflowNodeExecutionModel, WorkflowPause, WorkflowRun
from services.external_agents.file_profile import render_task_value
from services.external_agents.invocation_service import ExternalInvocationService
from services.external_agents.io_contracts import JsonObject, JsonValue, OutputField
from services.external_agents.output_mapping import normalize_node_defaults
from services.external_agents.runtime_contracts import (
    ExecutionIdentity,
    InvocationDraft,
    InvocationStore,
    LocalState,
    RuntimeError,
    RuntimeScope,
)
from services.external_agents.workflow_runtime import (
    ExternalGraphBinding,
    ExternalNodeJob,
    ExternalOutputDeclaration,
    ExternalWaitConfig,
    ExternalWorkflowRuntime,
    WorkflowBindingReader,
)


class ExternalAgentNodeData(BaseNodeData):
    type: NodeType = BuiltinNodeTypes.AGENT
    version: str = "2"
    agent_node_kind: Literal["external_a2a"] = "external_a2a"
    agent_binding: ExternalGraphBinding = Field(default_factory=ExternalGraphBinding)
    agent_task: str = ""
    agent_declared_outputs: tuple[ExternalOutputDeclaration, ...] = ()
    external_wait: ExternalWaitConfig = Field(default_factory=ExternalWaitConfig)

    @model_validator(mode="before")
    @classmethod
    def validate_raw_job(cls, value: object) -> object:
        data = value.model_dump(exclude_unset=True) if isinstance(value, BaseNodeData) else value
        if isinstance(data, Mapping):
            if str(data.get("version", "2")) != "2":
                raise ValueError("External nodes require version=2.")
            job = ExternalNodeJob.parse_graph(data)
            retry = data.get("retry_config")
            if isinstance(retry, Mapping) and retry.get("retry_enabled"):
                raise ValueError("External business execution cannot use generic node retries.")
            defaults = data.get("default_value") or []
            raw_defaults = {item["key"]: item.get("value") for item in defaults if isinstance(item, Mapping)}
            job.validate_node_defaults(raw_defaults)
        return data


def workflow_scope(context: DifyRunContext) -> RuntimeScope:
    """Derive provenance from the server-created run context, never from graph input."""
    return RuntimeScope(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        initiator_id=context.user_id,
        actor_role="account" if context.user_from == UserFrom.ACCOUNT else "end_user",
        origin="workflow_debug"
        if context.invoke_from in {InvokeFrom.DEBUGGER, InvokeFrom.VALIDATION}
        else "production",
    )


def ensure_supported_workflow_owner(context: DifyRunContext, root_app_id: str | None) -> None:
    """Reject a cross-App delegation before binding lookup, file reads or business I/O."""
    if context.workflow_tool_invocation_id is not None and context.app_id != root_app_id:
        raise RuntimeError(
            "unsupported_profile",
            "External agents inside cross-App Workflow-as-Tool require a future delegated execution profile.",
        )


def task_parts(task: str, pool) -> tuple[dict, ...]:
    """Keep typed files as ordered authorized references; render all other values as text."""
    parts: list[dict] = []
    offset = 0
    for match in WORKFLOW_VARIABLE_PATTERN.finditer(task):
        if match.start() > offset:
            parts.append({"text": task[offset : match.start()]})
        selector = tuple(part.strip() for part in match.group(1).split("."))
        segment = pool.get(selector)
        if segment is None:
            raise RuntimeError("input_variable_missing", "An external Task input variable is unavailable.")
        if isinstance(segment, FileSegment | ArrayFileSegment):
            files = (segment.value,) if isinstance(segment, FileSegment) else segment.value
            for file in files:
                kind = {
                    FileTransferMethod.LOCAL_FILE: "upload",
                    FileTransferMethod.TOOL_FILE: "tool",
                    FileTransferMethod.DATASOURCE_FILE: "datasource",
                }.get(file.transfer_method)
                if kind is None or not file.related_id:
                    raise RuntimeError("invalid_file_reference", "A Task file must be an admitted stored typed File.")
                parts.append({"fileRef": {"file_id": file.related_id, "kind": kind}})
        else:
            parts.append({"text": render_task_value(segment.value)})
        offset = match.end()
    if offset < len(task):
        parts.append({"text": task[offset:]})
    return tuple(parts or ({"text": ""},))


def _graph_value(value: object, field: OutputField) -> object:
    if field.kind == "file":
        if not isinstance(value, dict):
            raise RuntimeError("invalid_stored_file", "The persisted file output is invalid.")
        file = File(**value)
        if file.related_id:
            grant_upload_file_access((file.related_id,))
        return file
    if field.kind == "array" and field.item is not None and isinstance(value, list):
        return [_graph_value(item, field.item) for item in value]
    if field.kind == "object" and isinstance(value, dict):
        children = {child.name: child for child in field.children}
        return {key: _graph_value(item, children[key]) for key, item in value.items() if key in children}
    return value


@dataclass(frozen=True, slots=True, kw_only=True)
class ExternalAgentNodeDependencies:
    """Thread-safe ports captured once by the admitted root graph factory.

    These are long-lived services and immutable admission settings, never a
    Flask proxy, SQL session or child-frame runtime state. The trusted root App
    identity survives nested-frame factory copies and cannot be replaced by a
    delegated source App.
    """

    service: ExternalInvocationService
    store: InvocationStore
    bindings: WorkflowBindingReader
    enqueue: Callable[[], None]
    enabled: bool
    root_app_id: str


class ExternalAgentNode(Node[ExternalAgentNodeData]):
    node_type = BuiltinNodeTypes.AGENT

    def __init__(
        self,
        node_id: str,
        data: ExternalAgentNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        dependencies: ExternalAgentNodeDependencies,
    ) -> None:
        """Bind one frame to root-captured ports without framework-local lookup.

        Preconditions: the root factory admitted these dependencies and the
        supplied state belongs to this frame. Construction only retains ports;
        execution still revalidates binding ownership and the root App profile.
        """
        super().__init__(node_id=node_id, data=data, init_params=init_params, runtime_state=runtime_state)
        self._runtime = ExternalWorkflowRuntime(dependencies.service, dependencies.store)
        self._store = dependencies.store
        self._bindings = dependencies.bindings
        self._enqueue = dependencies.enqueue
        self._enabled = dependencies.enabled
        self._default_forbidden = False
        self._root_app_id = dependencies.root_app_id

    @classmethod
    @override
    def version(cls) -> str:
        return "2"

    @property
    @override
    def retry(self) -> bool:
        return False

    @override
    def _get_error_strategy(self):
        strategy = super()._get_error_strategy()
        return None if self._default_forbidden and strategy == ErrorStrategy.DEFAULT_VALUE else strategy

    @override
    def _get_default_value_dict(self) -> dict[str, Any]:
        job = ExternalNodeJob.parse_graph(self.node_data.model_dump(exclude_unset=True))
        return normalize_node_defaults(self.node_data.default_value_dict, job.output_fields())

    @override
    def populate_start_event(self, event) -> None:
        event.extras["agent_node"] = {"version": "2", "agent_node_kind": "external_a2a"}

    def _identity(self, *, epoch: str, job: ExternalNodeJob) -> ExecutionIdentity:
        frames = [
            frame
            for (frame, node_id), execution in self.runtime_state.graph_execution.node_executions.items()
            if node_id == self.id and execution.execution_id == self.execution_id
        ]
        run_id = get_system_text(self.runtime_state.variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID)
        if not frames and run_id is None:
            frames = ["root"]
        if len(frames) != 1:
            raise RuntimeError("execution_frame_unavailable", "The external execution frame is unavailable.")
        return ExecutionIdentity(
            execution_id=self.execution_id,
            node_id=self.id,
            frame_id=frames[0],
            binding_epoch=epoch,
            workflow_run_id=run_id,
            conversation_id=get_system_text(self.runtime_state.variable_pool, SystemVariableKey.CONVERSATION_ID),
            workflow_revision=sha256(
                json.dumps(
                    {"job": job.model_dump(mode="json", exclude_unset=True), "epoch": epoch}, sort_keys=True
                ).encode()
            ).hexdigest(),
        )

    @override
    def _run(self) -> Generator[NodeEventPayload]:
        """Run an admitted saved binding or resume its fixed invocation result.

        Valid run context and binding ownership are rechecked before dispatch.
        Success emits a result or an identity-only pause; configuration errors
        emit a failed node event and never create an implicit business retry.
        """
        try:
            context = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
            ensure_supported_workflow_owner(context, self._root_app_id)
            scope = workflow_scope(context)
            if scope.origin == "workflow_debug" and not get_system_text(
                self.runtime_state.variable_pool, SystemVariableKey.WORKFLOW_EXECUTION_ID
            ):
                scope = replace(scope, origin="node_debug")
            binding = self._bindings.load_workflow_binding(
                scope, workflow_id=self.init_params.workflow_id, node_id=self.id
            )
            graph_job = ExternalNodeJob.parse_graph(self.node_data.model_dump(exclude_unset=True))
            binding.job.validate_for_publish(
                ExternalGraphBinding(agent_id=binding.agent_id, binding_epoch=binding.binding_epoch)
            )
            if binding.job != graph_job:
                raise RuntimeError("workflow_revision_changed", "The saved external node job has changed.")
            identity = self._identity(epoch=binding.binding_epoch or "", job=binding.job)
            existing = self._store.for_execution(scope, identity)
            if not self._enabled and existing is None:
                raise RuntimeError("external_agents_disabled", "External agents are disabled on this deployment.")
            access = get_current_file_access_scope()
            grants: JsonObject = (
                {}
                if access is None
                else {
                    "granted_upload_file_ids": list[JsonValue](sorted(access.granted_upload_file_ids)),
                    "granted_tool_file_ids": list[JsonValue](sorted(access.granted_tool_file_ids)),
                }
            )
            if scope.origin == "node_debug":
                grants["_node_debug"] = {
                    "workflow_id": self.init_params.workflow_id,
                    "error_strategy": self.error_strategy.value if self.error_strategy else None,
                    "defaults": self.default_value_dict,
                }
            draft = InvocationDraft(
                invocation_id=str(uuid4()),
                agent_id=binding.agent_id or "",
                identity=identity,
                message_id=str(uuid4()),
                parts=task_parts(binding.job.agent_task, self.runtime_state.variable_pool),
                policy=binding.job.external_wait.policy(),
                declared_outputs=binding.job.output_fields(),
                job=grants,
            )
            result = self._runtime.enter(scope, draft)
            self._enqueue()
            if result.state in {LocalState.WAITING, LocalState.RETRY_PENDING}:
                yield PauseRequestedEvent(
                    reason=ExternalWaitReason(
                        wait_id=result.invocation_id,
                        node_id=self.id,
                        node_title=self.node_data.title,
                        execution_id=self.execution_id,
                        frame_id=identity.frame_id,
                    )
                )
                return
            metadata = {WorkflowNodeExecutionMetadataKey.AGENT_LOG: result.metadata}
            if result.state == LocalState.SUCCEEDED:
                values = result.outputs or {}
                outputs = {
                    field.name: _graph_value(values[field.name], field)
                    for field in binding.job.output_fields()
                    if field.name in values
                }
                yield StreamCompletedEvent(
                    node_run_result=NodeRunResult(
                        status=WorkflowNodeExecutionStatus.SUCCEEDED,
                        outputs=outputs,
                        metadata=metadata,
                        process_data={"external_invocation_id": result.invocation_id},
                    )
                )
            else:
                self._default_forbidden = result.error_code == "ambiguous_output"
                yield StreamCompletedEvent(
                    node_run_result=NodeRunResult(
                        status=WorkflowNodeExecutionStatus.FAILED,
                        outputs={},
                        metadata=metadata,
                        error=result.error_message or "External execution ended without a result.",
                        error_type=result.error_code or "external_wait_ended",
                    )
                )
        except (RuntimeError, ValueError) as error:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    outputs={},
                    error=str(error),
                    error_type=error.code if isinstance(error, RuntimeError) else "external_node_configuration_error",
                )
            )

    @classmethod
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls, *, graph_config: Mapping[str, Any], node_id: str, node_data: ExternalAgentNodeData
    ) -> Mapping[str, Sequence[str]]:
        task = node_data.get("agent_task", "")
        return {f"{node_id}.{'.'.join(selector)}": selector for selector in extract_workflow_variable_selectors(task)}


class DifyExternalWorkflowWake:
    """Retry an early wake until a durable checkpoint exists; never revive stopped runs."""

    def __init__(
        self,
        *,
        sessions: sessionmaker[Session],
        enqueue_resume: Callable[[str], None],
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._sessions, self._enqueue_resume = sessions, enqueue_resume
        self._now = now or (lambda: datetime.now(UTC))

    def wake(self, scope: RuntimeScope, invocation) -> bool:
        run_id = invocation.identity.workflow_run_id
        if run_id is None:
            return self._finish_node_debug(scope, invocation) if scope.origin == "node_debug" else True
        now = self._now()
        with self._sessions() as session, session.begin():
            if self._parent_deleted(session, scope, invocation):
                return True
            run = session.scalar(
                select(WorkflowRun)
                .where(
                    WorkflowRun.id == run_id,
                    WorkflowRun.tenant_id == scope.tenant_id,
                    WorkflowRun.app_id == scope.app_id,
                    WorkflowRun.created_by == scope.initiator_id,
                    WorkflowRun.created_by_role == scope.actor_role,
                )
                .with_for_update()
            )
            if run is None or run.stop_requested_at is not None or str(run.status) not in {"running", "paused"}:
                return True
            caller = session.scalar(
                select(WorkflowNodeExecutionModel)
                .where(
                    (WorkflowNodeExecutionModel.id == invocation.caller_execution_id)
                    if invocation.caller_execution_id
                    else or_(
                        WorkflowNodeExecutionModel.node_execution_id == invocation.identity.execution_id,
                        WorkflowNodeExecutionModel.id == invocation.identity.execution_id,
                    ),
                    WorkflowNodeExecutionModel.tenant_id == scope.tenant_id,
                    WorkflowNodeExecutionModel.app_id == scope.app_id,
                    WorkflowNodeExecutionModel.workflow_run_id == run_id,
                    WorkflowNodeExecutionModel.node_id == invocation.identity.node_id,
                )
                .with_for_update()
            )
            if caller is not None and str(caller.status) in {"succeeded", "failed", "exception"}:
                return True  # Progress is acknowledged by persisted caller state, never by queue delivery.
            if now >= invocation.logical_deadline:
                message = "Workflow logical budget expired before external result consumption."
                run.stop_requested_at = now.replace(tzinfo=None)
                run.status, run.error, run.finished_at = (
                    WorkflowExecutionStatus.FAILED,
                    message,
                    now.replace(tzinfo=None),
                )
                if caller is not None:
                    caller.status, caller.error, caller.finished_at = (
                        WorkflowNodeExecutionStatus.FAILED,
                        message,
                        now.replace(tzinfo=None),
                    )
                    caller.outputs = "{}"
                return True
            checkpoint = session.scalar(
                select(WorkflowPause).where(
                    WorkflowPause.workflow_run_id == run_id,
                    WorkflowPause.resumed_at.is_(None),
                )
            )
            if str(run.status) != "paused" or checkpoint is None:
                return False
            published = session.scalar(
                select(ExternalAgentCommand.id)
                .where(
                    ExternalAgentCommand.tenant_id == scope.tenant_id,
                    ExternalAgentCommand.invocation_id == invocation.id,
                    ExternalAgentCommand.kind == "wake",
                    ExternalAgentCommand.payload["resume_pause_id"].as_string() == checkpoint.id,
                    ExternalAgentCommand.payload["resume_publish_until"].as_string() > now.isoformat(),
                )
                .limit(1)
            )
            if published is not None:
                return False
            command = session.scalar(
                select(ExternalAgentCommand)
                .where(
                    ExternalAgentCommand.tenant_id == scope.tenant_id,
                    ExternalAgentCommand.invocation_id == invocation.id,
                    ExternalAgentCommand.kind == "wake",
                )
                .order_by(ExternalAgentCommand.created_at.desc())
                .limit(1)
                .with_for_update()
            )
            if command is None:
                return False
            command.payload = {
                "resume_pause_id": checkpoint.id,
                "resume_publish_until": (now + timedelta(seconds=120)).isoformat(),
            }
        self._enqueue_resume(run_id)
        return False

    @staticmethod
    def _parent_deleted(session: Session, scope: RuntimeScope, invocation) -> bool:
        owners = [
            ("tenant", scope.tenant_id),
            ("app", scope.app_id),
            ("workflow_run", invocation.identity.workflow_run_id),
            ("conversation", invocation.identity.conversation_id),
        ]
        conditions = [
            (ExternalAgentDataTombstone.owner_kind == kind) & (ExternalAgentDataTombstone.owner_id == identity)
            for kind, identity in owners
            if identity
        ]
        return (
            session.scalar(
                select(ExternalAgentDataTombstone.id)
                .where(
                    ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                    or_(*conditions),
                )
                .limit(1)
            )
            is not None
        )

    def _finish_node_debug(self, scope: RuntimeScope, invocation) -> bool:
        """Project one durable standalone result into the existing Last Run row."""
        from core.repositories import DifyCoreRepositoryFactory
        from graphon.entities import WorkflowNodeExecution
        from models.account import Account
        from models.workflow import WorkflowNodeExecutionTriggeredFrom
        from services.workflow_draft_variable_service import DraftVariableSaver

        job = invocation.job.get("_node_debug")
        app_id = scope.app_id
        if not isinstance(job, dict) or app_id is None:
            return True
        with self._sessions() as session, session.begin():
            if self._parent_deleted(session, scope, invocation):
                return True
            row = session.scalar(
                select(WorkflowNodeExecutionModel)
                .where(
                    (WorkflowNodeExecutionModel.id == invocation.caller_execution_id)
                    if invocation.caller_execution_id
                    else or_(
                        WorkflowNodeExecutionModel.node_execution_id == invocation.identity.execution_id,
                        WorkflowNodeExecutionModel.id == invocation.identity.execution_id,
                    ),
                    WorkflowNodeExecutionModel.tenant_id == scope.tenant_id,
                    WorkflowNodeExecutionModel.app_id == scope.app_id,
                    WorkflowNodeExecutionModel.workflow_id == job.get("workflow_id"),
                    WorkflowNodeExecutionModel.node_id == invocation.identity.node_id,
                    WorkflowNodeExecutionModel.workflow_run_id.is_(None),
                    WorkflowNodeExecutionModel.created_by == scope.initiator_id,
                    WorkflowNodeExecutionModel.created_by_role == scope.actor_role,
                )
                .with_for_update()
            )
            if row is None:
                return True
            if str(row.status) == "running":
                return False
            finalized = str(row.status) != "paused"
            if finalized and row.execution_metadata_dict.get("agent_log", {}).get("invocation_id") != invocation.id:
                return True
            outputs = invocation.outputs or {}
            status = (
                WorkflowNodeExecutionStatus.SUCCEEDED
                if invocation.local_state == LocalState.SUCCEEDED
                else WorkflowNodeExecutionStatus.FAILED
            )
            error = invocation.error_message
            strategy = job.get("error_strategy")
            if status == WorkflowNodeExecutionStatus.FAILED and strategy in {"default-value", "fail-branch"}:
                if not (invocation.error_code == "ambiguous_output" and strategy == "default-value"):
                    outputs = {"error_message": error, "error_type": invocation.error_code}
                    defaults = job.get("defaults")
                    if strategy == "default-value" and isinstance(defaults, dict):
                        outputs.update(defaults)
                    status = WorkflowNodeExecutionStatus.EXCEPTION
            row.status = status
            row.outputs = json.dumps(outputs, ensure_ascii=False, allow_nan=False)
            row.error = error if status == WorkflowNodeExecutionStatus.FAILED else None
            finished_at = (invocation.local_wait_ended_at or datetime.now(UTC)).replace(tzinfo=None)
            row.finished_at = finished_at
            row.elapsed_time = max((finished_at - row.created_at).total_seconds(), 0)
            row.execution_metadata = json.dumps(
                {
                    WorkflowNodeExecutionMetadataKey.AGENT_LOG: {
                        "invocation_id": invocation.id,
                        "agent_id": invocation.agent_id,
                        "asset_snapshot": invocation.asset_snapshot,
                        "external_task_id": invocation.remote_task_id,
                        "external_task_status": invocation.remote_state,
                        "submission_state": invocation.submission_state.value,
                        "cancellation_state": invocation.cancel_state.value,
                    }
                }
            )
            latest = session.scalar(
                select(WorkflowNodeExecutionModel.id)
                .where(
                    WorkflowNodeExecutionModel.tenant_id == scope.tenant_id,
                    WorkflowNodeExecutionModel.app_id == scope.app_id,
                    WorkflowNodeExecutionModel.workflow_id == row.workflow_id,
                    WorkflowNodeExecutionModel.node_id == row.node_id,
                )
                .order_by(WorkflowNodeExecutionModel.created_at.desc(), WorkflowNodeExecutionModel.id.desc())
                .limit(1)
            )
            account = session.get(Account, scope.initiator_id)
            if latest == row.id and account is not None and not finalized:
                DraftVariableSaver(
                    session=session,
                    tenant_id=scope.tenant_id,
                    app_id=app_id,
                    node_id=row.node_id,
                    node_type=row.node_type,
                    node_execution_id=row.id,
                    user=account,
                ).save(
                    process_data={"external_invocation_id": invocation.id},
                    outputs=outputs,
                )
            if account is None:
                return True
            repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                session_factory=self._sessions,
                tenant_id=scope.tenant_id,
                user=account,
                app_id=app_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP,
            )
            terminal = WorkflowNodeExecution(
                id=row.id,
                node_execution_id=row.node_execution_id,
                workflow_id=row.workflow_id,
                index=row.index,
                predecessor_node_id=row.predecessor_node_id,
                node_id=row.node_id,
                node_type=row.node_type,
                title=row.title,
                inputs=row.inputs_dict,
                process_data=row.process_data_dict,
                outputs=outputs,
                metadata={WorkflowNodeExecutionMetadataKey.AGENT_LOG: row.execution_metadata_dict["agent_log"]},
                status=row.status,
                error=row.error,
                elapsed_time=row.elapsed_time,
                created_at=row.created_at,
                finished_at=row.finished_at,
            )
        # Preserve the configured LogStore/Celery terminal append as well as SQL
        # Last Run. A failed append leaves WAKE leased for bounded replay. Its
        # next delivery reads this same terminal row and never repeats Send.
        repository.save(terminal)
        return True

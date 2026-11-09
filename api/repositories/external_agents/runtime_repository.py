"""SQL adapters for durable external execution and context reservation.

Every operation owns a bounded session. Asset-head locks linearize dispatch
against disable/update; tenant locks serialize query-capacity admission. CAS and
unique intent keys protect repeated workers. No network I/O occurs in a session.
"""

from __future__ import annotations

import json
from dataclasses import asdict, replace
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import overload
from uuid import uuid4

from pydantic import TypeAdapter
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin
from models.agent import Agent, AgentKind, WorkflowAgentNodeBinding
from models.external_agent import (
    ExternalAgentCommand,
    ExternalAgentConnectionRevision,
    ExternalAgentContextSlot,
    ExternalAgentFileLease,
    ExternalAgentHead,
    ExternalAgentInvocation,
    ExternalWorkflowBudget,
)
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import App, Conversation, EndUser
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowPause, WorkflowRun
from services.external_agents.context_service import context_key
from services.external_agents.invocation_agg import ExternalInvocationAgg, remote_state
from services.external_agents.io_contracts import JsonValue
from services.external_agents.protocol import ConnectionSpec, NoAuth, SealedBearerAuth
from services.external_agents.runtime_contracts import (
    CancelState,
    CommandDraft,
    CommandKind,
    ContextBusyError,
    ContextKey,
    ContextSlot,
    ExecutionIdentity,
    Invocation,
    InvocationDraft,
    LeasedCommand,
    LocalState,
    RuntimeConflictError,
    RuntimeError,
    RuntimeScope,
    RuntimeSettings,
    SubmissionState,
)

_INVOCATION = TypeAdapter(Invocation)
_TERMINAL = frozenset({"completed", "canceled", "failed", "rejected"})


def _db_time(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo is not None else value


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _key(value: object) -> str:
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()


def context_slot_key(key: ContextKey) -> str:
    """Hash a complete value scope; no credential or page-selected reference enters it."""
    return _key(asdict(key))


def _snapshot(value: Invocation) -> dict:
    if value.terminal_receipt is not None:
        raise RuntimeError("unsafe_runtime_snapshot", "Wire receipts must not be persisted in runtime state.")
    for part in value.parts:
        text = (
            set(part).issubset({"text", "mediaType"})
            and isinstance(part.get("text"), str)
            and part.get("mediaType", "text/plain") == "text/plain"
        )
        marker = part.get("fileRef")
        reference = (
            set(part) == {"fileRef"}
            and isinstance(marker, dict)
            and set(marker).issubset({"file_id", "kind"})
            and isinstance(marker.get("file_id"), str)
            and bool(marker.get("file_id"))
            and marker.get("kind", "upload") in {"upload", "tool", "datasource"}
        )
        if not text and not reference:
            raise RuntimeError("unsafe_runtime_snapshot", "Only text and authorized FileRef markers may be persisted.")
    return _INVOCATION.dump_python(value, mode="json")


class ExternalRuntimeRepository:
    """Implements InvocationStore, ContextStore and RuntimeConnectionReader."""

    def __init__(self, sessions: sessionmaker[Session], settings: RuntimeSettings) -> None:
        self._sessions = sessions
        self._settings = settings

    @staticmethod
    def _owner(session: Session, scope: RuntimeScope) -> None:
        """Reconstruct caller membership after every asynchronous/payload boundary."""
        if (
            session.scalar(
                select(ExternalAgentDataTombstone.id)
                .where(
                    ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                    or_(
                        (ExternalAgentDataTombstone.owner_kind == "tenant")
                        & (ExternalAgentDataTombstone.owner_id == scope.tenant_id),
                        (ExternalAgentDataTombstone.owner_kind == "app")
                        & (ExternalAgentDataTombstone.owner_id == scope.app_id),
                    ),
                )
                .limit(1)
            )
            is not None
        ):
            raise RuntimeError("parent_deleted", "The external execution parent has been deleted.")
        if scope.app_id is None and scope.origin != "overview_test":
            raise RuntimeError("permission_denied", "Only Overview tests may omit the owning App.")
        if scope.app_id is not None:
            app = session.scalar(select(App.id).where(App.id == scope.app_id, App.tenant_id == scope.tenant_id))
            if app is None:
                raise RuntimeError("permission_denied", "The owning App is unavailable.")
        if scope.actor_role == "account":
            membership = session.execute(
                select(TenantAccountJoin.role)
                .join(Account, Account.id == TenantAccountJoin.account_id)
                .where(
                    TenantAccountJoin.tenant_id == scope.tenant_id,
                    TenantAccountJoin.account_id == scope.initiator_id,
                    Account.status == AccountStatus.ACTIVE,
                )
            ).scalar_one_or_none()
            if membership is None or (
                scope.origin != "production" and str(membership) not in {"owner", "admin", "editor"}
            ):
                raise RuntimeError("permission_denied", "The initiator has no execution access to this workspace.")
        else:
            user = session.scalar(
                select(EndUser.id).where(
                    EndUser.id == scope.initiator_id,
                    EndUser.tenant_id == scope.tenant_id,
                    EndUser.app_id == scope.app_id,
                )
            )
            if user is None or scope.origin != "production":
                raise RuntimeError("permission_denied", "The end-user execution owner is invalid.")

    @staticmethod
    def _identity(
        session: Session, scope: RuntimeScope, identity: ExecutionIdentity, *, dispatch: bool
    ) -> WorkflowNodeExecutionModel | None:
        if (
            session.scalar(
                select(ExternalAgentDataTombstone.id)
                .where(
                    ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                    or_(
                        (ExternalAgentDataTombstone.owner_kind == "workflow_run")
                        & (ExternalAgentDataTombstone.owner_id == identity.workflow_run_id),
                        (ExternalAgentDataTombstone.owner_kind == "conversation")
                        & (ExternalAgentDataTombstone.owner_id == identity.conversation_id),
                    ),
                )
                .limit(1)
            )
            is not None
        ):
            raise RuntimeError("parent_deleted", "The external execution parent has been deleted.")
        if identity.workflow_run_id is not None:
            run = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == identity.workflow_run_id,
                    WorkflowRun.tenant_id == scope.tenant_id,
                    WorkflowRun.app_id == scope.app_id,
                    WorkflowRun.created_by == scope.initiator_id,
                    WorkflowRun.created_by_role == scope.actor_role,
                )
            )
            if run is None or (dispatch and (run.stop_requested_at is not None or str(run.status) == "stopped")):
                raise RuntimeError("execution_unavailable", "The owning workflow execution is unavailable.")
        execution = None
        if scope.app_id is not None:
            execution = session.scalar(
                select(WorkflowNodeExecutionModel).where(
                    or_(
                        WorkflowNodeExecutionModel.node_execution_id == identity.execution_id,
                        WorkflowNodeExecutionModel.id == identity.execution_id,
                    ),
                    WorkflowNodeExecutionModel.tenant_id == scope.tenant_id,
                    WorkflowNodeExecutionModel.app_id == scope.app_id,
                    WorkflowNodeExecutionModel.workflow_run_id == identity.workflow_run_id,
                    WorkflowNodeExecutionModel.node_id == identity.node_id,
                )
            )
            if execution is not None and (
                execution.created_by != scope.initiator_id or str(execution.created_by_role) != scope.actor_role
            ):
                raise RuntimeError("permission_denied", "The node execution belongs to another caller.")
            if dispatch and execution is None:
                raise RuntimeError("execution_not_persisted", "The owned node execution has not been persisted.")
        if identity.conversation_id is not None:
            conversation = session.scalar(
                select(Conversation).where(
                    Conversation.id == identity.conversation_id,
                    Conversation.app_id == scope.app_id,
                    Conversation.is_deleted.is_(False),
                )
            )
            owner = (
                None
                if conversation is None
                else (conversation.from_account_id if scope.actor_role == "account" else conversation.from_end_user_id)
            )
            if owner != scope.initiator_id:
                raise RuntimeError("permission_denied", "The conversation belongs to another execution owner.")
        return execution

    def _row(self, session: Session, scope: RuntimeScope, invocation_id: str, *, lock: bool = False):
        self._owner(session, scope)
        statement = select(ExternalAgentInvocation).where(
            ExternalAgentInvocation.id == invocation_id,
            ExternalAgentInvocation.tenant_id == scope.tenant_id,
            ExternalAgentInvocation.app_id == scope.app_id,
            ExternalAgentInvocation.initiator_id == scope.initiator_id,
            ExternalAgentInvocation.origin == scope.origin,
        )
        row = session.scalar(statement.with_for_update() if lock else statement)
        if row is None:
            raise RuntimeError("invocation_not_found", "The external Invocation is unavailable.")
        value = self._record(row)
        if value.scope != scope:
            raise RuntimeError("permission_denied", "The external Invocation owner does not match.")
        caller = self._identity(session, scope, value.identity, dispatch=False)
        if caller is not None and value.caller_execution_id is not None and caller.id != value.caller_execution_id:
            raise RuntimeError("caller_execution_changed", "The external caller record has changed.")
        return row

    @staticmethod
    def _record(row: ExternalAgentInvocation) -> Invocation:
        value = _INVOCATION.validate_python(row.runtime_snapshot)
        if row.deleted_at is not None:
            return replace(
                value,
                deleted=True,
                outputs=None,
                parts=(),
                job={},
                version=row.version,
                caller_execution_id=row.node_execution_id,
            )
        return replace(
            value, deleted=row.deleted_at is not None, version=row.version, caller_execution_id=row.node_execution_id
        )

    @staticmethod
    def _write(row: ExternalAgentInvocation, value: Invocation) -> None:
        row.runtime_snapshot = _snapshot(value)
        row.job_config = dict(value.job)
        row.node_execution_id = value.caller_execution_id
        row.asset_snapshot = value.asset_snapshot
        row.connection_revision_id = value.connection_revision_id
        row.submission_state = value.submission_state.value
        row.local_state = value.local_state.value
        row.cancel_state = value.cancel_state.value
        row.remote_task_id = value.remote_task_id
        row.remote_context_id = value.remote_context_id
        row.remote_state = value.remote_state
        row.started_at = _db_time(value.started_at) if value.dispatched_at is not None else None
        for name in (
            "dispatched_at",
            "ended_at",
            "local_wait_ended_at",
            "wait_deadline",
            "logical_deadline",
            "cancellation_deadline",
            "tracking_deadline",
        ):
            item = getattr(value, name)
            setattr(row, name, _db_time(item) if item is not None else None)
        row.outputs = value.outputs
        row.error_code = value.error_code
        row.error_message = value.error_message
        row.tracing_enabled = value.tracing_enabled
        row.background_queries = value.background_queries
        row.version = value.version
        if (
            value.scope.origin == "overview_test"
            and row.test_expires_at is None
            and value.local_wait_ended_at is not None
        ):
            row.test_expires_at = _db_time(value.local_wait_ended_at + timedelta(hours=24))

    @staticmethod
    def _test_gate(
        session: Session,
        scope: RuntimeScope,
        agent_id: str,
        job: dict,
        generation: int | None,
        *,
        check_generation: bool = True,
    ) -> ExternalAgentHead:
        head = session.scalar(
            select(ExternalAgentHead)
            .where(
                ExternalAgentHead.tenant_id == scope.tenant_id,
                ExternalAgentHead.agent_id == agent_id,
            )
            .with_for_update()
        )
        if (
            head is None
            or head.deleted_at is not None
            or (check_generation and generation != head.test_display_generation)
        ):
            raise RuntimeError("stale_test_generation", "The test display configuration has changed.")
        page = job.get("page_session_id")
        if not isinstance(page, str) or not page:
            raise RuntimeError("test_page_required", "An admitted test page is required.")
        page_key = sha256(f"{scope.initiator_id}:{page}".encode()).hexdigest()
        if (
            session.scalar(
                select(ExternalAgentDataTombstone.id).where(
                    ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                    ExternalAgentDataTombstone.owner_kind == "test_page",
                    ExternalAgentDataTombstone.owner_id == page_key,
                )
            )
            is not None
        ):
            raise RuntimeError("test_page_expired", "The test page has left.")
        return head

    @staticmethod
    def _display_snapshot(session: Session, scope: RuntimeScope, agent_id: str, head: ExternalAgentHead) -> dict:
        """Freeze local display fields only; no Card, endpoint, credential or arbitrary metadata."""
        agent = session.scalar(select(Agent).where(Agent.id == agent_id, Agent.tenant_id == scope.tenant_id))
        if agent is None:
            raise RuntimeError("agent_not_found", "The external Agent is unavailable.")
        return {
            "id": agent.id,
            "name": agent.name,
            "description": agent.description,
            "role": agent.role,
            "icon_type": agent.icon_type,
            "icon": agent.icon,
            "icon_background": agent.icon_background,
            "metadata_revision": head.metadata_revision,
        }

    def _bind_test_inputs(
        self,
        session: Session,
        scope: RuntimeScope,
        draft: InvocationDraft,
        value: Invocation,
        now: datetime,
        admitted: Invocation | None = None,
    ) -> Invocation:
        head = self._test_gate(
            session, scope, value.agent_id, value.job, value.test_generation, check_generation=admitted is None
        )
        if head.active_connection_revision_id is None:
            raise RuntimeError("connection_unavailable", "The test has no saved connection.")
        # Overview's explicit Run freezes the saved configuration. Later edits
        # reset display generation, while this already admitted test continues.
        value = replace(
            value,
            connection_revision_id=(
                admitted.connection_revision_id if admitted is not None else head.active_connection_revision_id
            ),
            tracing_enabled=admitted.tracing_enabled if admitted is not None else head.tracing_enabled,
            asset_snapshot=admitted.asset_snapshot
            if admitted is not None
            else self._display_snapshot(session, scope, value.agent_id, head),
        )
        refs = [part["fileRef"] for part in value.parts if "fileRef" in part]
        lease_ids = value.job.get("input_lease_ids", [])
        if not isinstance(lease_ids, list) or len(lease_ids) != len(refs):
            raise RuntimeError("file_lease_required", "Every test input file requires its own admitted lease.")
        bound: list[JsonValue] = []
        for marker, lease_id in zip(refs, lease_ids, strict=True):
            if not isinstance(marker, dict) or marker.get("kind", "upload") != "upload":
                raise RuntimeError("file_lease_required", "Overview inputs must use admitted temporary uploads.")
            lease = session.scalar(
                select(ExternalAgentFileLease)
                .where(
                    ExternalAgentFileLease.id == lease_id,
                    ExternalAgentFileLease.tenant_id == scope.tenant_id,
                    ExternalAgentFileLease.owner_id == scope.initiator_id,
                    ExternalAgentFileLease.agent_id == value.agent_id,
                    ExternalAgentFileLease.page_session_id == value.job["page_session_id"],
                    ExternalAgentFileLease.purpose == "input",
                    ExternalAgentFileLease.write_state == "committed",
                    ExternalAgentFileLease.file_id == marker.get("file_id"),
                    ExternalAgentFileLease.released_at.is_(None),
                    ExternalAgentFileLease.expires_at > _db_time(now),
                )
                .with_for_update()
            )
            if lease is None:
                raise RuntimeError("file_lease_expired", "The test input lease is absent or expired.")
            expiry = lease.created_at + timedelta(hours=24)
            if expiry <= _db_time(now):
                raise RuntimeError("file_lease_expired", "The test input upload has expired.")
            if lease.invocation_id is None or lease.invocation_id == value.id:
                lease.invocation_id = value.id
                lease.expires_at = expiry
                bound.append(lease.id)
            else:
                child = ExternalAgentFileLease(
                    id=str(uuid4()),
                    tenant_id=scope.tenant_id,
                    file_id=lease.file_id,
                    owner_id=scope.initiator_id,
                    purpose="input",
                    expires_at=min(lease.expires_at, expiry),
                    invocation_id=value.id,
                    agent_id=value.agent_id,
                    page_session_id=lease.page_session_id,
                    temporary_copy=lease.temporary_copy,
                    created_at=lease.created_at,
                    storage_key=lease.storage_key,
                    content_hash=lease.content_hash,
                    size=lease.size,
                    media_type=lease.media_type,
                    file_value=dict(lease.file_value) if lease.file_value is not None else None,
                    write_state="committed",
                )
                session.add(child)
                bound.append(child.id)
        return replace(value, job={**value.job, "input_lease_ids": bound})

    @staticmethod
    def _commands(session: Session, value: Invocation, commands: tuple[CommandDraft, ...]) -> None:
        for command in commands:
            existing = session.scalar(
                select(ExternalAgentCommand.id).where(
                    ExternalAgentCommand.tenant_id == value.scope.tenant_id,
                    ExternalAgentCommand.command_key == command.dedupe_key,
                )
            )
            if existing is None:
                if command.kind == CommandKind.POLL:
                    # One next query follows the last completed I/O. A cancel
                    # observation supersedes an older queued poll rather than
                    # creating a second self-renewing polling chain.
                    session.execute(
                        update(ExternalAgentCommand)
                        .where(
                            ExternalAgentCommand.tenant_id == value.scope.tenant_id,
                            ExternalAgentCommand.invocation_id == value.id,
                            ExternalAgentCommand.kind == CommandKind.POLL,
                            ExternalAgentCommand.state == "ready",
                        )
                        .values(state="superseded")
                    )
                session.add(
                    ExternalAgentCommand(
                        id=str(uuid4()),
                        tenant_id=value.scope.tenant_id,
                        invocation_id=value.id,
                        command_key=command.dedupe_key,
                        kind=command.kind.value,
                        next_run_at=_db_time(command.not_before),
                        background=command.background,
                    )
                )

    def _budget(self, session: Session, scope: RuntimeScope, identity: ExecutionIdentity, now: datetime) -> datetime:
        if identity.workflow_run_id is None:
            return now + timedelta(seconds=self._settings.logical_budget_seconds)
        if scope.app_id is None:
            raise RuntimeError("permission_denied", "Workflow budgets require an owning App.")
        self._identity(session, scope, identity, dispatch=False)
        budget = session.scalar(
            select(ExternalWorkflowBudget)
            .where(
                ExternalWorkflowBudget.workflow_run_id == identity.workflow_run_id,
                ExternalWorkflowBudget.tenant_id == scope.tenant_id,
                ExternalWorkflowBudget.app_id == scope.app_id,
            )
            .with_for_update()
        )
        if budget is not None:
            if budget.human_pause_started_at is not None:
                budget.deadline += max(_db_time(now) - budget.human_pause_started_at, timedelta())
                budget.human_pause_started_at = None
                budget.version += 1
            return _utc(budget.deadline)
        run = session.get(WorkflowRun, identity.workflow_run_id)
        assert run is not None
        latest_pause = session.scalar(
            select(WorkflowPause)
            .where(
                WorkflowPause.workflow_run_id == run.id,
                WorkflowPause.resumed_at.is_not(None),
            )
            .order_by(WorkflowPause.resumed_at.desc())
            .limit(1)
        )
        segment_start = (
            latest_pause.resumed_at
            if latest_pause is not None and latest_pause.resumed_at is not None
            else run.created_at
        )
        segment = max((_db_time(now) - segment_start).total_seconds(), 0)
        consumed = (
            float(run.elapsed_time or 0) + segment
            if latest_pause is not None
            else max(float(run.elapsed_time or 0), segment)
        )
        deadline = now + timedelta(seconds=max(self._settings.logical_budget_seconds - consumed, 0))
        session.add(
            ExternalWorkflowBudget(
                workflow_run_id=run.id, tenant_id=scope.tenant_id, app_id=scope.app_id, deadline=_db_time(deadline)
            )
        )
        return deadline

    def create(self, scope: RuntimeScope, draft: InvocationDraft, *, now: datetime) -> Invocation:
        try:
            with self._sessions() as session, session.begin():
                return self._create_in_session(session, scope, draft, now=now)
        except IntegrityError as error:
            raise RuntimeConflictError() from error

    def _create_in_session(
        self,
        session: Session,
        scope: RuntimeScope,
        draft: InvocationDraft,
        *,
        now: datetime,
        admitted: Invocation | None = None,
    ) -> Invocation:
        self._owner(session, scope)
        caller = self._identity(session, scope, draft.identity, dispatch=False)
        request_key = _key((scope.app_id, draft.identity.execution_id, draft.identity.frame_id, draft.sequence))
        existing = session.scalar(
            select(ExternalAgentInvocation).where(
                ExternalAgentInvocation.tenant_id == scope.tenant_id,
                ExternalAgentInvocation.request_key == request_key,
            )
        )
        if existing is not None:
            current = self._record(self._row(session, scope, existing.id))
            if (
                current.agent_id,
                current.identity,
                current.parts,
                current.policy,
                current.declared_outputs,
                {key: val for key, val in current.job.items() if key != "input_lease_ids"},
            ) != (
                draft.agent_id,
                draft.identity,
                draft.parts,
                draft.policy,
                draft.declared_outputs,
                {key: val for key, val in draft.job.items() if key != "input_lease_ids"},
            ):
                raise RuntimeConflictError()
            return current
        agent = session.scalar(
            select(Agent).where(
                Agent.id == draft.agent_id,
                Agent.tenant_id == scope.tenant_id,
                Agent.agent_kind == AgentKind.EXTERNAL_A2A,
            )
        )
        if agent is None:
            raise RuntimeError("agent_not_found", "The external Agent is unavailable.")
        deadline = self._budget(session, scope, draft.identity, now)
        if draft.logical_deadline is not None:
            deadline = min(deadline, draft.logical_deadline)
        value = Invocation(
            id=draft.invocation_id,
            scope=scope,
            agent_id=draft.agent_id,
            identity=draft.identity,
            message_id=draft.message_id,
            parts=draft.parts,
            policy=draft.policy,
            declared_outputs=draft.declared_outputs,
            started_at=now,
            logical_deadline=deadline,
            caller_execution_id=caller.id if caller is not None else None,
            sequence=draft.sequence,
            retry_of=draft.retry_of,
            test_generation=draft.test_generation,
            job=draft.job,
            asset_snapshot=admitted.asset_snapshot if admitted is not None else {},
        )
        if scope.origin == "overview_test":
            value = self._bind_test_inputs(session, scope, draft, value, now, admitted)
        row = ExternalAgentInvocation(
            id=value.id,
            tenant_id=scope.tenant_id,
            agent_id=value.agent_id,
            request_key=request_key,
            execution_key=_key((draft.identity.execution_id, draft.identity.frame_id)),
            origin=scope.origin,
            initiator_id=scope.initiator_id,
            app_id=scope.app_id,
            workflow_run_id=draft.identity.workflow_run_id,
            node_execution_id=value.caller_execution_id,
            node_id=draft.identity.node_id,
            frame_id=draft.identity.frame_id,
            binding_epoch=draft.identity.binding_epoch,
            sequence=draft.sequence,
            retry_of=draft.retry_of,
            message_id=draft.message_id,
            test_generation=draft.test_generation,
            job_config=draft.job,
        )
        self._write(row, value)
        session.add(row)
        self._commands(
            session,
            value,
            (
                CommandDraft(kind=CommandKind.DISPATCH, not_before=now, dedupe_key=f"{value.id}:dispatch"),
                CommandDraft(kind=CommandKind.DEADLINE, not_before=deadline, dedupe_key=f"{value.id}:logical-deadline"),
            ),
        )
        return value

    @overload
    def get(self, scope: RuntimeScope, invocation_id: str) -> Invocation: ...

    @overload
    def get(self, scope: ContextKey) -> ContextSlot | None: ...

    def get(self, scope: RuntimeScope | ContextKey, invocation_id: str | None = None):
        with self._sessions() as session:
            if isinstance(scope, ContextKey):
                row = session.scalar(
                    select(ExternalAgentContextSlot).where(
                        ExternalAgentContextSlot.key == context_slot_key(scope),
                        ExternalAgentContextSlot.tenant_id == scope.tenant_id,
                        ExternalAgentContextSlot.app_id == scope.app_id,
                        ExternalAgentContextSlot.conversation_id == scope.conversation_id,
                        ExternalAgentContextSlot.deleted_at.is_(None),
                    )
                )
                return None if row is None else self._slot(row)
            if invocation_id is None:
                raise RuntimeError("invocation_not_found", "An Invocation ID is required.")
            return self._record(self._row(session, scope, invocation_id))

    def for_execution(self, scope: RuntimeScope, identity: ExecutionIdentity) -> Invocation | None:
        with self._sessions() as session:
            self._owner(session, scope)
            self._identity(session, scope, identity, dispatch=False)
            row = session.scalar(
                select(ExternalAgentInvocation)
                .where(
                    ExternalAgentInvocation.tenant_id == scope.tenant_id,
                    ExternalAgentInvocation.app_id == scope.app_id,
                    ExternalAgentInvocation.initiator_id == scope.initiator_id,
                    ExternalAgentInvocation.origin == scope.origin,
                    ExternalAgentInvocation.execution_key == _key((identity.execution_id, identity.frame_id)),
                    ExternalAgentInvocation.frame_id == identity.frame_id,
                )
                .order_by(ExternalAgentInvocation.sequence.desc())
                .limit(1)
            )
            if row is None:
                return None
            value = self._record(row)
            return value if value.identity.execution_id == identity.execution_id else None

    def acquire_dispatch(self, scope: RuntimeScope, invocation_id: str, *, now: datetime) -> Invocation | None:
        try:
            with self._sessions() as session, session.begin():
                row = self._row(session, scope, invocation_id, lock=True)
                previous = self._record(row)
                if previous.submission_state != SubmissionState.PREPARED:
                    return None
                caller = self._identity(session, scope, previous.identity, dispatch=True)
                if scope.origin == "overview_test":
                    self._test_gate(
                        session,
                        scope,
                        previous.agent_id,
                        previous.job,
                        previous.test_generation,
                        check_generation=False,
                    )
                head = session.scalar(
                    select(ExternalAgentHead)
                    .where(
                        ExternalAgentHead.tenant_id == scope.tenant_id,
                        ExternalAgentHead.agent_id == row.agent_id,
                    )
                    .with_for_update()
                )
                if head is None or head.deleted_at is not None:
                    raise RuntimeError("agent_not_found", "The external Agent has been deleted.")
                if not head.enabled and scope.origin != "overview_test":
                    raise RuntimeError("agent_disabled", "The external Agent is disabled.")
                revision_id = (
                    previous.connection_revision_id
                    if scope.origin == "overview_test"
                    else head.active_connection_revision_id
                )
                if revision_id is None:
                    raise RuntimeError("connection_unavailable", "The external Agent has no saved connection.")
                if now >= previous.logical_deadline:
                    raise RuntimeError("logical_deadline_exceeded", "Workflow execution budget was exhausted.")
                value = replace(
                    previous,
                    version=previous.version + 1,
                    connection_revision_id=revision_id,
                    submission_state=SubmissionState.SEND_STARTED,
                    caller_execution_id=caller.id if caller is not None else None,
                    started_at=now,
                    tracing_enabled=previous.tracing_enabled
                    if scope.origin == "overview_test"
                    else head.tracing_enabled,
                    wait_deadline=(
                        now + timedelta(seconds=previous.policy.wait_seconds)
                        if previous.policy.wait_seconds is not None
                        else None
                    ),
                )
                key = context_key(value)
                if key is not None:
                    slot = self._reserve(session, key, value.id)
                    value = replace(value, carried_context_id=slot.server_context_id)
                    row.context_slot_key = slot.key
                value = replace(
                    value,
                    asset_snapshot=previous.asset_snapshot
                    or self._display_snapshot(session, scope, row.agent_id, head),
                )
                self._write(row, value)
                due = min(value.wait_deadline or value.logical_deadline, value.logical_deadline)
                self._commands(
                    session,
                    value,
                    (CommandDraft(kind=CommandKind.DEADLINE, not_before=due, dedupe_key=f"{value.id}:wait-deadline"),),
                )
                return value
        except IntegrityError as error:
            raise ContextBusyError() from error

    def begin_send(self, scope: RuntimeScope, invocation: Invocation, *, now: datetime) -> Invocation | None:
        with self._sessions() as session, session.begin():
            row = self._row(session, scope, invocation.id, lock=True)
            value = self._record(row)
            if (
                value.version != invocation.version
                or value.submission_state != SubmissionState.SEND_STARTED
                or value.dispatched_at is not None
                or value.local_state != LocalState.WAITING
                or value.deleted
            ):
                return None
            self._identity(session, scope, value.identity, dispatch=True)
            if value.identity.workflow_run_id is not None:
                run = session.scalar(
                    select(WorkflowRun)
                    .where(
                        WorkflowRun.id == value.identity.workflow_run_id,
                        WorkflowRun.tenant_id == scope.tenant_id,
                        WorkflowRun.app_id == scope.app_id,
                    )
                    .with_for_update()
                )
                if run is None or run.stop_requested_at is not None or str(run.status) not in {"running", "paused"}:
                    raise RuntimeError("execution_unavailable", "The owning execution has stopped.")
            if now >= min(value.logical_deadline, value.wait_deadline or value.logical_deadline):
                raise RuntimeError("deadline_exceeded", "The external I/O budget was exhausted before sending.")
            updated = replace(value, version=value.version + 1, started_at=now, dispatched_at=now)
            self._write(row, updated)
            return updated

    def execution_stopped(self, scope: RuntimeScope, identity: ExecutionIdentity) -> bool:
        if identity.workflow_run_id is None:
            return False
        with self._sessions() as session:
            self._owner(session, scope)
            run = session.scalar(
                select(WorkflowRun).where(
                    WorkflowRun.id == identity.workflow_run_id,
                    WorkflowRun.tenant_id == scope.tenant_id,
                    WorkflowRun.app_id == scope.app_id,
                    WorkflowRun.created_by == scope.initiator_id,
                    WorkflowRun.created_by_role == scope.actor_role,
                )
            )
            return run is None or run.stop_requested_at is not None or str(run.status) not in {"running", "paused"}

    def save(
        self,
        scope: RuntimeScope,
        previous: Invocation,
        updated: Invocation,
        *,
        commands: tuple[CommandDraft, ...] = (),
    ) -> bool:
        if (
            updated.id != previous.id
            or updated.scope != scope
            or previous.scope != scope
            or updated.identity != previous.identity
            or updated.agent_id != previous.agent_id
            or updated.message_id != previous.message_id
            or updated.parts != previous.parts
            or updated.connection_revision_id != previous.connection_revision_id
            or updated.caller_execution_id != previous.caller_execution_id
        ):
            raise RuntimeError("permission_denied", "Invocation identity cannot change.")
        if updated.version != previous.version + 1:
            raise RuntimeConflictError()
        if previous.local_state not in {LocalState.WAITING, LocalState.RETRY_PENDING} and (
            updated.local_state != previous.local_state or updated.outputs != previous.outputs
        ):
            raise RuntimeConflictError()
        with self._sessions() as session, session.begin():
            row = self._row(session, scope, previous.id, lock=True)
            if row.version != previous.version:
                return False
            if row.deleted_at is not None and updated.outputs != previous.outputs:
                return False
            if updated.local_state == LocalState.SUCCEEDED and updated.identity.workflow_run_id is not None:
                run = session.scalar(
                    select(WorkflowRun)
                    .where(
                        WorkflowRun.id == updated.identity.workflow_run_id,
                        WorkflowRun.tenant_id == scope.tenant_id,
                        WorkflowRun.app_id == scope.app_id,
                    )
                    .with_for_update()
                )
                if run is None or run.stop_requested_at is not None or str(run.status) not in {"running", "paused"}:
                    return False
            self._write(row, updated)
            self._commands(session, updated, commands)
            if updated.queries_blocked:
                session.execute(
                    update(ExternalAgentCommand)
                    .where(
                        ExternalAgentCommand.tenant_id == scope.tenant_id,
                        ExternalAgentCommand.invocation_id == updated.id,
                        ExternalAgentCommand.kind.in_((CommandKind.POLL, CommandKind.CANCEL)),
                        ExternalAgentCommand.state == "ready",
                    )
                    .values(state="superseded")
                )
            if row.context_slot_key is not None:
                slot = session.scalar(
                    select(ExternalAgentContextSlot)
                    .where(
                        ExternalAgentContextSlot.key == row.context_slot_key,
                        ExternalAgentContextSlot.tenant_id == scope.tenant_id,
                        ExternalAgentContextSlot.reserved_invocation_id == row.id,
                    )
                    .with_for_update()
                )
                if slot is not None:
                    self._settle_slot(
                        slot,
                        updated.remote_context_id,
                        terminal=(
                            remote_state(updated.remote_state) in _TERMINAL
                            or updated.submission_state == SubmissionState.REJECTED
                        ),
                        unresolved=(updated.local_state != LocalState.WAITING),
                    )
            return True

    def create_retry(
        self, scope: RuntimeScope, previous: Invocation, draft: InvocationDraft, *, now: datetime
    ) -> Invocation:
        try:
            with self._sessions() as session, session.begin():
                current_row = self._row(session, scope, previous.id, lock=True)
                current = self._record(current_row)
                request_key = _key((scope.app_id, draft.identity.execution_id, draft.identity.frame_id, draft.sequence))
                existing = session.scalar(
                    select(ExternalAgentInvocation).where(
                        ExternalAgentInvocation.tenant_id == scope.tenant_id,
                        ExternalAgentInvocation.request_key == request_key,
                    )
                )
                if existing is not None:
                    return self._record(self._row(session, scope, existing.id))
                if (
                    current.cancel_state != CancelState.CONFIRMED
                    or current.local_state != LocalState.RETRY_PENDING
                    or current.sequence >= current.policy.additional_retries
                    or draft.sequence != current.sequence + 1
                    or draft.retry_of != current.id
                    or now >= current.logical_deadline
                ):
                    raise RuntimeConflictError()
                result = self._create_in_session(session, scope, draft, now=now, admitted=current)
                self._write(current_row, replace(current, local_state=LocalState.ENDED, version=current.version + 1))
                return result
        except IntegrityError as error:
            raise RuntimeConflictError() from error

    @staticmethod
    def _slot(row: ExternalAgentContextSlot) -> ContextSlot:
        return ContextSlot(
            key=ContextKey(
                tenant_id=row.tenant_id,
                app_id=row.app_id,
                conversation_id=row.conversation_id,
                node_id=row.node_id,
                binding_epoch=row.binding_epoch,
                agent_id=row.agent_id,
                connection_revision_id=row.connection_revision_id,
                frame_scope=row.frame_scope,
            ),
            context_id=row.server_context_id,
            reservation_invocation_id=row.reserved_invocation_id,
            unresolved=row.unresolved,
            version=row.version,
        )

    @staticmethod
    def _reserve(session: Session, key: ContextKey, invocation_id: str) -> ExternalAgentContextSlot:
        slot_id = context_slot_key(key)
        if (
            session.scalar(
                select(ExternalAgentDataTombstone.id)
                .where(
                    ExternalAgentDataTombstone.tenant_id == key.tenant_id,
                    ExternalAgentDataTombstone.owner_kind == "context_slot",
                    ExternalAgentDataTombstone.owner_id == slot_id,
                )
                .limit(1)
            )
            is not None
        ):
            raise RuntimeError("parent_deleted", "The remote context slot has been deleted.")
        slot = session.scalar(
            select(ExternalAgentContextSlot)
            .where(
                ExternalAgentContextSlot.key == slot_id,
                ExternalAgentContextSlot.tenant_id == key.tenant_id,
                ExternalAgentContextSlot.app_id == key.app_id,
            )
            .with_for_update()
        )
        if slot is None:
            slot = ExternalAgentContextSlot(
                key=slot_id,
                tenant_id=key.tenant_id,
                app_id=key.app_id,
                conversation_id=key.conversation_id,
                node_id=key.node_id,
                agent_id=key.agent_id,
                connection_revision_id=key.connection_revision_id,
                binding_epoch=key.binding_epoch,
                frame_scope=key.frame_scope,
                reserved_invocation_id=invocation_id,
            )
            session.add(slot)
        elif (
            slot.deleted_at is not None
            or (slot.reserved_invocation_id is not None and slot.reserved_invocation_id != invocation_id)
            or (slot.unresolved and slot.reserved_invocation_id != invocation_id)
        ):
            raise ContextBusyError()
        else:
            slot.reserved_invocation_id = invocation_id
            slot.version += 1
        return slot

    def reserve(self, key: ContextKey, invocation_id: str) -> ContextSlot:
        try:
            with self._sessions() as session, session.begin():
                row = session.scalar(
                    select(ExternalAgentInvocation).where(
                        ExternalAgentInvocation.id == invocation_id,
                        ExternalAgentInvocation.tenant_id == key.tenant_id,
                        ExternalAgentInvocation.app_id == key.app_id,
                    )
                )
                if row is None:
                    raise RuntimeError("invocation_not_found", "The owned Invocation is unavailable.")
                value = self._record(row)
                self._owner(session, value.scope)
                self._identity(session, value.scope, value.identity, dispatch=False)
                if context_key(value) != key:
                    raise RuntimeError("permission_denied", "The context scope does not match its Invocation.")
                return self._slot(self._reserve(session, key, invocation_id))
        except IntegrityError as error:
            raise ContextBusyError() from error

    @staticmethod
    def _settle_slot(
        slot: ExternalAgentContextSlot, context_id: str | None, *, terminal: bool, unresolved: bool
    ) -> None:
        if context_id is not None:
            if slot.server_context_id is not None and context_id != slot.server_context_id:
                raise RuntimeError("response_correlation_error", "The response changed its external context.")
            slot.server_context_id = context_id
        if terminal:
            slot.reserved_invocation_id = None
            slot.unresolved = False
        else:
            slot.unresolved = unresolved
        slot.version += 1

    def settle(
        self, key: ContextKey, invocation_id: str, *, context_id: str | None, remote_terminal: bool, unresolved: bool
    ) -> bool:
        with self._sessions() as session, session.begin():
            row = session.scalar(
                select(ExternalAgentContextSlot)
                .where(
                    ExternalAgentContextSlot.key == context_slot_key(key),
                    ExternalAgentContextSlot.tenant_id == key.tenant_id,
                    ExternalAgentContextSlot.app_id == key.app_id,
                    ExternalAgentContextSlot.reserved_invocation_id == invocation_id,
                    ExternalAgentContextSlot.deleted_at.is_(None),
                )
                .with_for_update()
            )
            if row is None:
                return False
            self._settle_slot(row, context_id, terminal=remote_terminal, unresolved=unresolved)
            return True

    def read(self, scope: RuntimeScope, agent_id: str, revision_id: str) -> ConnectionSpec:
        with self._sessions() as session:
            self._owner(session, scope)
            row = session.scalar(
                select(ExternalAgentConnectionRevision).where(
                    ExternalAgentConnectionRevision.id == revision_id,
                    ExternalAgentConnectionRevision.tenant_id == scope.tenant_id,
                    ExternalAgentConnectionRevision.agent_id == agent_id,
                )
            )
            if row is None or row.secret_cleared_at is not None:
                raise RuntimeError("credential_unavailable", "The pinned external connection is unavailable.")
            auth = (
                NoAuth()
                if row.auth_type == "none"
                else SealedBearerAuth(tenant_id=scope.tenant_id, ciphertext=row.credential_ciphertext or "")
            )
            return ConnectionSpec(
                endpoint=row.endpoint,
                authentication=auth,
                interface_url=row.interface_url,
                remote_tenant=row.capabilities.get("remote_tenant"),
                enabled_extensions=tuple(row.capabilities.get("required_extensions", ())),
            )

    def lease_command(
        self, scope: RuntimeScope, command_id: str, *, now: datetime, lease_seconds: int
    ) -> LeasedCommand | None:
        with self._sessions() as session, session.begin():
            self._owner(session, scope)
            session.scalar(select(Tenant.id).where(Tenant.id == scope.tenant_id).with_for_update())
            row = session.scalar(
                select(ExternalAgentCommand)
                .where(
                    ExternalAgentCommand.id == command_id,
                    ExternalAgentCommand.tenant_id == scope.tenant_id,
                    ExternalAgentCommand.next_run_at <= _db_time(now),
                    or_(
                        ExternalAgentCommand.state == "ready",
                        (
                            (ExternalAgentCommand.state == "leased")
                            & (ExternalAgentCommand.lease_until <= _db_time(now))
                        ),
                    ),
                )
                .with_for_update()
            )
            if row is None:
                return None
            invocation = self._record(self._row(session, scope, row.invocation_id))
            if (
                row.kind in {CommandKind.DISPATCH, CommandKind.POLL, CommandKind.CANCEL}
                and invocation.connection_revision_id
            ):
                # Secret GC takes the same revision lock before deciding that
                # no legitimate I/O lease remains. If GC won, the pinned reader
                # fails closed; a worker never gets an already-reclaimed secret.
                session.scalar(
                    select(ExternalAgentConnectionRevision.id)
                    .where(
                        ExternalAgentConnectionRevision.id == invocation.connection_revision_id,
                        ExternalAgentConnectionRevision.tenant_id == scope.tenant_id,
                        ExternalAgentConnectionRevision.agent_id == invocation.agent_id,
                    )
                    .with_for_update()
                )
            if row.kind in {CommandKind.POLL, CommandKind.CANCEL}:
                if (
                    row.background
                    and session.scalar(
                        select(ExternalAgentCommand.id)
                        .where(
                            ExternalAgentCommand.tenant_id == scope.tenant_id,
                            ExternalAgentCommand.kind.in_((CommandKind.POLL, CommandKind.CANCEL)),
                            ExternalAgentCommand.background.is_(False),
                            ExternalAgentCommand.state == "ready",
                            ExternalAgentCommand.next_run_at <= _db_time(now),
                        )
                        .limit(1)
                    )
                    is not None
                ):
                    return None
                endpoint = session.scalar(
                    select(ExternalAgentConnectionRevision.interface_url).where(
                        ExternalAgentConnectionRevision.id == invocation.connection_revision_id,
                        ExternalAgentConnectionRevision.tenant_id == scope.tenant_id,
                    )
                )
                endpoint_key = _key(endpoint)
                leased = select(ExternalAgentCommand).where(
                    ExternalAgentCommand.tenant_id == scope.tenant_id,
                    ExternalAgentCommand.kind.in_((CommandKind.POLL, CommandKind.CANCEL)),
                    ExternalAgentCommand.state == "leased",
                    ExternalAgentCommand.lease_until > _db_time(now),
                    ExternalAgentCommand.id != row.id,
                )
                active = list(session.scalars(leased.with_for_update()))
                if (
                    any(item.invocation_id == invocation.id for item in active)
                    or len(active) >= self._settings.workspace_query_concurrency
                    or sum(item.endpoint_key == endpoint_key for item in active)
                    >= self._settings.endpoint_query_concurrency
                ):
                    return None
                row.endpoint_key = endpoint_key
            row.state = "leased"
            row.fence += 1
            row.attempts += 1
            row.lease_token = str(uuid4())
            lease_expires_at = now + timedelta(seconds=lease_seconds)
            row.lease_until = _db_time(lease_expires_at)
            return LeasedCommand(
                id=row.id,
                invocation_id=row.invocation_id,
                scope=scope,
                kind=CommandKind(row.kind),
                fence=row.fence,
                lease_expires_at=lease_expires_at,
                background=row.background,
            )

    def complete_command(self, command: LeasedCommand) -> None:
        with self._sessions() as session, session.begin():
            session.execute(
                update(ExternalAgentCommand)
                .where(
                    ExternalAgentCommand.id == command.id,
                    ExternalAgentCommand.tenant_id == command.scope.tenant_id,
                    ExternalAgentCommand.invocation_id == command.invocation_id,
                    ExternalAgentCommand.fence == command.fence,
                    ExternalAgentCommand.state == "leased",
                )
                .values(state="done", lease_until=None)
            )

    def due_commands(self, *, now: datetime, limit: int = 100) -> tuple[tuple[RuntimeScope, str], ...]:
        """Return DB-owned scopes for the scheduler, never payload-provided identities."""
        with self._sessions() as session:
            rows = session.execute(
                select(ExternalAgentCommand, ExternalAgentInvocation)
                .join(ExternalAgentInvocation, ExternalAgentInvocation.id == ExternalAgentCommand.invocation_id)
                .where(
                    ExternalAgentCommand.next_run_at <= _db_time(now),
                    ExternalAgentInvocation.deleted_at.is_(None),
                    or_(
                        ExternalAgentCommand.state == "ready",
                        (
                            (ExternalAgentCommand.state == "leased")
                            & (ExternalAgentCommand.lease_until <= _db_time(now))
                        ),
                    ),
                )
                .order_by(ExternalAgentCommand.background, ExternalAgentCommand.next_run_at)
                .limit(limit)
            ).all()
            return tuple((self._record(invocation).scope, command.id) for command, invocation in rows)

    def claim_publishable_commands(self, *, now: datetime, limit: int = 100) -> tuple[tuple[RuntimeScope, str], ...]:
        """Fence broker publication separately from actual execution/query leases.

        Publishing can fail after this transaction. The fixed publication lease
        makes the same durable command discoverable again without broker floods;
        a worker still acquires its own I/O fence at execution time.
        """
        with self._sessions() as session, session.begin():
            rows = session.execute(
                select(ExternalAgentCommand, ExternalAgentInvocation)
                .join(
                    ExternalAgentInvocation,
                    ExternalAgentInvocation.id == ExternalAgentCommand.invocation_id,
                )
                .where(
                    ExternalAgentCommand.next_run_at <= _db_time(now),
                    ExternalAgentInvocation.deleted_at.is_(None),
                    or_(
                        ExternalAgentCommand.publish_after.is_(None),
                        ExternalAgentCommand.publish_after <= _db_time(now),
                    ),
                    or_(
                        ExternalAgentCommand.state == "ready",
                        (ExternalAgentCommand.state == "leased") & (ExternalAgentCommand.lease_until <= _db_time(now)),
                    ),
                )
                .order_by(ExternalAgentCommand.background, ExternalAgentCommand.next_run_at)
                .limit(limit)
                .with_for_update(of=ExternalAgentCommand, skip_locked=True)
            ).all()
            for command, _invocation in rows:
                command.publish_after = _db_time(now + timedelta(seconds=self._settings.command_lease_seconds))
            return tuple((self._record(invocation).scope, command.id) for command, invocation in rows)

    def close_unavailable_executions(self, *, now: datetime, limit: int = 100) -> int:
        """System-only local closure; revoked actors never gain an I/O capability.

        Preconditions: scheduler selects persisted owner identities, not an HTTP
        caller payload. Postconditions: hard-expired/revoked waiting executions
        become locally terminal with fixed TTL, stale commands are fenced and
        unresolved context stays reserved. This path never sends, polls, cancels,
        materializes files, exports content or resumes an unauthorized graph.
        """
        actor_role = ExternalAgentInvocation.runtime_snapshot["scope"]["actor_role"].as_string()
        account_valid = (
            select(Account.id)
            .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
            .where(
                Account.id == ExternalAgentInvocation.initiator_id,
                Account.status == AccountStatus.ACTIVE,
                TenantAccountJoin.tenant_id == ExternalAgentInvocation.tenant_id,
                or_(
                    ExternalAgentInvocation.origin == "production",
                    TenantAccountJoin.role.in_(("owner", "admin", "editor")),
                ),
            )
            .exists()
        )
        user_valid = (
            select(EndUser.id)
            .where(
                EndUser.id == ExternalAgentInvocation.initiator_id,
                EndUser.tenant_id == ExternalAgentInvocation.tenant_id,
                EndUser.app_id == ExternalAgentInvocation.app_id,
            )
            .exists()
        )
        app_valid = (
            select(App.id)
            .where(App.id == ExternalAgentInvocation.app_id, App.tenant_id == ExternalAgentInvocation.tenant_id)
            .exists()
        )
        unavailable = or_(
            (actor_role == "account") & ~account_valid,
            (actor_role == "end_user") & ~user_valid,
            ExternalAgentInvocation.app_id.is_not(None) & ~app_valid,
        )
        with self._sessions() as session, session.begin():
            rows = session.scalars(
                select(ExternalAgentInvocation)
                .where(
                    ExternalAgentInvocation.deleted_at.is_(None),
                    ExternalAgentInvocation.local_state.in_((LocalState.WAITING, LocalState.RETRY_PENDING)),
                    or_(ExternalAgentInvocation.logical_deadline <= _db_time(now), unavailable),
                )
                .order_by(ExternalAgentInvocation.logical_deadline)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
            closed = 0
            for row in rows:
                value = self._record(row)
                valid_owner = True
                try:
                    self._owner(session, value.scope)
                    self._identity(session, value.scope, value.identity, dispatch=False)
                except RuntimeError:
                    valid_owner = False
                expired = now >= value.logical_deadline
                if expired or not valid_owner:
                    transition = (
                        ExternalInvocationAgg(value, self._settings).expire(now)
                        if expired
                        else ExternalInvocationAgg(value, self._settings).stop(now)
                    )
                    updated = transition.invocation
                    no_post = value.dispatched_at is None and value.remote_task_id is None
                    if no_post and value.submission_state in {SubmissionState.PREPARED, SubmissionState.SEND_STARTED}:
                        updated = replace(updated, submission_state=SubmissionState.REJECTED)
                        if value.submission_state == SubmissionState.SEND_STARTED:
                            updated = replace(
                                updated,
                                error_code="preparation_interrupted",
                                error_message="External preparation ended before a business request was sent.",
                            )
                    if not valid_owner:
                        updated = replace(
                            updated,
                            error_code="preparation_interrupted"
                            if no_post and value.submission_state == SubmissionState.SEND_STARTED
                            else "execution_access_revoked",
                            error_message="External preparation ended before a business request was sent."
                            if no_post and value.submission_state == SubmissionState.SEND_STARTED
                            else "Execution access is no longer available.",
                            queries_blocked=True,
                            submission_state=(
                                SubmissionState.REJECTED
                                if no_post
                                and value.submission_state in {SubmissionState.PREPARED, SubmissionState.SEND_STARTED}
                                else SubmissionState.UNKNOWN
                                if value.submission_state == SubmissionState.SEND_STARTED
                                else value.submission_state
                            ),
                        )
                    elif value.submission_state == SubmissionState.SEND_STARTED and not no_post:
                        updated = replace(updated, submission_state=SubmissionState.UNKNOWN)
                    self._write(row, updated)
                    session.execute(
                        update(ExternalAgentCommand)
                        .where(
                            ExternalAgentCommand.invocation_id == row.id,
                            ExternalAgentCommand.tenant_id == row.tenant_id,
                            ExternalAgentCommand.state.in_(("ready", "leased")),
                        )
                        .values(state="closed", fence=ExternalAgentCommand.fence + 1, lease_until=None)
                    )
                    if valid_owner:
                        self._commands(session, updated, transition.commands)
                    if row.context_slot_key:
                        slot = session.scalar(
                            select(ExternalAgentContextSlot)
                            .where(
                                ExternalAgentContextSlot.key == row.context_slot_key,
                                ExternalAgentContextSlot.tenant_id == row.tenant_id,
                                ExternalAgentContextSlot.reserved_invocation_id == row.id,
                            )
                            .with_for_update()
                        )
                        if slot is not None:
                            self._settle_slot(slot, None, terminal=no_post, unresolved=not no_post)
                    if value.identity.workflow_run_id is not None:
                        run = session.scalar(
                            select(WorkflowRun)
                            .where(
                                WorkflowRun.id == value.identity.workflow_run_id,
                                WorkflowRun.tenant_id == row.tenant_id,
                                WorkflowRun.app_id == row.app_id,
                                WorkflowRun.created_by == row.initiator_id,
                            )
                            .with_for_update()
                        )
                        if run is not None and str(run.status) in {"running", "paused"}:
                            run.stop_requested_at = _db_time(now)
                            run.status, run.error, run.finished_at = (
                                WorkflowExecutionStatus.FAILED,
                                updated.error_message,
                                _db_time(now),
                            )
                    caller = (
                        None
                        if row.node_execution_id is None
                        else session.scalar(
                            select(WorkflowNodeExecutionModel)
                            .where(
                                WorkflowNodeExecutionModel.id == row.node_execution_id,
                                WorkflowNodeExecutionModel.tenant_id == row.tenant_id,
                                WorkflowNodeExecutionModel.app_id == row.app_id,
                                WorkflowNodeExecutionModel.created_by == row.initiator_id,
                            )
                            .with_for_update()
                        )
                    )
                    if caller is not None and str(caller.status) in {"running", "paused", "retry"}:
                        caller.status, caller.error, caller.finished_at = (
                            WorkflowNodeExecutionStatus.FAILED,
                            updated.error_message,
                            _db_time(now),
                        )
                    closed += 1
            return closed

    def reconcile(self, scope: RuntimeScope, *, now: datetime) -> int:
        with self._sessions() as session, session.begin():
            self._owner(session, scope)
            rows = session.scalars(
                select(ExternalAgentInvocation)
                .where(
                    ExternalAgentInvocation.tenant_id == scope.tenant_id,
                    ExternalAgentInvocation.app_id == scope.app_id,
                    ExternalAgentInvocation.initiator_id == scope.initiator_id,
                    ExternalAgentInvocation.origin == scope.origin,
                    ExternalAgentInvocation.submission_state == SubmissionState.SEND_STARTED,
                )
                .with_for_update()
            ).all()
            recovered = 0
            for row in rows:
                lease = session.scalar(
                    select(ExternalAgentCommand.id)
                    .where(
                        ExternalAgentCommand.invocation_id == row.id,
                        ExternalAgentCommand.tenant_id == scope.tenant_id,
                        ExternalAgentCommand.kind == CommandKind.DISPATCH,
                        ExternalAgentCommand.state == "leased",
                        ExternalAgentCommand.lease_until > _db_time(now),
                    )
                    .limit(1)
                )
                if lease is None:
                    old = self._record(row)
                    no_post = old.dispatched_at is None and old.remote_task_id is None
                    changed = replace(
                        old,
                        version=old.version + 1,
                        submission_state=SubmissionState.REJECTED if no_post else SubmissionState.UNKNOWN,
                        local_state=(
                            LocalState.FAILED
                            if old.local_state in {LocalState.WAITING, LocalState.RETRY_PENDING}
                            else old.local_state
                        ),
                        error_code="preparation_interrupted" if no_post else old.error_code or "submission_unknown",
                        error_message="External preparation was interrupted before a business request was sent."
                        if no_post
                        else old.error_message
                        or ("Dispatch acceptance could not be confirmed; the business request was not replayed."),
                        ended_at=old.ended_at or now,
                        local_wait_ended_at=old.local_wait_ended_at or now,
                        tracking_deadline=old.tracking_deadline
                        or now + timedelta(seconds=self._settings.tracking_seconds),
                    )
                    self._write(row, changed)
                    self._commands(
                        session,
                        changed,
                        (CommandDraft(kind=CommandKind.WAKE, not_before=now, dedupe_key=f"{row.id}:unknown-wake"),),
                    )
                    if row.context_slot_key:
                        slot = session.get(ExternalAgentContextSlot, row.context_slot_key)
                        if slot is not None and slot.reserved_invocation_id == row.id:
                            self._settle_slot(slot, None, terminal=no_post, unresolved=not no_post)
                    recovered += 1
            return recovered

    def recovery_scopes(self, *, now: datetime, limit: int = 100) -> tuple[RuntimeScope, ...]:
        """Read DB-owned scopes with orphaned SEND_STARTED work; do not mutate in a query."""
        with self._sessions() as session:
            active_lease = (
                select(ExternalAgentCommand.id)
                .where(
                    ExternalAgentCommand.tenant_id == ExternalAgentInvocation.tenant_id,
                    ExternalAgentCommand.invocation_id == ExternalAgentInvocation.id,
                    ExternalAgentCommand.kind == CommandKind.DISPATCH,
                    ExternalAgentCommand.state == "leased",
                    ExternalAgentCommand.lease_until > _db_time(now),
                )
                .exists()
            )
            rows = session.scalars(
                select(ExternalAgentInvocation)
                .where(
                    ExternalAgentInvocation.submission_state == SubmissionState.SEND_STARTED,
                    ExternalAgentInvocation.deleted_at.is_(None),
                    ~active_lease,
                )
                .order_by(ExternalAgentInvocation.created_at)
                .limit(limit)
            ).all()
            return tuple(dict.fromkeys(self._record(row).scope for row in rows))

    def load_workflow_binding(self, scope: RuntimeScope, *, workflow_id: str, node_id: str):
        from services.external_agents.workflow_runtime import ExternalNodeJob, ExternalWorkflowBinding

        with self._sessions() as session:
            self._owner(session, scope)
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.id == workflow_id, Workflow.tenant_id == scope.tenant_id, Workflow.app_id == scope.app_id
                )
            )
            if workflow is None:
                raise RuntimeError("binding_unavailable", "The owning workflow is unavailable.")
            binding = session.scalar(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.workflow_id == workflow_id,
                    WorkflowAgentNodeBinding.tenant_id == scope.tenant_id,
                    WorkflowAgentNodeBinding.app_id == scope.app_id,
                    WorkflowAgentNodeBinding.node_id == node_id,
                    WorkflowAgentNodeBinding.workflow_version == workflow.version,
                )
            )
            agent = (
                None
                if binding is None
                else session.scalar(
                    select(Agent).where(
                        Agent.id == binding.agent_id,
                        Agent.tenant_id == scope.tenant_id,
                        Agent.agent_kind == AgentKind.EXTERNAL_A2A,
                    )
                )
            )
            if binding is None or not binding.external_job_config or agent is None:
                raise RuntimeError("binding_unavailable", "Select an external agent before running.")
            return ExternalWorkflowBinding(
                agent_id=binding.agent_id,
                binding_epoch=binding.binding_epoch,
                job=ExternalNodeJob.model_validate(binding.external_job_config),
                original_reference=binding.original_reference,
            )

    def budget_deadline(self, scope: RuntimeScope, identity: ExecutionIdentity, *, now: datetime) -> datetime:
        """Restore the same run budget, excluding only an explicit Human-only pause."""
        with self._sessions() as session, session.begin():
            self._owner(session, scope)
            return self._budget(session, scope, identity, now)

    def pause_budget(
        self, scope: RuntimeScope, identity: ExecutionIdentity, *, human_only: bool, now: datetime
    ) -> None:
        """Persist stopped-clock marker only for a Human-only checkpoint."""
        if identity.workflow_run_id is None:
            return
        with self._sessions() as session, session.begin():
            self._owner(session, scope)
            row = session.scalar(
                select(ExternalWorkflowBudget)
                .where(
                    ExternalWorkflowBudget.workflow_run_id == identity.workflow_run_id,
                    ExternalWorkflowBudget.tenant_id == scope.tenant_id,
                    ExternalWorkflowBudget.app_id == scope.app_id,
                )
                .with_for_update()
            )
            if row is not None and human_only and row.human_pause_started_at is None:
                row.human_pause_started_at = _db_time(now)
                row.version += 1

"""SQLAlchemy adapters for external observations, owners and frozen deliveries.

Every write has an explicit transaction and locks its Invocation before checking
parent tombstones. Network/provider/file I/O never occurs in these transactions.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from itertools import starmap
from sqlite3 import Connection as SQLiteConnection
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from dify_trace_sdk.egress import Egress
from dify_trace_sdk.model import Trace
from dify_trace_sdk.provider import SendResult
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from libs.uuid_utils import uuidv7
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin
from models.agent import WorkflowAgentNodeBinding
from models.external_agent import (
    ExternalAgentCommand,
    ExternalAgentConnectionRevision,
    ExternalAgentContextSlot,
    ExternalAgentFileLease,
    ExternalAgentHead,
    ExternalAgentInvocation,
    ExternalAgentOperation,
    ExternalAgentVerification,
    ExternalWorkflowBudget,
)
from models.external_agent_trace import (
    ExternalAgentDataTombstone,
    ExternalAgentTraceReceipt,
    ExternalAgentTraceRecord,
    ExternalAgentTraceTarget,
    ExternalAgentTraceUsageSummary,
    ExternalAgentTracingConfig,
)
from models.external_agent_trace import (
    ExternalAgentTraceDelivery as DeliveryRow,
)
from models.external_agent_trace import (
    ExternalAgentTraceStep as StepRow,
)
from models.model import App, Message, TraceAppConfig, UploadFile
from repositories.app.tracing_config_repository import trace_settings_from_column
from services.external_agents.contracts import (
    ExternalAgentForbiddenError,
    ExternalAgentNotFoundError,
    ExternalAssetAccess,
    ExternalSecretCodec,
)
from services.external_agents.observability import (
    InvocationMetric,
    InvocationObservationOwner,
    MetricBucket,
    MonitoringQuery,
    MonitoringScope,
    ObservationAccessDeniedError,
    ObservationConflictError,
    ObservationExpiredError,
    ObservationNotFoundError,
    TraceSnapshot,
    aware_utc,
)
from services.external_agents.retention import ExternalDeletionScope, TestFileCleanup
from services.external_agents.runtime_contracts import RuntimeError as ExternalRuntimeError
from services.external_agents.test_service import ExternalTestStatistics
from services.external_agents.traceability import (
    ExternalTraceStep,
    NormalizedExternalTrace,
    ReportedCallUsage,
    TraceLimits,
    TraceState,
    merge_step,
    resolve_step_parents,
)
from services.external_agents.tracing_config import (
    ExternalTraceDelivery,
    ExternalTraceDeliveryStatus,
    ExternalTracingProviderState,
    FrozenExternalTraceTarget,
    StoredExternalTracingConfig,
    TraceExportPreflightError,
)
from services.rbac.contracts import MyPermissionsResponse
from services.tracing.errors import (
    ProviderConfigUnreadableError,
    TraceProviderUnavailableError,
    UnknownTraceProviderError,
)
from services.tracing.providers import ProviderConfigCodec, TraceProviderCatalog


def _db_time(value: datetime) -> datetime:
    return aware_utc(value).replace(tzinfo=None)


class PermissionsReader(Protocol):
    def permissions(
        self,
        workspace_id: str,
        account_id: str | None,
        *,
        app_id: str | None = None,
        dataset_id: str | None = None,
        agent_id: str | None = None,
        language: str | None = None,
    ) -> MyPermissionsResponse: ...


class DatabaseExternalObservationAccess:
    def __init__(
        self, *, sessions: sessionmaker[Session], assets: ExternalAssetAccess, permissions: PermissionsReader
    ) -> None:
        self._sessions, self._assets, self._permissions = sessions, assets, permissions

    def _asset(self, context: RequestContext, agent_id: str) -> str:
        role = self._assets.role(context)
        visible = self._assets.visible_agent_ids(context)
        if (
            role is None
            or role not in {"owner", "admin", "editor", "normal"}
            or (visible is not None and agent_id not in visible)
        ):
            raise ObservationAccessDeniedError("external_agent_not_accessible")
        with self._sessions() as session:
            exists = session.scalar(
                select(ExternalAgentHead.agent_id).where(
                    ExternalAgentHead.tenant_id == context.active_workspace_id,
                    ExternalAgentHead.agent_id == agent_id,
                    ExternalAgentHead.deleted_at.is_(None),
                )
            )
        if exists is None:
            raise ObservationNotFoundError("external_agent_not_found")
        return role

    def manage(self, context: RequestContext, agent_id: str) -> None:
        if self._asset(context, agent_id) not in {"owner", "admin"}:
            raise ObservationAccessDeniedError("external_agent_management_required")

    def monitor(self, context: RequestContext, agent_id: str) -> MonitoringScope:
        role = self._asset(context, agent_id)
        with self._sessions() as session:
            timezone = (
                session.scalar(
                    select(Account.timezone)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(TenantAccountJoin.tenant_id == context.active_workspace_id, Account.id == context.account_id)
                )
                or "UTC"
            )
        if role == "normal":
            return MonitoringScope(True, None, timezone)
        return MonitoringScope(False, self._readable_app_ids(context), timezone)

    def _readable_app_ids(self, context: RequestContext) -> frozenset[str]:
        """Own the exact App cohort shared by Monitoring and asset reference reads."""
        with self._sessions() as session:
            ids = tuple(session.scalars(select(App.id).where(App.tenant_id == context.active_workspace_id)))
        permissions = self._permissions.permissions(context.active_workspace_id, context.account_id)
        keys = permissions.app.permission_keys_by_resource_ids(list(ids))
        allowed = frozenset(identifier for identifier, grants in keys.items() if "app.acl.monitor" in grants)
        return allowed & context.resource_app_ids if context.resource_app_ids is not None else allowed

    def reference_list_app_ids(self, context: RequestContext) -> frozenset[str] | None:
        """Read one current App policy for the admitted list; Normal gets no detail capability."""
        role = self._assets.role(context)
        if role == "normal":
            return None
        if role not in {"owner", "admin", "editor"}:
            raise ExternalAgentForbiddenError("Workspace membership is required.")
        return self._readable_app_ids(context)

    def reference_app_ids(self, context: RequestContext, agent_id: str) -> frozenset[str]:
        """Reuse Monitoring's exact App policy, with no Normal detail bypass.

        Preconditions: the asset service admitted a detail-capable role.
        Recheck membership/asset visibility here; a concurrent demotion to
        Normal remains denied instead of converting its aggregate scope to all
        App details. Translate this adapter's errors to the asset port contract.
        """
        try:
            scope = self.monitor(context, agent_id)
        except ObservationAccessDeniedError as error:
            raise ExternalAgentForbiddenError("The External Agent is not accessible.") from error
        except ObservationNotFoundError as error:
            raise ExternalAgentNotFoundError("External Agent not found.") from error
        if scope.normal_aggregate or scope.app_ids is None:
            raise ExternalAgentForbiddenError("The workspace role does not allow App reference details.")
        return scope.app_ids

    def trace_read(self, context: RequestContext, owner: InvocationObservationOwner) -> None:
        role = self._assets.role(context)
        if owner.tenant_id != context.active_workspace_id or role not in {"owner", "admin", "editor"}:
            raise ObservationAccessDeniedError("run_read_permission_required")
        if owner.origin != "production":
            if owner.initiator_id != context.account_id:
                raise ObservationAccessDeniedError("test_owner_required")
            if owner.app_id is None:
                visible = self._assets.visible_agent_ids(context)
                if visible is not None and owner.agent_id not in visible:
                    raise ObservationAccessDeniedError("external_agent_not_accessible")
        if owner.app_id is not None:
            if context.resource_app_ids is not None and owner.app_id not in context.resource_app_ids:
                raise ObservationAccessDeniedError("run_read_permission_required")
            permissions = self._permissions.permissions(
                context.active_workspace_id, context.account_id, app_id=owner.app_id
            )
            keys = permissions.app.permission_keys_by_resource_ids([owner.app_id])[owner.app_id]
            needed = "app.acl.log_and_annotation" if owner.origin == "production" else "app.acl.test_and_run"
            if needed not in keys:
                raise ObservationAccessDeniedError("run_read_permission_required")


class ExternalObservabilityRepository:
    def __init__(self, *, sessions: sessionmaker[Session], limits: TraceLimits) -> None:
        self._sessions, self._limits = sessions, limits

    @staticmethod
    def _owner_value(row: ExternalAgentInvocation) -> InvocationObservationOwner:
        return InvocationObservationOwner(
            row.tenant_id,
            row.id,
            row.agent_id,
            row.app_id,
            row.workflow_run_id,
            row.node_execution_id,
            row.message_id,
            row.origin,
            row.initiator_id,
            row.connection_revision_id or "",
            row.tracing_enabled,
            row.started_at,
            row.dispatched_at,
            row.ended_at,
            row.local_wait_ended_at,
            row.retention_expires_at,
            row.test_expires_at,
            row.deleted_at,
            row.local_state,
            row.remote_state,
        )

    @staticmethod
    def _tombstoned(session: Session, row: ExternalAgentInvocation) -> bool:
        owners = [("tenant", row.tenant_id), ("invocation", row.id)]
        owners += [
            (kind, value)
            for kind, value in (("app", row.app_id), ("workflow_run", row.workflow_run_id))
            if value is not None
        ]
        if row.context_slot_key:
            owners.append(("context_slot", row.context_slot_key))
            conversation = session.scalar(
                select(ExternalAgentContextSlot.conversation_id).where(
                    ExternalAgentContextSlot.tenant_id == row.tenant_id,
                    ExternalAgentContextSlot.key == row.context_slot_key,
                )
            )
            if conversation:
                owners.append(("conversation", conversation))
        predicates = [
            sa.and_(ExternalAgentDataTombstone.owner_kind == kind, ExternalAgentDataTombstone.owner_id == value)
            for kind, value in owners
        ]
        return (
            session.scalar(
                select(ExternalAgentDataTombstone.id)
                .where(ExternalAgentDataTombstone.tenant_id == row.tenant_id, or_(*predicates))
                .limit(1)
            )
            is not None
        )

    def _owned(
        self,
        session: Session,
        *,
        tenant_id: str,
        invocation_id: str,
        now: datetime,
        lock: bool = False,
        ingest: bool = False,
    ) -> ExternalAgentInvocation:
        stmt = select(ExternalAgentInvocation).where(
            ExternalAgentInvocation.tenant_id == tenant_id, ExternalAgentInvocation.id == invocation_id
        )
        row = session.scalar(stmt.with_for_update() if lock else stmt)
        if row is None or row.deleted_at is not None or self._tombstoned(session, row):
            raise ObservationNotFoundError("external_invocation_not_found")
        if (
            row.app_id is not None
            and session.scalar(select(App.id).where(App.tenant_id == tenant_id, App.id == row.app_id)) is None
        ):
            raise ObservationNotFoundError("source_app_not_found")
        expiries = [value for value in (row.retention_expires_at, row.test_expires_at) if value is not None]
        if any(_db_time(now) >= value for value in expiries):
            raise ObservationExpiredError("external_invocation_expired")
        if ingest:
            deadline = row.tracking_deadline
            if row.local_wait_ended_at is not None:
                deadline = (
                    min(deadline, row.local_wait_ended_at + timedelta(hours=24))
                    if deadline
                    else (row.local_wait_ended_at + timedelta(hours=24))
                )
            if row.dispatched_at is None or not row.connection_revision_id:
                raise ObservationConflictError("external_invocation_not_dispatched")
            if deadline is not None and _db_time(now) >= deadline:
                raise ObservationExpiredError("external_tracking_closed")
        return row

    def owner(self, *, tenant_id: str, invocation_id: str, now: datetime) -> InvocationObservationOwner:
        with self._sessions() as session:
            return self._owner_value(self._owned(session, tenant_id=tenant_id, invocation_id=invocation_id, now=now))

    def test_statistics(
        self, context: RequestContext, *, agent_id: str, invocation_id: str, now: datetime
    ) -> ExternalTestStatistics:
        """Read one retained, actor-owned logical test without broadening its scope.

        The selected attempt pins the upper sequence. Duration is the logical
        wall time from first actual dispatch, including retry/cancellation gaps;
        terminal reads stop at local_wait_ended_at. Only trustworthy call-total
        rows contribute usage, and any unknown dispatched attempt makes the
        total unknown. Prepared work and Trace steps never count as external IO.
        """
        try:
            with self._sessions() as session:
                latest = self._owned(
                    session, tenant_id=context.active_workspace_id, invocation_id=invocation_id, now=now
                )
                if (
                    latest.agent_id != agent_id
                    or latest.initiator_id != context.account_id
                    or latest.origin != "overview_test"
                    or latest.app_id is not None
                ):
                    raise ObservationNotFoundError("external_invocation_not_found")
                invocation, usage = ExternalAgentInvocation, ExternalAgentTraceUsageSummary
                attempts = session.execute(
                    select(invocation, usage.total_tokens)
                    .outerjoin(
                        usage, sa.and_(usage.tenant_id == invocation.tenant_id, usage.invocation_id == invocation.id)
                    )
                    .where(
                        invocation.tenant_id == context.active_workspace_id,
                        invocation.agent_id == agent_id,
                        invocation.initiator_id == context.account_id,
                        invocation.origin == "overview_test",
                        invocation.app_id.is_(None),
                        invocation.execution_key == latest.execution_key,
                        invocation.test_generation == latest.test_generation,
                        invocation.sequence <= latest.sequence,
                    )
                    .order_by(invocation.sequence)
                ).all()
                for attempt, _ in attempts:
                    self._owned(session, tenant_id=context.active_workspace_id, invocation_id=attempt.id, now=now)
                dispatched = [(attempt, tokens) for attempt, tokens in attempts if attempt.dispatched_at is not None]
                reported = [tokens for _, tokens in dispatched if type(tokens) is int and tokens >= 0]
                starts = [aware_utc(attempt.dispatched_at) for attempt, _ in dispatched if attempt.dispatched_at]
                end = (
                    aware_utc(now)
                    if latest.local_state in {"waiting", "retry_pending"}
                    else aware_utc(latest.local_wait_ended_at)
                    if latest.local_wait_ended_at is not None
                    else None
                )
                elapsed = (end - min(starts)).total_seconds() if starts and end is not None else None
                count = len(dispatched)
                return ExternalTestStatistics(
                    elapsed if elapsed is not None and elapsed >= 0 else None,
                    sum(reported) if count and len(reported) == count else None,
                    count,
                    len(reported),
                    count,
                )
        except ObservationNotFoundError as error:
            raise ExternalRuntimeError("invocation_not_found", "The requested test was not found.") from error
        except ObservationExpiredError as error:
            raise ExternalRuntimeError("test_expired", "The temporary test result has expired.") from error

    @staticmethod
    def _step(row: StepRow) -> ExternalTraceStep:
        return ExternalTraceStep(
            row.step_key,
            row.payload_hash,
            tuple(row.trace_path),
            row.remote_trace_id,
            row.remote_step_id,
            row.parent_step_id,
            row.resolved_parent_key,
            row.kind,
            row.name,
            aware_utc(row.started_at) if row.started_at else None,
            aware_utc(row.ended_at) if row.ended_at else None,
            row.status,
            row.error,
            row.total_tokens,
            dict(row.raw_data),
        )

    @staticmethod
    def _set_step(row: StepRow, step: ExternalTraceStep) -> None:
        row.payload_hash = step.payload_hash
        row.parent_step_id, row.resolved_parent_key = step.parent_step_id, step.resolved_parent_key
        row.kind, row.name = step.kind, step.name
        row.started_at = _db_time(step.started_at) if step.started_at else None
        row.ended_at = _db_time(step.ended_at) if step.ended_at else None
        row.status, row.error, row.total_tokens = step.status, step.error, step.total_tokens
        row.raw_data = dict(step.raw_data)

    def _snapshot(self, session: Session, *, tenant_id: str, invocation_id: str) -> TraceSnapshot | None:
        record = session.scalar(
            select(ExternalAgentTraceRecord).where(
                ExternalAgentTraceRecord.tenant_id == tenant_id, ExternalAgentTraceRecord.invocation_id == invocation_id
            )
        )
        if record is None:
            return None
        steps = [
            self._step(row)
            for row in session.scalars(
                select(StepRow)
                .where(StepRow.tenant_id == tenant_id, StepRow.invocation_id == invocation_id)
                .order_by(StepRow.id)
            )
        ]
        usage = session.scalar(
            select(ExternalAgentTraceUsageSummary).where(
                ExternalAgentTraceUsageSummary.tenant_id == tenant_id,
                ExternalAgentTraceUsageSummary.invocation_id == invocation_id,
            )
        )
        ordered = tuple(
            sorted(
                resolve_step_parents(steps),
                key=lambda step: (
                    step.trace_path,
                    step.started_at is None,
                    step.started_at or datetime.min.replace(tzinfo=UTC),
                ),
            )
        )
        return TraceSnapshot(
            TraceState(record.state),
            record.revision,
            ordered,
            tuple(record.diagnostics),
            usage.total_tokens if usage else None,
            usage.revision if usage else 0,
        )

    def snapshot(self, *, tenant_id: str, invocation_id: str) -> TraceSnapshot | None:
        with self._sessions() as session:
            return self._snapshot(session, tenant_id=tenant_id, invocation_id=invocation_id)

    def record(
        self, *, owner: InvocationObservationOwner, trace: NormalizedExternalTrace, now: datetime
    ) -> TraceSnapshot:
        with self._sessions.begin() as session:
            invocation = self._owned(
                session, tenant_id=owner.tenant_id, invocation_id=owner.id, now=now, lock=True, ingest=True
            )
            if not invocation.tracing_enabled or invocation.connection_revision_id != owner.connection_revision_id:
                raise ObservationConflictError("trace_owner_changed")
            record = session.scalar(
                select(ExternalAgentTraceRecord).where(
                    ExternalAgentTraceRecord.tenant_id == owner.tenant_id,
                    ExternalAgentTraceRecord.invocation_id == owner.id,
                )
            )
            if record is None:
                record = ExternalAgentTraceRecord(
                    invocation_id=owner.id, tenant_id=owner.tenant_id, agent_id=owner.agent_id, state=trace.state
                )
                session.add(record)
                session.flush()
            duplicate = session.scalar(
                select(ExternalAgentTraceReceipt.id)
                .where(
                    ExternalAgentTraceReceipt.tenant_id == owner.tenant_id,
                    ExternalAgentTraceReceipt.invocation_id == owner.id,
                    ExternalAgentTraceReceipt.payload_hash == trace.payload_hash,
                )
                .limit(1)
            )
            if duplicate is None:
                self._append(session, record=record, trace=trace, now=now)
            snapshot = self._snapshot(session, tenant_id=owner.tenant_id, invocation_id=owner.id)
            if snapshot is None:
                raise ObservationConflictError("trace_write_conflict")
            return snapshot

    def _append(
        self, session: Session, *, record: ExternalAgentTraceRecord, trace: NormalizedExternalTrace, now: datetime
    ) -> None:
        rows = {
            row.step_key: row
            for row in session.scalars(
                select(StepRow).where(
                    StepRow.tenant_id == record.tenant_id, StepRow.invocation_id == record.invocation_id
                )
            )
        }
        diagnostics = list(dict.fromkeys([*record.diagnostics, *trace.diagnostics]))
        receipt_count = (
            session.scalar(
                select(func.count())
                .select_from(ExternalAgentTraceReceipt)
                .where(
                    ExternalAgentTraceReceipt.tenant_id == record.tenant_id,
                    ExternalAgentTraceReceipt.invocation_id == record.invocation_id,
                )
            )
            or 0
        )
        changed = False
        if receipt_count < self._limits.max_steps:
            for step in trace.steps:
                current = rows.get(step.key)
                candidate, conflict = merge_step(self._step(current), step) if current is not None else (step, False)
                if conflict:
                    diagnostics.append("step_identity_conflict")
                elif current is None and len(rows) >= self._limits.max_steps:
                    diagnostics.append("trace_step_limit")
                else:
                    raw_bytes = len(json.dumps(candidate.raw_data, ensure_ascii=True).encode())
                    old_bytes = len(json.dumps(current.raw_data, ensure_ascii=True).encode()) if current else 0
                    if record.payload_bytes + raw_bytes - old_bytes > self._limits.max_bytes:
                        diagnostics.append("trace_payload_limit")
                    elif current is None:
                        current = StepRow(
                            id=str(uuidv7()),
                            tenant_id=record.tenant_id,
                            invocation_id=record.invocation_id,
                            step_key=step.key,
                            payload_hash=step.payload_hash,
                            trace_path=list(step.trace_path),
                            remote_trace_id=step.trace_id,
                            remote_step_id=step.step_id,
                            parent_step_id=None,
                            resolved_parent_key=None,
                            kind=None,
                            name=None,
                            started_at=None,
                            ended_at=None,
                            status=None,
                            error=None,
                            total_tokens=None,
                            raw_data={},
                        )
                        self._set_step(current, candidate)
                        session.add(current)
                        rows[step.key] = current
                        record.payload_bytes += raw_bytes
                        changed = True
                    elif self._step(current) != candidate:
                        self._set_step(current, candidate)
                        record.payload_bytes += raw_bytes - old_bytes
                        changed = True
            session.add(
                ExternalAgentTraceReceipt(
                    id=str(uuidv7()),
                    tenant_id=record.tenant_id,
                    invocation_id=record.invocation_id,
                    receipt_key=hashlib.sha256(f"{trace.source_id}:{trace.payload_hash}".encode()).hexdigest(),
                    payload_hash=trace.payload_hash,
                    source_id=trace.source_id[:512],
                    dialect=trace.dialect,
                    received_at=_db_time(now),
                )
            )
        else:
            diagnostics.append("trace_receipt_limit")
        state = TraceState.RECEIVED if rows else trace.state
        normalized_diagnostics = list(dict.fromkeys(diagnostics))[:128]
        changed = changed or state != record.state or normalized_diagnostics != record.diagnostics
        record.state, record.diagnostics = state, normalized_diagnostics
        record.revision += int(changed)
        record.updated_at = _db_time(now)
        session.flush()

    def record_usage(
        self, *, owner: InvocationObservationOwner, usage: ReportedCallUsage, revision: int, now: datetime
    ) -> None:
        if type(revision) is not int or revision < 0:
            raise ValueError("invalid_usage_revision")
        with self._sessions.begin() as session:
            self._owned(session, tenant_id=owner.tenant_id, invocation_id=owner.id, now=now, lock=True, ingest=True)
            current = session.scalar(
                select(ExternalAgentTraceUsageSummary).where(
                    ExternalAgentTraceUsageSummary.tenant_id == owner.tenant_id,
                    ExternalAgentTraceUsageSummary.invocation_id == owner.id,
                )
            )
            changed = current is None or revision > current.revision
            if current is None:
                session.add(
                    ExternalAgentTraceUsageSummary(
                        invocation_id=owner.id,
                        tenant_id=owner.tenant_id,
                        total_tokens=usage.total_tokens,
                        source_path=usage.source_path,
                        adapter=usage.adapter,
                        revision=revision,
                        updated_at=_db_time(now),
                    )
                )
            elif revision == current.revision and (current.total_tokens, current.source_path, current.adapter) != (
                usage.total_tokens,
                usage.source_path,
                usage.adapter,
            ):
                raise ObservationConflictError("call_usage_revision_conflict")
            elif revision > current.revision:
                current.total_tokens, current.source_path, current.adapter = (
                    usage.total_tokens,
                    usage.source_path,
                    usage.adapter,
                )
                current.revision, current.updated_at = revision, _db_time(now)
            if changed:
                record = session.scalar(
                    select(ExternalAgentTraceRecord).where(
                        ExternalAgentTraceRecord.tenant_id == owner.tenant_id,
                        ExternalAgentTraceRecord.invocation_id == owner.id,
                    )
                )
                if record is None:
                    record = ExternalAgentTraceRecord(
                        invocation_id=owner.id,
                        tenant_id=owner.tenant_id,
                        agent_id=owner.agent_id,
                        state=TraceState.COLLECTING if owner.tracing_enabled else TraceState.NOT_REQUESTED,
                    )
                    session.add(record)
                record.revision += 1
                record.updated_at = _db_time(now)

    def metrics(
        self, *, tenant_id: str, agent_id: str, scope: MonitoringScope, query: MonitoringQuery, now: datetime
    ) -> Sequence[InvocationMetric]:
        invocation, usage = ExternalAgentInvocation, ExternalAgentTraceUsageSummary
        stmt = (
            select(invocation, usage.total_tokens)
            .outerjoin(usage, sa.and_(usage.tenant_id == invocation.tenant_id, usage.invocation_id == invocation.id))
            .where(
                invocation.tenant_id == tenant_id,
                invocation.agent_id == agent_id,
                invocation.origin == "production",
                invocation.dispatched_at >= _db_time(query.start),
                invocation.dispatched_at < _db_time(query.end),
                invocation.deleted_at.is_(None),
                or_(invocation.retention_expires_at.is_(None), invocation.retention_expires_at > _db_time(now)),
            )
        )
        if scope.app_ids is not None:
            stmt = stmt.where(invocation.app_id.in_(scope.app_ids))
        if query.app_id is not None:
            stmt = stmt.where(invocation.app_id == query.app_id)
        with self._sessions() as session:
            stmt = stmt.where(~self._tombstone_predicate())
            return [
                InvocationMetric(
                    row.id, row.app_id, row.origin, row.dispatched_at, row.started_at, row.ended_at, tokens
                )
                for row, tokens in session.execute(stmt)
            ]

    def apps(self, *, tenant_id: str, agent_id: str, scope: MonitoringScope) -> Sequence[Mapping[str, str]]:
        with self._sessions() as session:
            historical = select(ExternalAgentInvocation.app_id).where(
                ExternalAgentInvocation.tenant_id == tenant_id,
                ExternalAgentInvocation.agent_id == agent_id,
                ExternalAgentInvocation.deleted_at.is_(None),
            )
            bound = select(WorkflowAgentNodeBinding.app_id).where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id, WorkflowAgentNodeBinding.agent_id == agent_id
            )
            stmt = select(App.id, App.name, App.mode).where(
                App.tenant_id == tenant_id, or_(App.id.in_(historical), App.id.in_(bound))
            )
            if scope.app_ids is not None:
                stmt = stmt.where(App.id.in_(scope.app_ids))
            return [
                {"id": identifier, "name": name, "type": str(mode)}
                for identifier, name, mode in session.execute(stmt.order_by(App.name, App.id))
            ]

    def metric_buckets(
        self, *, tenant_id: str, agent_id: str, scope: MonitoringScope, query: MonitoringQuery, now: datetime
    ) -> Sequence[MetricBucket]:
        invocation, usage = ExternalAgentInvocation, ExternalAgentTraceUsageSummary
        with self._sessions() as session:
            timezone = query.timezone or "UTC"
            dialect = session.get_bind().dialect.name
            if dialect == "sqlite":
                raw = session.connection().connection.driver_connection
                if not isinstance(raw, SQLiteConnection):
                    raise ObservationConflictError("unsupported_sqlite_driver")
                raw.create_function(
                    "byoa_local_day",
                    2,
                    lambda value, tz: (
                        aware_utc(datetime.fromisoformat(value)).astimezone(ZoneInfo(tz)).date().isoformat()
                        if value
                        else None
                    ),
                )
                raw.create_function(
                    "byoa_duration",
                    2,
                    lambda start, end: (
                        (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds()
                        if start and end
                        else None
                    ),
                )
                bucket = func.byoa_local_day(invocation.dispatched_at, timezone)
                elapsed = func.byoa_duration(invocation.started_at, invocation.ended_at)
            elif dialect == "mysql":
                bucket = func.date(func.convert_tz(invocation.dispatched_at, "+00:00", timezone))
                elapsed = (
                    func.timestampdiff(sa.literal_column("MICROSECOND"), invocation.started_at, invocation.ended_at)
                    / 1_000_000.0
                )
            else:
                bucket = func.date(func.timezone(timezone, func.timezone("UTC", invocation.dispatched_at)))
                elapsed = sa.extract("epoch", invocation.ended_at - invocation.started_at)
            duration = sa.case(
                (
                    sa.and_(
                        invocation.started_at.is_not(None),
                        invocation.ended_at.is_not(None),
                        invocation.ended_at >= invocation.started_at,
                    ),
                    elapsed,
                ),
                else_=None,
            )
            stmt = (
                select(
                    bucket.label("bucket"),
                    func.count(invocation.id),
                    func.sum(duration),
                    func.count(duration),
                    func.sum(usage.total_tokens),
                    func.count(usage.invocation_id),
                )
                .select_from(invocation)
                .outerjoin(
                    usage, sa.and_(usage.tenant_id == invocation.tenant_id, usage.invocation_id == invocation.id)
                )
                .where(
                    invocation.tenant_id == tenant_id,
                    invocation.agent_id == agent_id,
                    invocation.origin == "production",
                    invocation.dispatched_at >= _db_time(query.start),
                    invocation.dispatched_at < _db_time(query.end),
                    invocation.deleted_at.is_(None),
                    ~self._tombstone_predicate(),
                    or_(invocation.retention_expires_at.is_(None), invocation.retention_expires_at > _db_time(now)),
                )
            )
            if scope.app_ids is not None:
                stmt = stmt.where(invocation.app_id.in_(scope.app_ids))
            if query.app_id is not None:
                stmt = stmt.where(invocation.app_id == query.app_id)
            result: list[MetricBucket] = []
            for day, calls, seconds, duration_count, tokens, known in session.execute(
                stmt.group_by(bucket).order_by(bucket)
            ):
                if day is None:
                    raise ObservationConflictError("monitoring_timezone_data_unavailable")
                result.append(
                    MetricBucket(
                        date.fromisoformat(day) if isinstance(day, str) else day,
                        int(calls),
                        float(seconds or 0),
                        int(duration_count),
                        int(tokens or 0),
                        int(known),
                    )
                )
            return tuple(result)

    @staticmethod
    def _manage_owner(session: Session, context: RequestContext, agent_id: str) -> None:
        membership = session.scalar(
            select(TenantAccountJoin.role)
            .where(
                TenantAccountJoin.tenant_id == context.active_workspace_id,
                TenantAccountJoin.account_id == context.account_id,
            )
            .with_for_update()
        )
        head = session.scalar(
            select(ExternalAgentHead)
            .where(
                ExternalAgentHead.tenant_id == context.active_workspace_id,
                ExternalAgentHead.agent_id == agent_id,
                ExternalAgentHead.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if str(membership) not in {"owner", "admin"}:
            raise ObservationAccessDeniedError("external_agent_management_required")
        if head is None:
            raise ObservationNotFoundError("external_agent_not_found")

    @staticmethod
    def _config_value(row: ExternalAgentTracingConfig) -> StoredExternalTracingConfig:
        return StoredExternalTracingConfig(
            row.provider, row.revision, row.enabled, row.capture_content, dict(row.encrypted_config)
        )

    def config(self, *, tenant_id: str, agent_id: str, provider: str) -> StoredExternalTracingConfig | None:
        with self._sessions() as session:
            row = session.scalar(
                select(ExternalAgentTracingConfig).where(
                    ExternalAgentTracingConfig.tenant_id == tenant_id,
                    ExternalAgentTracingConfig.agent_id == agent_id,
                    ExternalAgentTracingConfig.provider == provider,
                )
            )
            return self._config_value(row) if row else None

    def configured_provider_states(
        self, context: RequestContext, *, agent_id: str
    ) -> Sequence[ExternalTracingProviderState]:
        """Read only configured state columns after live owner/admin admission.

        No encrypted_config column is selected or decrypted. All configured
        providers share this read snapshot and stable ordering, including disabled
        ones; concurrent writes cannot produce a mixed N-request overview.
        """
        with self._sessions() as session:
            self._manage_owner(session, context, agent_id)
            rows = session.execute(
                select(
                    ExternalAgentTracingConfig.provider,
                    ExternalAgentTracingConfig.revision,
                    ExternalAgentTracingConfig.enabled,
                    ExternalAgentTracingConfig.capture_content,
                )
                .where(
                    ExternalAgentTracingConfig.tenant_id == context.active_workspace_id,
                    ExternalAgentTracingConfig.agent_id == agent_id,
                )
                .order_by(ExternalAgentTracingConfig.provider)
            )
            return tuple(starmap(ExternalTracingProviderState, rows))

    def save_config(
        self,
        *,
        context: RequestContext,
        agent_id: str,
        provider: str,
        encrypted_config: Mapping[str, Any],
        enabled: bool,
        capture_content: bool,
        expected_revision: int,
        now: datetime,
    ) -> StoredExternalTracingConfig:
        with self._sessions.begin() as session:
            self._manage_owner(session, context, agent_id)
            row = session.scalar(
                select(ExternalAgentTracingConfig).where(
                    ExternalAgentTracingConfig.tenant_id == context.active_workspace_id,
                    ExternalAgentTracingConfig.agent_id == agent_id,
                    ExternalAgentTracingConfig.provider == provider,
                )
            )
            if (row.revision if row else 0) != expected_revision:
                raise ObservationConflictError("tracing_config_changed")
            if enabled:
                session.execute(
                    update(ExternalAgentTracingConfig)
                    .where(
                        ExternalAgentTracingConfig.tenant_id == context.active_workspace_id,
                        ExternalAgentTracingConfig.agent_id == agent_id,
                        ExternalAgentTracingConfig.provider != provider,
                    )
                    .values(enabled=False)
                )
            if row is None:
                row = ExternalAgentTracingConfig(
                    id=str(uuidv7()),
                    tenant_id=context.active_workspace_id,
                    agent_id=agent_id,
                    provider=provider,
                    encrypted_config=dict(encrypted_config),
                    enabled=enabled,
                    capture_content=capture_content,
                    revision=1,
                    updated_at=_db_time(now),
                )
                session.add(row)
            else:
                row.encrypted_config, row.enabled, row.capture_content = (
                    dict(encrypted_config),
                    enabled,
                    capture_content,
                )
                row.revision += 1
                row.updated_at = _db_time(now)
            return self._config_value(row)

    def delete_config(self, *, context: RequestContext, agent_id: str, provider: str, expected_revision: int) -> None:
        with self._sessions.begin() as session:
            self._manage_owner(session, context, agent_id)
            row = session.scalar(
                select(ExternalAgentTracingConfig).where(
                    ExternalAgentTracingConfig.tenant_id == context.active_workspace_id,
                    ExternalAgentTracingConfig.agent_id == agent_id,
                    ExternalAgentTracingConfig.provider == provider,
                )
            )
            if row is None or row.revision != expected_revision:
                raise ObservationConflictError("tracing_config_changed")
            session.delete(row)

    @staticmethod
    def _target(row: ExternalAgentTraceTarget) -> FrozenExternalTraceTarget:
        if row.target_kind not in {"asset", "app"}:
            raise ObservationConflictError("invalid_trace_target")
        return FrozenExternalTraceTarget(
            row.tenant_id,
            row.invocation_id,
            "asset" if row.target_kind == "asset" else "app",
            row.target_id,
            row.provider,
            row.config_revision,
            dict(row.encrypted_config),
            row.capture_content,
        )

    @staticmethod
    def _targets(session: Session, tenant_id: str, invocation_id: str) -> tuple[FrozenExternalTraceTarget, ...]:
        return tuple(
            ExternalObservabilityRepository._target(row)
            for row in session.scalars(
                select(ExternalAgentTraceTarget).where(
                    ExternalAgentTraceTarget.tenant_id == tenant_id,
                    ExternalAgentTraceTarget.invocation_id == invocation_id,
                )
            )
        )

    def freeze_targets(
        self, *, tenant_id: str, invocation_id: str, now: datetime
    ) -> Sequence[FrozenExternalTraceTarget]:
        with self._sessions.begin() as session:
            invocation = self._owned(session, tenant_id=tenant_id, invocation_id=invocation_id, now=now, lock=True)
            record = session.scalar(
                select(ExternalAgentTraceRecord).where(
                    ExternalAgentTraceRecord.tenant_id == tenant_id,
                    ExternalAgentTraceRecord.invocation_id == invocation_id,
                )
            )
            if record is not None and record.targets_frozen:
                return self._targets(session, tenant_id, invocation_id)
            if invocation.dispatched_at is not None:
                # Freezing after a network effect would use mutable current policy.
                raise ObservationConflictError("trace_targets_must_freeze_before_dispatch")
            if record is None:
                record = ExternalAgentTraceRecord(
                    invocation_id=invocation_id,
                    tenant_id=tenant_id,
                    agent_id=invocation.agent_id,
                    state=TraceState.COLLECTING if invocation.tracing_enabled else TraceState.NOT_REQUESTED,
                )
                session.add(record)
            record.targets_frozen = True
            source_app = session.scalar(select(App).where(App.tenant_id == tenant_id, App.id == invocation.app_id))
            source_policy = trace_settings_from_column(source_app.tracing) if source_app else None
            source_content = source_policy.capture_content if source_policy else invocation.app_id is None
            asset_config = session.scalar(
                select(ExternalAgentTracingConfig).where(
                    ExternalAgentTracingConfig.tenant_id == tenant_id,
                    ExternalAgentTracingConfig.agent_id == invocation.agent_id,
                    ExternalAgentTracingConfig.enabled.is_(True),
                )
            )
            if asset_config is not None:
                session.add(
                    ExternalAgentTraceTarget(
                        id=str(uuidv7()),
                        tenant_id=tenant_id,
                        invocation_id=invocation_id,
                        target_kind="asset",
                        target_id=invocation.agent_id,
                        provider=asset_config.provider,
                        config_revision=str(asset_config.revision),
                        encrypted_config=dict(asset_config.encrypted_config),
                        capture_content=source_content and asset_config.capture_content,
                    )
                )
            if (
                source_policy
                and source_policy.enabled
                and source_policy.capture_agent
                and source_policy.tracing_provider
            ):
                app_config = session.scalar(
                    select(TraceAppConfig)
                    .join(App, App.id == TraceAppConfig.app_id)
                    .where(
                        App.tenant_id == tenant_id,
                        TraceAppConfig.app_id == invocation.app_id,
                        TraceAppConfig.tracing_provider == source_policy.tracing_provider,
                        TraceAppConfig.is_active.is_(True),
                    )
                )
                if app_config is not None and app_config.tracing_config is not None:
                    assert invocation.app_id is not None
                    revision = hashlib.sha256(f"{app_config.id}:{app_config.updated_at}".encode()).hexdigest()
                    session.add(
                        ExternalAgentTraceTarget(
                            id=str(uuidv7()),
                            tenant_id=tenant_id,
                            invocation_id=invocation_id,
                            target_kind="app",
                            target_id=invocation.app_id,
                            provider=source_policy.tracing_provider,
                            config_revision=revision,
                            encrypted_config=dict(app_config.tracing_config),
                            capture_content=source_content,
                        )
                    )
            session.flush()
            return self._targets(session, tenant_id, invocation_id)

    def export_source(
        self, *, tenant_id: str, invocation_id: str, now: datetime
    ) -> tuple[InvocationObservationOwner, TraceSnapshot, Sequence[FrozenExternalTraceTarget]]:
        with self._sessions.begin() as session:
            # Trace/usage writers take this same lock. Revision, steps, usage
            # and local terminal facts therefore form one coherent snapshot.
            owner = self._owner_value(
                self._owned(session, tenant_id=tenant_id, invocation_id=invocation_id, now=now, lock=True)
            )
            snapshot = self._snapshot(session, tenant_id=tenant_id, invocation_id=invocation_id)
            return (
                owner,
                snapshot or TraceSnapshot(TraceState.NOT_RETURNED, 0, (), ()),
                self._targets(session, tenant_id, invocation_id),
            )

    def existing_delivery_id(self, *, target: FrozenExternalTraceTarget, payload_revision: int) -> str | None:
        with self._sessions() as session:
            return session.scalar(
                select(DeliveryRow.id).where(
                    DeliveryRow.tenant_id == target.tenant_id,
                    DeliveryRow.invocation_id == target.invocation_id,
                    DeliveryRow.target_kind == target.kind,
                    DeliveryRow.target_id == target.owner_id,
                    DeliveryRow.provider == target.provider,
                    DeliveryRow.config_revision == target.config_revision,
                    DeliveryRow.payload_revision == payload_revision,
                )
            )

    def pending_export_sources(self, *, now: datetime, limit: int) -> Sequence[tuple[str, str]]:
        invocation, record, target = ExternalAgentInvocation, ExternalAgentTraceRecord, ExternalAgentTraceTarget
        delivered = (
            select(DeliveryRow.id)
            .where(
                DeliveryRow.tenant_id == target.tenant_id,
                DeliveryRow.invocation_id == target.invocation_id,
                DeliveryRow.target_kind == target.target_kind,
                DeliveryRow.target_id == target.target_id,
                DeliveryRow.provider == target.provider,
                DeliveryRow.config_revision == target.config_revision,
                DeliveryRow.payload_revision == record.revision,
            )
            .correlate(target, record)
            .exists()
        )
        missing_target = (
            select(target.id)
            .where(
                target.tenant_id == invocation.tenant_id,
                target.invocation_id == invocation.id,
                ~delivered,
            )
            .correlate(invocation, record)
            .exists()
        )
        app_exists = (
            select(App.id)
            .where(App.tenant_id == invocation.tenant_id, App.id == invocation.app_id)
            .correlate(invocation)
            .exists()
        )
        with self._sessions() as session:
            return tuple(
                session.execute(
                    select(invocation.tenant_id, invocation.id)
                    .join(
                        record,
                        sa.and_(
                            record.tenant_id == invocation.tenant_id,
                            record.invocation_id == invocation.id,
                        ),
                    )
                    .where(
                        record.targets_frozen.is_(True),
                        missing_target,
                        invocation.local_state.in_(("succeeded", "failed", "ended", "stopped")),
                        invocation.dispatched_at.is_not(None),
                        invocation.started_at.is_not(None),
                        invocation.ended_at.is_not(None),
                        invocation.ended_at >= invocation.started_at,
                        invocation.deleted_at.is_(None),
                        ~self._tombstone_predicate(),
                        or_(invocation.app_id.is_(None), app_exists),
                        or_(invocation.retention_expires_at.is_(None), invocation.retention_expires_at > _db_time(now)),
                        or_(invocation.test_expires_at.is_(None), invocation.test_expires_at > _db_time(now)),
                    )
                    .order_by(record.updated_at, invocation.ended_at, invocation.id)
                    .limit(limit)
                ).tuples()
            )

    def enqueue_delivery(
        self, *, target: FrozenExternalTraceTarget, payload_revision: int, trace: Trace, now: datetime
    ) -> str:
        key = hashlib.sha256(
            json.dumps(
                [target.invocation_id, target.kind, target.owner_id, target.config_revision, payload_revision]
            ).encode()
        ).hexdigest()
        with self._sessions.begin() as session:
            self._owned(session, tenant_id=target.tenant_id, invocation_id=target.invocation_id, now=now, lock=True)
            admitted = session.scalar(
                select(ExternalAgentTraceTarget.id).where(
                    ExternalAgentTraceTarget.tenant_id == target.tenant_id,
                    ExternalAgentTraceTarget.invocation_id == target.invocation_id,
                    ExternalAgentTraceTarget.target_kind == target.kind,
                    ExternalAgentTraceTarget.target_id == target.owner_id,
                    ExternalAgentTraceTarget.config_revision == target.config_revision,
                )
            )
            if admitted is None:
                raise ObservationConflictError("trace_target_not_frozen")
            existing = session.scalar(
                select(DeliveryRow).where(DeliveryRow.tenant_id == target.tenant_id, DeliveryRow.delivery_key == key)
            )
            payload = trace.model_dump(mode="json")
            if existing is not None:
                if existing.trace_payload != payload:
                    raise ObservationConflictError("trace_payload_revision_conflict")
                return existing.id
            identifier = str(uuidv7())
            session.add(
                DeliveryRow(
                    id=identifier,
                    tenant_id=target.tenant_id,
                    invocation_id=target.invocation_id,
                    delivery_key=key,
                    target_kind=target.kind,
                    target_id=target.owner_id,
                    provider=target.provider,
                    config_revision=target.config_revision,
                    payload_revision=payload_revision,
                    encrypted_config=dict(target.encrypted_config),
                    trace_payload=payload,
                    capture_content=target.capture_content,
                    next_attempt_at=_db_time(now),
                )
            )
            return identifier

    def claim_delivery(self, *, tenant_id: str, delivery_id: str, now: datetime) -> ExternalTraceDelivery | None:
        with self._sessions.begin() as session:
            row = session.scalar(
                select(DeliveryRow).where(DeliveryRow.tenant_id == tenant_id, DeliveryRow.id == delivery_id)
            )
            if row is None:
                return None
            try:
                self._owned(session, tenant_id=tenant_id, invocation_id=row.invocation_id, now=now, lock=True)
            except (ObservationNotFoundError, ObservationExpiredError):
                row.state, row.error_code = "stopped", "source_deleted_or_expired"
                return None
            session.refresh(row, with_for_update=True)
            current = _db_time(now)
            if row.state == "exporting":
                if row.lease_until and row.lease_until <= current:
                    row.state, row.error_code = "uncertain", "export_lease_expired"
                return None
            if row.state not in {"pending", "retrying"} or (row.next_attempt_at and row.next_attempt_at > current):
                return None
            row.state, row.lease_token, row.lease_until = "exporting", str(uuidv7()), current + timedelta(seconds=120)
            row.attempts += 1
            row.updated_at = current
            assert row.lease_token is not None
            return ExternalTraceDelivery(
                row.id,
                row.tenant_id,
                row.invocation_id,
                row.provider,
                dict(row.encrypted_config),
                dict(row.trace_payload),
                row.lease_token,
            )

    def finish_delivery(
        self,
        *,
        delivery: ExternalTraceDelivery,
        state: str,
        error_code: str | None,
        result: SendResult | None,
        now: datetime,
    ) -> None:
        with self._sessions.begin() as session:
            try:
                self._owned(
                    session, tenant_id=delivery.tenant_id, invocation_id=delivery.invocation_id, now=now, lock=True
                )
                live = True
            except (ObservationNotFoundError, ObservationExpiredError):
                live = False
            row = session.scalar(
                select(DeliveryRow)
                .where(DeliveryRow.tenant_id == delivery.tenant_id, DeliveryRow.id == delivery.id)
                .with_for_update()
            )
            if row is not None and row.lease_token == delivery.lease_token and row.state in {"exporting", "uncertain"}:
                row.state, row.error_code = (state, error_code) if live else ("stopped", "source_deleted_or_expired")
                if row.state == "retrying":
                    row.state = "failed" if row.attempts >= 8 else "retrying"
                    row.next_attempt_at = _db_time(now) + timedelta(seconds=min(300, 2**row.attempts))
                if live and result is not None:
                    row.trace_url = result.trace_url
                row.lease_until = None
                if row.state != "uncertain":
                    row.lease_token = None
                row.updated_at = _db_time(now)

    def pending_deliveries(self, *, now: datetime, limit: int) -> Sequence[tuple[str, str]]:
        with self._sessions() as session:
            return tuple(
                session.execute(
                    select(DeliveryRow.tenant_id, DeliveryRow.id)
                    .where(
                        DeliveryRow.state.in_(("pending", "retrying", "exporting")),
                        or_(DeliveryRow.next_attempt_at.is_(None), DeliveryRow.next_attempt_at <= _db_time(now)),
                    )
                    .order_by(DeliveryRow.updated_at)
                    .limit(limit)
                ).tuples()
            )

    def claim_publishable_deliveries(self, *, now: datetime, limit: int) -> Sequence[tuple[str, str]]:
        with self._sessions.begin() as session:
            current = _db_time(now)
            rows = tuple(
                session.scalars(
                    select(DeliveryRow)
                    .where(
                        DeliveryRow.state.in_(("pending", "retrying", "exporting")),
                        or_(DeliveryRow.next_attempt_at.is_(None), DeliveryRow.next_attempt_at <= current),
                        or_(DeliveryRow.lease_until.is_(None), DeliveryRow.lease_until <= current),
                    )
                    .order_by(DeliveryRow.updated_at)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            result: list[tuple[str, str]] = []
            for row in rows:
                if row.state == "exporting":
                    row.state, row.error_code = "uncertain", "export_lease_expired"
                else:
                    # With a pending/retrying state this is only a broker
                    # publication lease. The worker can claim immediately.
                    row.lease_until = current + timedelta(seconds=120)
                    result.append((row.tenant_id, row.id))
            return tuple(result)

    def delivery_statuses(self, *, tenant_id: str, invocation_id: str) -> Sequence[ExternalTraceDeliveryStatus]:
        with self._sessions() as session:
            return tuple(
                ExternalTraceDeliveryStatus(
                    row.id,
                    row.target_kind,
                    row.target_id,
                    row.provider,
                    row.config_revision,
                    row.payload_revision,
                    row.state,
                    row.attempts,
                    row.error_code,
                    row.trace_url,
                )
                for row in session.scalars(
                    select(DeliveryRow)
                    .where(DeliveryRow.tenant_id == tenant_id, DeliveryRow.invocation_id == invocation_id)
                    .order_by(DeliveryRow.created_at, DeliveryRow.id)
                )
            )

    def retry_delivery(
        self,
        *,
        tenant_id: str,
        invocation_id: str,
        delivery_id: str,
        acknowledge_possible_duplicates: bool,
        now: datetime,
    ) -> None:
        with self._sessions.begin() as session:
            self._owned(session, tenant_id=tenant_id, invocation_id=invocation_id, now=now, lock=True)
            row = session.scalar(
                select(DeliveryRow)
                .where(
                    DeliveryRow.tenant_id == tenant_id,
                    DeliveryRow.invocation_id == invocation_id,
                    DeliveryRow.id == delivery_id,
                )
                .with_for_update()
            )
            if row is None:
                raise ObservationNotFoundError("trace_delivery_not_found")
            if row.state not in {"failed", "uncertain"}:
                raise ObservationConflictError("trace_delivery_not_retryable")
            if row.state == "uncertain" and not acknowledge_possible_duplicates:
                raise ObservationConflictError("acknowledge_possible_duplicates_required")
            row.state, row.error_code, row.lease_token, row.lease_until = "pending", None, None, None
            row.next_attempt_at = row.updated_at = _db_time(now)

    @staticmethod
    def _scope_predicate(scope: ExternalDeletionScope) -> sa.ColumnElement[bool]:
        row = ExternalAgentInvocation
        fields = {
            "app": row.app_id,
            "workflow_run": row.workflow_run_id,
            "invocation": row.id,
        }
        if scope.kind == "tenant":
            return row.tenant_id == scope.tenant_id
        if scope.kind in fields:
            return fields[scope.kind] == scope.owner_id
        if scope.kind == "message":
            # row.message_id is an A2A wire ID. Native parent identity is
            # resolved through Message.workflow_run_id before destructive I/O.
            return sa.false()
        if scope.kind == "conversation":
            slots = select(ExternalAgentContextSlot.key).where(
                ExternalAgentContextSlot.tenant_id == scope.tenant_id,
                ExternalAgentContextSlot.conversation_id == scope.owner_id,
            )
            return row.context_slot_key.in_(slots)
        if scope.kind == "context_slot":
            return row.context_slot_key == scope.owner_id
        raise ValueError("invalid_external_deletion_scope")

    @staticmethod
    def _tombstone_predicate() -> sa.ColumnElement[bool]:
        row, tombstone = ExternalAgentInvocation, ExternalAgentDataTombstone
        return (
            select(tombstone.id)
            .where(
                tombstone.tenant_id == row.tenant_id,
                or_(
                    # owner_id also stores context/page hashes. Cast only the
                    # native UUID columns, never this heterogeneous identity.
                    sa.and_(tombstone.owner_kind == "tenant", tombstone.owner_id == sa.cast(row.tenant_id, sa.String)),
                    sa.and_(tombstone.owner_kind == "app", tombstone.owner_id == sa.cast(row.app_id, sa.String)),
                    sa.and_(
                        tombstone.owner_kind == "workflow_run",
                        tombstone.owner_id == sa.cast(row.workflow_run_id, sa.String),
                    ),
                    sa.and_(tombstone.owner_kind == "invocation", tombstone.owner_id == sa.cast(row.id, sa.String)),
                    sa.and_(tombstone.owner_kind == "context_slot", tombstone.owner_id == row.context_slot_key),
                    sa.and_(
                        tombstone.owner_kind == "conversation",
                        row.context_slot_key.in_(
                            select(ExternalAgentContextSlot.key)
                            .where(
                                ExternalAgentContextSlot.tenant_id == row.tenant_id,
                                sa.cast(ExternalAgentContextSlot.conversation_id, sa.String) == tombstone.owner_id,
                            )
                            .correlate(row, tombstone)
                        ),
                    ),
                ),
            )
            .correlate(row)
            .exists()
        )

    @staticmethod
    def _purge_invocations(session: Session, rows: Sequence[ExternalAgentInvocation], now: datetime) -> int:
        for row in rows:
            row.deleted_at = _db_time(now)
            row.request_payload, row.response_payload, row.outputs, row.job_config = {}, None, None, {}
            retained_runtime_keys = {
                "id",
                "scope",
                "identity",
                "agent_id",
                "asset_snapshot",
                "message_id",
                "policy",
                "started_at",
                "logical_deadline",
                "connection_revision_id",
                "remote_task_id",
                "remote_context_id",
                "carried_context_id",
                "remote_state",
                "submission_state",
                "local_state",
                "cancel_state",
                "dispatched_at",
                "ended_at",
                "local_wait_ended_at",
                "wait_deadline",
                "cancellation_deadline",
                "cancel_trigger",
                "tracking_deadline",
                "error_code",
                "sequence",
                "retry_of",
                "background_queries",
                "queries_blocked",
                "observation_error_code",
                "version",
                "test_generation",
                "tracing_enabled",
            }
            row.runtime_snapshot = {
                **{key: value for key, value in row.runtime_snapshot.items() if key in retained_runtime_keys},
                "parts": [],
                "declared_outputs": [],
                "outputs": None,
                "terminal_receipt": None,
                "error_message": None,
                "job": {},
                "deleted": True,
            }
            row.error_message = None
            for model in (ExternalAgentTraceReceipt, StepRow, ExternalAgentTraceUsageSummary, ExternalAgentTraceRecord):
                session.execute(delete(model).where(model.tenant_id == row.tenant_id, model.invocation_id == row.id))
            session.execute(
                update(DeliveryRow)
                .where(DeliveryRow.tenant_id == row.tenant_id, DeliveryRow.invocation_id == row.id)
                .values(state="stopped", error_code="source_deleted_or_expired", trace_payload={}, encrypted_config={})
            )
            session.execute(
                delete(ExternalAgentTraceTarget).where(
                    ExternalAgentTraceTarget.tenant_id == row.tenant_id,
                    ExternalAgentTraceTarget.invocation_id == row.id,
                )
            )
            # Keep the lease until its actual I/O drains/expiry so obsolete
            # connection credentials are not collected while a worker uses them.
            session.execute(
                update(ExternalAgentCommand)
                .where(ExternalAgentCommand.tenant_id == row.tenant_id, ExternalAgentCommand.invocation_id == row.id)
                .values(state="stopped")
            )
            session.execute(
                update(ExternalAgentFileLease)
                .where(
                    ExternalAgentFileLease.tenant_id == row.tenant_id,
                    ExternalAgentFileLease.invocation_id == row.id,
                    ExternalAgentFileLease.released_at.is_(None),
                )
                .values(released_at=_db_time(now))
            )
        return len(rows)

    def expire_records(self, *, now: datetime, limit: int) -> int:
        with self._sessions.begin() as session:
            rows = tuple(
                session.scalars(
                    select(ExternalAgentInvocation)
                    .where(
                        ExternalAgentInvocation.deleted_at.is_(None),
                        or_(
                            ExternalAgentInvocation.retention_expires_at <= _db_time(now),
                            ExternalAgentInvocation.test_expires_at <= _db_time(now),
                            self._tombstone_predicate(),
                        ),
                    )
                    .order_by(ExternalAgentInvocation.created_at)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            return self._purge_invocations(session, rows, now)

    def delete_scope(self, *, scope: ExternalDeletionScope, now: datetime) -> int:
        with self._sessions.begin() as session:
            if scope.kind == "tenant":
                # Control-plane writes acquire the same tenant lock before
                # their tombstone check. No new head/proof can cross this fence.
                session.scalar(select(Tenant.id).where(Tenant.id == scope.tenant_id).with_for_update())
            source_runs = (
                tuple(
                    run_id
                    for run_id in session.scalars(
                        select(Message.workflow_run_id)
                        .join(App, App.id == Message.app_id)
                        .where(
                            App.tenant_id == scope.tenant_id,
                            Message.id == scope.owner_id,
                            Message.workflow_run_id.is_not(None),
                        )
                    )
                    if run_id is not None
                )
                if scope.kind == "message"
                else ()
            )
            # Duplicate lifecycle events are safe. The unique constraint also
            # protects two workers observing the same deletion concurrently.
            existing = session.scalar(
                select(ExternalAgentDataTombstone.id).where(
                    ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                    ExternalAgentDataTombstone.owner_kind == scope.kind,
                    ExternalAgentDataTombstone.owner_id == scope.owner_id,
                )
            )
            if existing is None:
                try:
                    with session.begin_nested():
                        session.add(
                            ExternalAgentDataTombstone(
                                id=str(uuidv7()),
                                tenant_id=scope.tenant_id,
                                owner_kind=scope.kind,
                                owner_id=scope.owner_id,
                                deleted_at=_db_time(now),
                            )
                        )
                        session.flush()
                except IntegrityError:
                    # The competing lifecycle delivery inserted the same unique
                    # tombstone; the scoped cleanup below is still idempotent.
                    existing = session.scalar(
                        select(ExternalAgentDataTombstone.id).where(
                            ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                            ExternalAgentDataTombstone.owner_kind == scope.kind,
                            ExternalAgentDataTombstone.owner_id == scope.owner_id,
                        )
                    )
                    if existing is None:
                        raise
            for source_run in source_runs:
                prior = session.scalar(
                    select(ExternalAgentDataTombstone.id).where(
                        ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                        ExternalAgentDataTombstone.owner_kind == "workflow_run",
                        ExternalAgentDataTombstone.owner_id == source_run,
                    )
                )
                if prior is None:
                    session.add(
                        ExternalAgentDataTombstone(
                            id=str(uuidv7()),
                            tenant_id=scope.tenant_id,
                            owner_kind="workflow_run",
                            owner_id=source_run,
                            deleted_at=_db_time(now),
                        )
                    )
            predicate = (
                ExternalAgentInvocation.workflow_run_id.in_(source_runs)
                if scope.kind == "message"
                else (self._scope_predicate(scope))
            )
            rows = tuple(
                session.scalars(
                    select(ExternalAgentInvocation)
                    .where(
                        ExternalAgentInvocation.tenant_id == scope.tenant_id,
                        ExternalAgentInvocation.deleted_at.is_(None),
                        predicate,
                    )
                    .order_by(ExternalAgentInvocation.id)
                    .limit(100)
                    .with_for_update()
                )
            )
            purged = self._purge_invocations(session, rows, now)
            # Run/message/log expiry deliberately does NOT delete reservations.
            slot_condition = None
            if scope.kind == "tenant":
                slot_condition = ExternalAgentContextSlot.tenant_id == scope.tenant_id
            elif scope.kind == "app":
                slot_condition = ExternalAgentContextSlot.app_id == scope.owner_id
            elif scope.kind == "conversation":
                slot_condition = ExternalAgentContextSlot.conversation_id == scope.owner_id
            elif scope.kind == "context_slot":
                slot_condition = ExternalAgentContextSlot.key == scope.owner_id
            if slot_condition is not None:
                session.execute(
                    update(ExternalAgentContextSlot)
                    .where(ExternalAgentContextSlot.tenant_id == scope.tenant_id, slot_condition)
                    .values(
                        deleted_at=_db_time(now), server_context_id=None, reserved_invocation_id=None, unresolved=False
                    )
                )
            if scope.kind == "tenant":
                session.execute(
                    update(ExternalAgentHead)
                    .where(
                        ExternalAgentHead.tenant_id == scope.tenant_id,
                        or_(
                            ExternalAgentHead.deleted_at.is_(None),
                            ExternalAgentHead.enabled.is_(True),
                            ExternalAgentHead.tracing_enabled.is_(True),
                        ),
                    )
                    .values(
                        enabled=False,
                        tracing_enabled=False,
                        deleted_at=func.coalesce(ExternalAgentHead.deleted_at, _db_time(now)),
                        updated_at=_db_time(now),
                        row_version=ExternalAgentHead.row_version + 1,
                    )
                )
                session.execute(
                    delete(ExternalAgentVerification).where(ExternalAgentVerification.tenant_id == scope.tenant_id)
                )
                session.execute(
                    delete(ExternalAgentOperation).where(ExternalAgentOperation.tenant_id == scope.tenant_id)
                )
                session.execute(
                    update(ExternalAgentFileLease)
                    .where(
                        ExternalAgentFileLease.tenant_id == scope.tenant_id,
                        ExternalAgentFileLease.released_at.is_(None),
                    )
                    .values(released_at=_db_time(now))
                )
                session.execute(
                    delete(ExternalAgentTracingConfig).where(ExternalAgentTracingConfig.tenant_id == scope.tenant_id)
                )
            budget_condition = {
                "tenant": ExternalWorkflowBudget.tenant_id == scope.tenant_id,
                "app": ExternalWorkflowBudget.app_id == scope.owner_id,
                "workflow_run": ExternalWorkflowBudget.workflow_run_id == scope.owner_id,
            }.get(scope.kind)
            if budget_condition is not None:
                session.execute(
                    delete(ExternalWorkflowBudget).where(
                        ExternalWorkflowBudget.tenant_id == scope.tenant_id, budget_condition
                    )
                )
            return purged

    def leave_test_page(self, *, tenant_id: str, actor_id: str, page_session_id: str, now: datetime) -> int:
        page_key = hashlib.sha256(f"{actor_id}:{page_session_id}".encode()).hexdigest()
        with self._sessions.begin() as session:
            exists = session.scalar(
                select(ExternalAgentDataTombstone.id).where(
                    ExternalAgentDataTombstone.tenant_id == tenant_id,
                    ExternalAgentDataTombstone.owner_kind == "test_page",
                    ExternalAgentDataTombstone.owner_id == page_key,
                )
            )
            if exists is None:
                session.add(
                    ExternalAgentDataTombstone(
                        id=str(uuidv7()),
                        tenant_id=tenant_id,
                        owner_kind="test_page",
                        owner_id=page_key,
                        deleted_at=_db_time(now),
                    )
                )
            rows = tuple(
                session.scalars(
                    select(ExternalAgentFileLease)
                    .where(
                        ExternalAgentFileLease.tenant_id == tenant_id,
                        ExternalAgentFileLease.owner_id == actor_id,
                        ExternalAgentFileLease.page_session_id == page_session_id,
                        ExternalAgentFileLease.released_at.is_(None),
                    )
                    .with_for_update()
                )
            )
            revoked = [row for row in rows if row.invocation_id is None or "output" in row.purpose]
            for row in revoked:
                row.released_at = _db_time(now)
            return len(revoked)

    @staticmethod
    def _remote_ended(row: ExternalAgentInvocation) -> bool:
        state = (row.remote_state or "").lower().removeprefix("task_state_")
        return state in {"completed", "failed", "canceled", "cancelled", "rejected"} or (
            row.remote_task_id is None and row.local_state == "succeeded"
        )

    def file_cleanup_candidates(self, *, now: datetime, limit: int) -> tuple[TestFileCleanup, ...]:
        with self._sessions.begin() as session:
            lease, invocation_row = ExternalAgentFileLease, ExternalAgentInvocation
            # Confirmed cancellation can precede the delayed retry handoff.
            # create_retry clones active inputs before marking the old call
            # ended in the same transaction. Hard TTL/parent fences still win.
            terminal_input = sa.and_(
                invocation_row.origin != "production",
                invocation_row.local_state != "retry_pending",
                lease.purpose.contains("input"),
                or_(
                    invocation_row.remote_state.in_(("completed", "failed", "canceled", "cancelled", "rejected")),
                    sa.and_(invocation_row.remote_task_id.is_(None), invocation_row.local_state == "succeeded"),
                ),
            )
            leases = tuple(
                session.scalars(
                    select(lease)
                    .outerjoin(
                        invocation_row,
                        sa.and_(invocation_row.tenant_id == lease.tenant_id, invocation_row.id == lease.invocation_id),
                    )
                    .where(
                        or_(lease.cleanup_after.is_(None), lease.cleanup_after <= _db_time(now)),
                        or_(
                            lease.released_at.is_not(None),
                            lease.expires_at <= _db_time(now),
                            sa.and_(
                                lease.invocation_id.is_(None), lease.created_at <= _db_time(now) - timedelta(hours=1)
                            ),
                            sa.and_(
                                invocation_row.origin != "production",
                                lease.created_at <= _db_time(now) - timedelta(hours=24),
                            ),
                            invocation_row.retention_expires_at <= _db_time(now),
                            invocation_row.test_expires_at <= _db_time(now),
                            terminal_input,
                        ),
                    )
                    .order_by(lease.cleanup_after.is_not(None), lease.cleanup_after, lease.expires_at)
                    .limit(limit)
                    .with_for_update(of=lease, skip_locked=True)
                )
            )
            result: list[TestFileCleanup] = []
            for lease in leases:
                invocation = (
                    session.scalar(
                        select(ExternalAgentInvocation).where(
                            ExternalAgentInvocation.tenant_id == lease.tenant_id,
                            ExternalAgentInvocation.id == lease.invocation_id,
                        )
                    )
                    if lease.invocation_id
                    else None
                )
                deadline = lease.expires_at
                if invocation is None:
                    deadline = min(deadline, lease.created_at + timedelta(hours=1))
                elif invocation.origin != "production":
                    deadline = min(deadline, lease.created_at + timedelta(hours=24))
                if invocation and invocation.retention_expires_at:
                    deadline = min(deadline, invocation.retention_expires_at)
                if invocation and invocation.test_expires_at:
                    deadline = min(deadline, invocation.test_expires_at)
                ended_input = (
                    invocation is not None
                    and invocation.origin != "production"
                    and invocation.local_state != "retry_pending"
                    and "input" in lease.purpose
                    and self._remote_ended(invocation)
                )
                if lease.released_at is not None or deadline <= _db_time(now) or ended_input:
                    lease.released_at = lease.released_at or _db_time(now)
                    lease.cleanup_after = _db_time(now) + timedelta(seconds=60)
                    shared = session.scalar(
                        select(ExternalAgentFileLease.id)
                        .where(
                            ExternalAgentFileLease.tenant_id == lease.tenant_id,
                            ExternalAgentFileLease.file_id == lease.file_id,
                            ExternalAgentFileLease.id != lease.id,
                            ExternalAgentFileLease.released_at.is_(None),
                            ExternalAgentFileLease.expires_at > _db_time(now),
                        )
                        .limit(1)
                    )
                    result.append(
                        TestFileCleanup(
                            lease.id,
                            lease.tenant_id,
                            lease.file_id,
                            lease.temporary_copy and shared is None,
                            lease.storage_key,
                        )
                    )
            return tuple(result)

    def complete_file_cleanup(self, candidate: TestFileCleanup) -> bool:
        with self._sessions.begin() as session:
            pending = session.scalar(
                select(ExternalAgentFileLease)
                .where(
                    ExternalAgentFileLease.tenant_id == candidate.tenant_id,
                    ExternalAgentFileLease.id == candidate.lease_id,
                )
                .with_for_update()
            )
            if pending is not None and pending.write_state == "planned":
                # Unknown I/O may still finish after cleanup. Retain this revoked
                # exact-key intent so every late object is eventually collected.
                pending.file_value = None
                return False
            if pending is not None and (pending.temporary_copy or pending.purpose == "output"):
                stored_file = session.scalar(
                    select(UploadFile.id).where(
                        UploadFile.tenant_id == pending.tenant_id, UploadFile.id == pending.file_id
                    )
                )
                shared_reference = session.scalar(
                    select(ExternalAgentFileLease.id)
                    .where(
                        ExternalAgentFileLease.tenant_id == pending.tenant_id,
                        ExternalAgentFileLease.file_id == pending.file_id,
                        ExternalAgentFileLease.id != pending.id,
                        ExternalAgentFileLease.released_at.is_(None),
                    )
                    .limit(1)
                )
                if stored_file is not None or shared_reference is not None:
                    # Shared inputs can postpone physical deletion. Keep their
                    # revoked producer/source marker until bytes and references
                    # are gone, so an input_grant cannot launder a test origin.
                    # Candidate admission already set cleanup_after for retry.
                    pending.file_value = None
                    return False
            session.execute(
                delete(ExternalAgentFileLease).where(
                    ExternalAgentFileLease.tenant_id == candidate.tenant_id,
                    ExternalAgentFileLease.id == candidate.lease_id,
                    ExternalAgentFileLease.file_id == candidate.file_id,
                    ExternalAgentFileLease.released_at.is_not(None),
                )
            )
            return True

    def stop_expired_tracking(self, *, now: datetime, limit: int) -> int:
        with self._sessions.begin() as session:
            pending_command = (
                select(ExternalAgentCommand.id)
                .where(
                    ExternalAgentCommand.tenant_id == ExternalAgentInvocation.tenant_id,
                    ExternalAgentCommand.invocation_id == ExternalAgentInvocation.id,
                    ExternalAgentCommand.kind.in_(("poll", "get_task", "background_poll", "background_query")),
                    ExternalAgentCommand.state == "ready",
                )
                .correlate(ExternalAgentInvocation)
                .exists()
            )
            rows = tuple(
                session.scalars(
                    select(ExternalAgentInvocation)
                    .where(
                        pending_command,
                        ExternalAgentInvocation.local_wait_ended_at.is_not(None),
                        or_(
                            ExternalAgentInvocation.tracking_deadline <= _db_time(now),
                            ExternalAgentInvocation.local_wait_ended_at <= _db_time(now) - timedelta(hours=24),
                            ExternalAgentInvocation.background_queries >= 300,
                        ),
                    )
                    .order_by(ExternalAgentInvocation.local_wait_ended_at)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            stopped = 0
            for row in rows:
                result = session.execute(
                    update(ExternalAgentCommand)
                    .where(
                        ExternalAgentCommand.tenant_id == row.tenant_id,
                        ExternalAgentCommand.invocation_id == row.id,
                        ExternalAgentCommand.kind.in_(("poll", "get_task", "background_poll", "background_query")),
                        ExternalAgentCommand.state == "ready",
                    )
                    .values(state="stopped")
                )
                if not isinstance(result, CursorResult):
                    raise ObservationConflictError("background_query_update_unconfirmed")
                stopped += result.rowcount or 0
            return stopped

    def reclaim_credentials(self, *, now: datetime, limit: int) -> int:
        with self._sessions.begin() as session:
            proofs = tuple(
                session.scalars(
                    select(ExternalAgentVerification)
                    .where(
                        or_(
                            ExternalAgentVerification.expires_at <= _db_time(now),
                            ExternalAgentVerification.consumed_at.is_not(None),
                        )
                    )
                    .order_by(ExternalAgentVerification.expires_at)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            proof_credentials = sum(row.credential_ciphertext is not None for row in proofs)
            for proof in proofs:
                session.delete(proof)
            active = (
                select(ExternalAgentHead.active_connection_revision_id)
                .where(
                    ExternalAgentHead.tenant_id == ExternalAgentConnectionRevision.tenant_id,
                    ExternalAgentHead.agent_id == ExternalAgentConnectionRevision.agent_id,
                    ExternalAgentHead.deleted_at.is_(None),
                    ExternalAgentHead.active_connection_revision_id.is_not(None),
                )
                .correlate(ExternalAgentConnectionRevision)
            )
            invocation = ExternalAgentInvocation
            revision_model = ExternalAgentConnectionRevision
            reference = sa.and_(
                invocation.tenant_id == revision_model.tenant_id,
                invocation.connection_revision_id == revision_model.id,
            )
            terminal = func.coalesce(
                or_(
                    func.lower(invocation.remote_state).in_(
                        (
                            "completed",
                            "failed",
                            "canceled",
                            "cancelled",
                            "rejected",
                            "task_state_completed",
                            "task_state_failed",
                            "task_state_canceled",
                            "task_state_rejected",
                        )
                    ),
                    sa.and_(invocation.remote_task_id.is_(None), invocation.local_state == "succeeded"),
                    invocation.dispatched_at.is_(None),
                ),
                False,
            )
            bounded = func.coalesce(
                or_(
                    invocation.tracking_deadline <= _db_time(now),
                    invocation.local_wait_ended_at <= _db_time(now) - timedelta(hours=24),
                ),
                False,
            )
            blocking_reference = (
                select(invocation.id)
                .where(reference, invocation.deleted_at.is_(None), ~self._tombstone_predicate(), ~terminal, ~bounded)
                .correlate(revision_model)
                .exists()
            )
            active_io = (
                select(ExternalAgentCommand.id)
                .join(
                    invocation,
                    sa.and_(
                        invocation.tenant_id == ExternalAgentCommand.tenant_id,
                        invocation.id == ExternalAgentCommand.invocation_id,
                    ),
                )
                .where(
                    reference,
                    ExternalAgentCommand.lease_token.is_not(None),
                    ExternalAgentCommand.lease_until > _db_time(now),
                )
                .correlate(revision_model)
                .exists()
            )
            active_file_write = (
                select(ExternalAgentFileLease.id)
                .join(
                    invocation,
                    sa.and_(
                        invocation.tenant_id == ExternalAgentFileLease.tenant_id,
                        invocation.id == ExternalAgentFileLease.invocation_id,
                    ),
                )
                .where(
                    reference,
                    ExternalAgentFileLease.write_state == "planned",
                    ExternalAgentFileLease.write_lease_until > _db_time(now),
                )
                .correlate(revision_model)
                .exists()
            )
            revisions = tuple(
                session.scalars(
                    select(ExternalAgentConnectionRevision)
                    .where(
                        ExternalAgentConnectionRevision.credential_ciphertext.is_not(None),
                        ExternalAgentConnectionRevision.id.not_in(active),
                        ~blocking_reference,
                        ~active_io,
                        ~active_file_write,
                    )
                    .order_by(ExternalAgentConnectionRevision.created_at)
                    .limit(limit)
                    .with_for_update(skip_locked=True)
                )
            )
            cleared = proof_credentials
            for revision in revisions:
                # The runtime takes this revision lock before admitting an I/O
                # lease. Recheck with a current write predicate after locking:
                # the initial candidate query may have preceded its commit.
                result = session.execute(
                    update(revision_model)
                    .where(
                        revision_model.tenant_id == revision.tenant_id,
                        revision_model.id == revision.id,
                        revision_model.id.not_in(active),
                        ~blocking_reference,
                        ~active_io,
                        ~active_file_write,
                    )
                    .values(credential_ciphertext=None, secret_cleared_at=_db_time(now))
                    .execution_options(synchronize_session=False)
                )
                if not isinstance(result, CursorResult):
                    raise ObservationConflictError("credential_reclamation_unconfirmed")
                cleared += result.rowcount or 0
            return cleared


class ConnectionTraceSecretReader:
    def __init__(self, *, sessions: sessionmaker[Session], codec: ExternalSecretCodec) -> None:
        self._sessions, self._codec = sessions, codec

    def values(self, *, tenant_id: str, connection_revision_id: str) -> Sequence[str]:
        with self._sessions() as session:
            ciphertext = session.scalar(
                select(ExternalAgentConnectionRevision.credential_ciphertext).where(
                    ExternalAgentConnectionRevision.tenant_id == tenant_id,
                    ExternalAgentConnectionRevision.id == connection_revision_id,
                )
            )
        return (self._codec.decrypt(tenant_id, ciphertext),) if ciphertext else ()


class ExistingProviderTraceSender:
    def __init__(self, *, providers: TraceProviderCatalog, codec: ProviderConfigCodec, egress: Egress) -> None:
        self._providers, self._codec, self._egress = providers, codec, egress

    def send(
        self, *, tenant_id: str, provider: str, encrypted_config: Mapping[str, Any], trace_payload: Mapping[str, Any]
    ) -> SendResult:
        try:
            implementation = self._providers.resolve(provider)
            config = self._codec.decode(tenant_id, implementation, encrypted_config)
            trace = Trace.model_validate(trace_payload)
        except (
            ProviderConfigUnreadableError,
            TraceProviderUnavailableError,
            UnknownTraceProviderError,
            ValidationError,
        ):
            raise TraceExportPreflightError from None
        return implementation(self._egress).send(config, trace)


class FileObjectStorage(Protocol):
    def delete(self, filename: str) -> None: ...

    def exists(self, filename: str) -> bool: ...


class DatabaseTemporaryTestFileRemover:
    def __init__(self, *, sessions: sessionmaker[Session], storage: FileObjectStorage) -> None:
        self._sessions, self._storage = sessions, storage

    def remove(self, *, tenant_id: str, file_id: str, storage_key: str | None) -> None:
        with self._sessions() as session:
            row = session.scalar(select(UploadFile).where(UploadFile.tenant_id == tenant_id, UploadFile.id == file_id))
            active = session.scalar(
                select(ExternalAgentFileLease.id)
                .where(
                    ExternalAgentFileLease.tenant_id == tenant_id,
                    ExternalAgentFileLease.file_id == file_id,
                    ExternalAgentFileLease.released_at.is_(None),
                )
                .limit(1)
            )
            key = row.key if row else storage_key
            if row is not None and storage_key is not None and row.key != storage_key:
                raise ObservationConflictError("temporary_file_storage_key_changed")
        if key is not None and active is None:
            if not key.startswith(f"upload_files/{tenant_id}/{file_id}."):
                raise ObservationAccessDeniedError("temporary_file_storage_key_not_owned")
            try:
                self._storage.delete(key)
            except Exception:
                if self._storage.exists(key):
                    raise
            with self._sessions.begin() as session:
                session.execute(
                    delete(UploadFile).where(
                        UploadFile.tenant_id == tenant_id, UploadFile.id == file_id, UploadFile.key == key
                    )
                )

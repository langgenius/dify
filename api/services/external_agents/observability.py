"""Owned external-agent observations and dispatch-based monitoring use cases.

The Invocation is the business owner. Tracing, usage and delivery are separate
facts: observations cannot change business outcomes, create tasks or release a
context. Application services use plain values and consumer-owned ports only.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field

from machinery.context import RequestContext
from services.external_agents.traceability import (
    ExternalTraceStep,
    NormalizedExternalTrace,
    ReportedCallUsage,
    TraceabilityNormalizer,
    TraceState,
)


class ExternalObservabilityError(Exception):
    """Safe application failure; transport owns HTTP status and serialization."""


class ObservationNotFoundError(ExternalObservabilityError):
    pass


class ObservationAccessDeniedError(ExternalObservabilityError):
    pass


class ObservationConflictError(ExternalObservabilityError):
    pass


class ObservationExpiredError(ExternalObservabilityError):
    pass


@dataclass(frozen=True, slots=True)
class InvocationObservationOwner:
    tenant_id: str
    id: str
    agent_id: str
    app_id: str | None
    workflow_run_id: str | None
    node_execution_id: str | None
    message_id: str | None
    origin: str
    initiator_id: str | None
    connection_revision_id: str
    tracing_enabled: bool
    started_at: datetime | None
    dispatched_at: datetime | None
    ended_at: datetime | None
    local_wait_ended_at: datetime | None
    retention_expires_at: datetime | None
    test_expires_at: datetime | None
    deleted_at: datetime | None
    local_state: str
    remote_state: str | None


@dataclass(frozen=True, slots=True)
class MonitoringScope:
    """Trusted policy result; ``app_ids=None`` admits every production App."""

    normal_aggregate: bool
    app_ids: frozenset[str] | None
    timezone: str = "UTC"


@dataclass(frozen=True, slots=True)
class InvocationMetric:
    id: str
    app_id: str | None
    origin: str
    dispatched_at: datetime | None
    started_at: datetime | None
    ended_at: datetime | None
    call_total_tokens: int | None


@dataclass(frozen=True, slots=True)
class MetricValues:
    calls: int
    average_call_duration: float | None
    reported_tokens: int | None
    token_reporting_numerator: int
    token_reporting_denominator: int
    token_reporting_coverage: float | None


@dataclass(frozen=True, slots=True)
class MonitoringDay:
    date: date
    metrics: MetricValues


@dataclass(frozen=True, slots=True)
class MetricBucket:
    date: date
    calls: int
    duration_sum: float
    duration_count: int
    tokens_sum: int
    known_usage_calls: int


@dataclass(frozen=True, slots=True)
class MonitoringResult:
    summary: MetricValues
    days: tuple[MonitoringDay, ...]
    apps: tuple[Mapping[str, str], ...] | None


class MonitoringQuery(BaseModel):
    start: datetime
    end: datetime
    timezone: str | None = None
    app_id: str | None = None

    model_config = ConfigDict(extra="forbid")


class TraceQuery(BaseModel):
    offset: int = Field(default=0, ge=0, le=100000)
    limit: int = Field(default=50, ge=1, le=100)
    revision: int | None = Field(default=None, ge=0)

    model_config = ConfigDict(extra="forbid")


@dataclass(frozen=True, slots=True)
class TraceSnapshot:
    state: TraceState
    revision: int
    steps: tuple[ExternalTraceStep, ...]
    diagnostics: tuple[str, ...]
    call_total_tokens: int | None = None
    usage_revision: int = 0


@dataclass(frozen=True, slots=True)
class TracePage:
    invocation_id: str
    state: TraceState
    revision: int
    received_steps: int
    steps: tuple[ExternalTraceStep, ...]
    next_offset: int | None
    diagnostics: tuple[str, ...]


class ExternalObservationAccess(Protocol):
    def trace_read(self, context: RequestContext, owner: InvocationObservationOwner) -> None:
        """Deny when current membership/run or test-owner permission is absent."""
        ...

    def monitor(self, context: RequestContext, agent_id: str) -> MonitoringScope:
        """Return live membership and App-monitor scope, never client-provided scope."""
        ...

    def manage(self, context: RequestContext, agent_id: str) -> None:
        """Require current workspace Owner/Admin and owned external asset."""
        ...


class ExternalObservationStore(Protocol):
    def owner(self, *, tenant_id: str, invocation_id: str, now: datetime) -> InvocationObservationOwner:
        """Return the complete live owner chain or raise not-found/expired."""
        ...

    def record(
        self, *, owner: InvocationObservationOwner, trace: NormalizedExternalTrace, now: datetime
    ) -> TraceSnapshot:
        """Atomically recheck owner/fences, dedupe receipts and CAS-enrich steps.

        A transaction-scoped Invocation row lock serializes ingestion with parent
        deletion. Same identity conflicting values never overwrite stored values.
        The repository commits before returning and never changes business fields.
        """
        ...

    def snapshot(self, *, tenant_id: str, invocation_id: str) -> TraceSnapshot | None: ...

    def record_usage(
        self, *, owner: InvocationObservationOwner, usage: ReportedCallUsage, revision: int, now: datetime
    ) -> None:
        """CAS one proven call total; duplicates do not add tokens or Calls."""
        ...

    def metrics(
        self, *, tenant_id: str, agent_id: str, scope: MonitoringScope, query: MonitoringQuery, now: datetime
    ) -> Sequence[InvocationMetric]:
        """Read one row per live retained production dispatch under the exact App scope."""
        ...

    def metric_buckets(
        self, *, tenant_id: str, agent_id: str, scope: MonitoringScope, query: MonitoringQuery, now: datetime
    ) -> Sequence[MetricBucket]:
        """Aggregate the exact cohort in one DB query; bounded by local-date buckets."""
        ...

    def apps(self, *, tenant_id: str, agent_id: str, scope: MonitoringScope) -> Sequence[Mapping[str, str]]:
        """Return authorized associated Apps even when the selected period has no calls."""
        ...


class TraceSecretReader(Protocol):
    def values(self, *, tenant_id: str, connection_revision_id: str) -> Sequence[str]:
        """Read transient known connection secrets for redaction, never persistence/logging."""
        ...


def aware_utc(value: datetime) -> datetime:
    """Interpret persisted naive timestamps as UTC, never the worker's timezone."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def aggregate_metrics(rows: Sequence[InvocationMetric]) -> MetricValues:
    """Aggregate dispatch facts without zero-filling missing usage or durations.

    Preconditions: repository applied production, date, retention and permission
    scope. Postconditions: each dispatched Invocation counts once; known zero
    usage increases coverage; active/invalid times do not enter the duration mean.
    """
    dispatched = {row.id: row for row in rows if row.origin == "production" and row.dispatched_at is not None}
    durations = [
        (aware_utc(row.ended_at) - aware_utc(row.started_at)).total_seconds()
        for row in dispatched.values()
        if row.started_at is not None
        and row.ended_at is not None
        and aware_utc(row.ended_at) >= aware_utc(row.started_at)
    ]
    tokens = [
        row.call_total_tokens
        for row in dispatched.values()
        if type(row.call_total_tokens) is int and row.call_total_tokens >= 0
    ]
    calls, known = len(dispatched), len(tokens)
    return MetricValues(
        calls=calls,
        average_call_duration=sum(durations) / len(durations) if durations else None,
        reported_tokens=sum(tokens) if known else None,
        token_reporting_numerator=known,
        token_reporting_denominator=calls,
        token_reporting_coverage=known / calls if calls else None,
    )


def aggregate_buckets(rows: Sequence[MetricBucket]) -> MetricValues:
    """Combine additive facts, never averages of daily means or coverage percentages."""
    calls = sum(row.calls for row in rows)
    durations = sum(row.duration_count for row in rows)
    known = sum(row.known_usage_calls for row in rows)
    return MetricValues(
        calls,
        sum(row.duration_sum for row in rows) / durations if durations else None,
        sum(row.tokens_sum for row in rows) if known else None,
        known,
        calls,
        known / calls if calls else None,
    )


class ExternalObservabilityService:
    def __init__(
        self,
        *,
        store: ExternalObservationStore,
        access: ExternalObservationAccess,
        normalizer: TraceabilityNormalizer,
        secrets: TraceSecretReader,
    ) -> None:
        self._store, self._access, self._normalizer, self._secrets = store, access, normalizer, secrets

    def record_trace(
        self, *, tenant_id: str, invocation_id: str, payload: object, source_id: str, received_at: datetime
    ) -> TraceSnapshot:
        """Record one runtime-associated carrier without changing business execution.

        The store revalidates the owner at commit; normalization never trusts
        remote tenant/App IDs. Known secret material exists only for redaction.
        """
        owner = self._store.owner(tenant_id=tenant_id, invocation_id=invocation_id, now=received_at)
        if not owner.tracing_enabled:
            return TraceSnapshot(TraceState.NOT_REQUESTED, 0, (), ())
        secret_values = self._secrets.values(tenant_id=tenant_id, connection_revision_id=owner.connection_revision_id)
        normalized = self._normalizer.normalize(payload, source_id=source_id, secrets=secret_values)
        return self._store.record(owner=owner, trace=normalized, now=received_at)

    def record_usage(
        self, *, tenant_id: str, invocation_id: str, usage: ReportedCallUsage, revision: int, received_at: datetime
    ) -> None:
        """Persist an adapter-proven call total; this is not a public client mutation."""
        owner = self._store.owner(tenant_id=tenant_id, invocation_id=invocation_id, now=received_at)
        self._store.record_usage(owner=owner, usage=usage, revision=revision, now=received_at)

    def trace(self, context: RequestContext, invocation_id: str, query: TraceQuery, *, now: datetime) -> TracePage:
        """Read a retained Invocation under its live run/test permissions.

        A revision-pinned page fails on concurrent enrichment instead of silently
        mixing generations. Current asset switches never hide collected history.
        """
        owner = self._store.owner(tenant_id=context.active_workspace_id, invocation_id=invocation_id, now=now)
        self._access.trace_read(context, owner)
        snapshot = self._store.snapshot(tenant_id=owner.tenant_id, invocation_id=owner.id)
        if snapshot is None:
            state = (
                TraceState.NOT_REQUESTED
                if not owner.tracing_enabled
                else (TraceState.NOT_RETURNED if owner.ended_at else TraceState.COLLECTING)
            )
            snapshot = TraceSnapshot(state, 0, (), ())
        elif snapshot.state == TraceState.COLLECTING and owner.ended_at is not None:
            snapshot = TraceSnapshot(TraceState.NOT_RETURNED, snapshot.revision, snapshot.steps, snapshot.diagnostics)
        if query.revision is not None and query.revision != snapshot.revision:
            raise ObservationConflictError("trace_revision_changed")
        page = snapshot.steps[query.offset : query.offset + query.limit]
        following = query.offset + len(page)
        return TracePage(
            owner.id,
            snapshot.state,
            snapshot.revision,
            len(snapshot.steps),
            page,
            following if following < len(snapshot.steps) else None,
            snapshot.diagnostics,
        )

    def raw_data(
        self, context: RequestContext, invocation_id: str, step_key: str, *, now: datetime
    ) -> Mapping[str, Any]:
        """Read only the selected redacted step through the same record authorization."""
        owner = self._store.owner(tenant_id=context.active_workspace_id, invocation_id=invocation_id, now=now)
        self._access.trace_read(context, owner)
        snapshot = self._store.snapshot(tenant_id=owner.tenant_id, invocation_id=owner.id)
        step = next((item for item in snapshot.steps if item.key == step_key), None) if snapshot else None
        if step is None:
            raise ObservationNotFoundError("trace_step_not_found")
        return step.raw_data

    def monitoring(
        self, context: RequestContext, agent_id: str, query: MonitoringQuery, *, now: datetime
    ) -> MonitoringResult:
        """Return four metrics and gap-filled dates over one trusted App scope.

        Normal requests cannot select or enumerate Apps. No current binding join
        may reassign historical Invocations. Date windows are inclusive/exclusive.
        """
        scope = self._access.monitor(context, agent_id)
        start, end = aware_utc(query.start), aware_utc(query.end)
        if end <= start or (end - start) > timedelta(days=366):
            raise ValueError("invalid_monitoring_window")
        try:
            zone = ZoneInfo(query.timezone if query.timezone is not None else scope.timezone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("invalid_monitoring_timezone") from error
        if query.app_id is not None and (
            scope.normal_aggregate or (scope.app_ids is not None and query.app_id not in scope.app_ids)
        ):
            raise ObservationAccessDeniedError("app_filter_not_allowed")
        query = query.model_copy(update={"timezone": zone.key})
        rows = self._store.metric_buckets(
            tenant_id=context.active_workspace_id, agent_id=agent_id, scope=scope, query=query, now=now
        )
        first, last = start.astimezone(zone).date(), (end - timedelta(microseconds=1)).astimezone(zone).date()
        dates = [first + timedelta(days=index) for index in range((last - first).days + 1)]
        days = tuple(MonitoringDay(day, aggregate_buckets([row for row in rows if row.date == day])) for day in dates)
        apps = (
            None
            if scope.normal_aggregate
            else tuple(self._store.apps(tenant_id=context.active_workspace_id, agent_id=agent_id, scope=scope))
        )
        return MonitoringResult(aggregate_buckets(rows), days, apps)

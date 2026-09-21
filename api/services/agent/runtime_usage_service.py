"""Forward-only, provider-authoritative sandbox accounting.

The activation event is also a project-scoped transaction lock. This keeps
deduplication, checkpoints, and execution projection atomic
across API workers without coupling billing records to business transactions.
Business creation/lookups never call accounting. Ownership is resolved only
while collecting provider events. No network calls belong in this service.
"""

import hashlib
import json
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any, Literal, TypeVar
from uuid import UUID

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, JsonValue
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from libs.datetime_utils import naive_utc_now
from models.agent import Agent, AgentWorkspace, AgentWorkspaceBinding
from models.agent_sandbox_usage import AgentSandboxExecution, AgentSandboxUsageEvent
from models.model import App

_T = TypeVar("_T")
_COLLECTOR_EVENT_TYPES = {"collector_checkpoint", "collector_retention_gap"}
_TERMINAL_TYPES = {"sandbox.lifecycle.paused", "sandbox.lifecycle.killed"}
_NONTERMINAL_TYPES = {"sandbox.lifecycle.created", "sandbox.lifecycle.resumed", "sandbox.lifecycle.updated"}


class SandboxUsageError(ValueError):
    def __init__(self, code: str, *, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(code)


class SandboxUsageEvent(BaseModel):
    id: str = Field(min_length=1, max_length=255)
    source: Literal["application", "provider"]
    type: str = Field(min_length=1, max_length=96)
    timestamp: str | None = None
    sandbox_id: str | None = Field(default=None, max_length=128)
    execution_id: str | None = Field(default=None, max_length=128)
    payload: dict[str, JsonValue]
    model_config = ConfigDict(extra="forbid")


def _utc(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SandboxUsageError("invalid_timestamp")
    try:
        result = datetime.fromisoformat(value)
    except ValueError as exc:
        raise SandboxUsageError("invalid_timestamp") from exc
    if result.tzinfo is None:
        raise SandboxUsageError("timestamp_requires_timezone")
    return result.astimezone(UTC).replace(tzinfo=None)


def _iso(value: datetime | None) -> str | None:
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z") if value else None


def _hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _mapping(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _pick(data: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        if name in data and data[name] is not None:
            return data[name]
    return None


def _positive_int(value: object, *, allow_zero: bool = False) -> int | None:
    if value is None:
        return None
    if type(value) is not int or value < (0 if allow_zero else 1) or value > 2**63 - 1:
        raise SandboxUsageError("invalid_provider_quantity")
    return value


def _provider_values(event: SandboxUsageEvent, project_id: str) -> dict[str, Any]:
    """Normalize the current v2 API and webhook spellings, not old event versions."""
    raw = event.payload
    data = _mapping(_pick(raw, "eventData", "event_data", "data"))
    execution = _mapping(data.get("execution"))
    team = _pick(raw, "sandboxTeamId", "sandbox_team_id")
    if team != project_id:
        raise SandboxUsageError("provider_project_mismatch", status_code=403)
    raw_id = raw.get("id")
    raw_type = raw.get("type")
    sandbox_id = _pick(raw, "sandboxId", "sandbox_id")
    execution_id = _pick(raw, "sandboxExecutionId", "sandbox_execution_id")
    if raw_id != event.id or raw_type != event.type:
        raise SandboxUsageError("provider_envelope_mismatch")
    for declared, actual in ((event.sandbox_id, sandbox_id), (event.execution_id, execution_id)):
        if declared is not None and declared != actual:
            raise SandboxUsageError("provider_envelope_mismatch")
    for identifier in (sandbox_id, execution_id):
        if identifier is not None and (not isinstance(identifier, str) or not identifier or len(identifier) > 128):
            raise SandboxUsageError("invalid_provider_identifier")
    return {
        "id": event.id,
        "version": raw.get("version"),
        "type": event.type,
        "timestamp": _iso(_utc(raw.get("timestamp"))),
        "sandbox_id": sandbox_id,
        "execution_id": execution_id,
        "project_id": project_id,
        "template_id": _pick(raw, "sandboxTemplateId", "sandbox_template_id"),
        "template_build_id": _pick(raw, "sandboxBuildId", "sandbox_build_id"),
        "started_at": _iso(_utc(_pick(execution, "started_at", "startedAt"))),
        "duration_ms": _positive_int(_pick(execution, "execution_time", "executionTime"), allow_zero=True),
        "vcpu_count": _positive_int(_pick(execution, "vcpu_count", "vcpuCount")),
        "memory_mib": _positive_int(_pick(execution, "memory_mb", "memoryMb")),
        "metadata": _mapping(_pick(data, "sandbox_metadata", "sandboxMetadata")),
    }


def _enrich(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any] | None:
    """Accept absent-field enrichment; never silently choose contradictory facts."""
    merged = dict(existing)
    for key, value in incoming.items():
        old = merged.get(key)
        if isinstance(old, dict) and isinstance(value, dict):
            value = _enrich(old, value)
            if value is None:
                return None
        elif old is not None and value is not None and old != value:
            return None
        if value is not None:
            merged[key] = value
    return merged


class SandboxUsageService:
    @staticmethod
    def _config(project_id: str | None = None) -> tuple[str, datetime]:
        if not dify_config.AGENT_SANDBOX_METERING_ENABLED:
            raise SandboxUsageError("sandbox_metering_disabled", status_code=503)
        configured = dify_config.AGENT_SANDBOX_METERING_PROJECT_ID.strip()
        if not configured or len(configured) > 128:
            raise SandboxUsageError("sandbox_metering_project_not_configured", status_code=503)
        if project_id is not None and project_id != configured:
            raise SandboxUsageError("sandbox_metering_project_not_allowed", status_code=403)
        try:
            start = _utc(dify_config.AGENT_SANDBOX_METERING_START_AT)
        except SandboxUsageError as exc:
            raise SandboxUsageError("sandbox_metering_start_not_configured", status_code=503) from exc
        if start is None or start.microsecond:
            raise SandboxUsageError("sandbox_metering_start_requires_whole_second", status_code=503)
        return configured, start

    @classmethod
    def _write(cls, project_id: str, action: Callable[[Session, datetime], _T]) -> _T:
        _, start = cls._config(project_id)
        # The first activation can race. Retrying the whole short transaction
        # also handles concurrent unique-key inserts without losing an event.
        for attempt in range(3):
            try:
                with session_factory.create_session() as session, session.begin():
                    activation = cls._event(session, project_id, "application", "metering_activated", lock=True)
                    if activation is None:
                        activation = AgentSandboxUsageEvent(
                            provider="e2b",
                            provider_project_id=project_id,
                            source="application",
                            source_event_id="metering_activated",
                            event_type="metering_activated",
                            occurred_at=start,
                            payload={"started_at": _iso(start)},
                            canonical_hash=_hash({"started_at": _iso(start)}),
                            projection_status="applied",
                        )
                        session.add(activation)
                        session.flush()
                    elif _utc(activation.payload.get("started_at")) != start:
                        raise SandboxUsageError("sandbox_metering_start_is_immutable", status_code=409)
                    result = action(session, start)
                return result
            except IntegrityError:
                if attempt == 2:
                    raise
        raise AssertionError("unreachable")

    @staticmethod
    def _event(
        session: Session, project_id: str, source: str, event_id: str, *, lock: bool = False
    ) -> AgentSandboxUsageEvent | None:
        query = sa.select(AgentSandboxUsageEvent).where(
            AgentSandboxUsageEvent.provider == "e2b",
            AgentSandboxUsageEvent.provider_project_id == project_id,
            AgentSandboxUsageEvent.source == source,
            AgentSandboxUsageEvent.source_event_id == event_id,
        )
        return session.scalar(query.with_for_update() if lock else query)

    @classmethod
    def get_state(cls, *, project_id: str) -> dict[str, Any]:
        if not dify_config.AGENT_SANDBOX_METERING_ENABLED:
            return {
                "enabled": False,
                "project_id": project_id,
                "started_at": None,
                "checkpoint_at": None,
                "full_scan_at": None,
                "diagnostics": {
                    "unresolved_events": 0,
                    "conflict_events": 0,
                    "open_executions": 0,
                    "unattributed_executions": 0,
                },
            }

        def read(session: Session, start: datetime) -> dict[str, Any]:
            checkpoints = session.execute(
                sa.select(AgentSandboxUsageEvent.purpose, sa.func.max(AgentSandboxUsageEvent.occurred_at))
                .where(
                    AgentSandboxUsageEvent.provider_project_id == project_id,
                    AgentSandboxUsageEvent.source == "application",
                    AgentSandboxUsageEvent.event_type == "collector_checkpoint",
                    AgentSandboxUsageEvent.projection_status == "applied",
                )
                .group_by(AgentSandboxUsageEvent.purpose)
            ).all()
            ends = [end for _purpose, end in checkpoints if end is not None]
            full = [end for purpose, end in checkpoints if purpose == "full" and end is not None]
            event_scope = sa.and_(
                AgentSandboxUsageEvent.provider == "e2b",
                AgentSandboxUsageEvent.provider_project_id == project_id,
                sa.or_(
                    AgentSandboxUsageEvent.source == "provider",
                    AgentSandboxUsageEvent.event_type.in_(_COLLECTOR_EVENT_TYPES),
                ),
            )
            execution_scope = AgentSandboxExecution.provider_project_id == project_id
            diagnostics = {
                "unresolved_events": session.scalar(
                    sa.select(sa.func.count())
                    .select_from(AgentSandboxUsageEvent)
                    .where(event_scope, AgentSandboxUsageEvent.projection_status.in_(["pending", "unresolved"]))
                )
                or 0,
                "conflict_events": session.scalar(
                    sa.select(sa.func.count())
                    .select_from(AgentSandboxUsageEvent)
                    .where(event_scope, AgentSandboxUsageEvent.projection_status == "conflict")
                )
                or 0,
                "open_executions": session.scalar(
                    sa.select(sa.func.count())
                    .select_from(AgentSandboxExecution)
                    .where(execution_scope, AgentSandboxExecution.state == "open")
                )
                or 0,
                "unattributed_executions": session.scalar(
                    sa.select(sa.func.count())
                    .select_from(AgentSandboxExecution)
                    .where(execution_scope, AgentSandboxExecution.attribution_status != "resolved")
                )
                or 0,
            }
            return {
                "enabled": True,
                "project_id": project_id,
                "started_at": _iso(start),
                "checkpoint_at": _iso(max(ends, default=None)),
                "full_scan_at": _iso(max(full, default=None)),
                "diagnostics": diagnostics,
            }

        _, configured_start = cls._config(project_id)
        with session_factory.create_session() as session:
            activation = cls._event(session, project_id, "application", "metering_activated")
            if activation is not None:
                if _utc(activation.payload.get("started_at")) != configured_start:
                    raise SandboxUsageError("sandbox_metering_start_is_immutable", status_code=409)
                return read(session, configured_start)
        # Only the first lookup initializes T0. Ordinary polling is SELECT-only,
        # does not lock the project row, and cannot delay an ingestion transaction.
        return cls._write(project_id, read)

    @classmethod
    def ingest(cls, *, project_id: str, events: list[SandboxUsageEvent]) -> dict[str, int]:
        if len(events) > 100:
            raise SandboxUsageError("too_many_usage_events")

        def ingest_batch(session: Session, start: datetime) -> dict[str, int]:
            counts = {"accepted": 0, "duplicates": 0, "conflicts": 0, "ignored": 0}
            for event in events:
                counts[cls._ingest_one(session, project_id, start, event)] += 1
            return counts

        return cls._write(project_id, ingest_batch)

    @classmethod
    def _ingest_one(cls, session: Session, project_id: str, start: datetime, event: SandboxUsageEvent) -> str:
        if event.source == "provider":
            canonical = _provider_values(event, project_id)
            begun = _utc(canonical["started_at"])
            occurred = _utc(canonical["timestamp"])
            if (begun is not None and begun < start) or (begun is None and occurred is not None and occurred < start):
                previous = cls._event(session, project_id, "provider", event.id)
                physical = (
                    session.scalar(
                        sa.select(AgentSandboxExecution).where(
                            AgentSandboxExecution.provider_project_id == project_id,
                            AgentSandboxExecution.provider_execution_id == canonical["execution_id"],
                        )
                    )
                    if canonical["execution_id"]
                    else None
                )
                # New old executions are excluded; corrections to known facts
                # must still go through conflict detection and preserve evidence.
                if physical is None and previous is None:
                    return "ignored"
                if physical is None or physical.started_at is None:
                    if physical is not None:
                        session.delete(physical)
                    for pending in session.scalars(
                        sa.select(AgentSandboxUsageEvent).where(
                            AgentSandboxUsageEvent.provider_project_id == project_id,
                            AgentSandboxUsageEvent.source == "provider",
                            AgentSandboxUsageEvent.provider_execution_id == canonical["execution_id"],
                        )
                    ):
                        pending.projection_status = "applied"
                        pending.projection_error_code = "execution_predates_activation"
                    if previous is not None:
                        digest = _hash(canonical)
                        if not any(version.get("hash") == digest for version in previous.payload_versions):
                            previous.payload_versions = [
                                *previous.payload_versions,
                                {
                                    "hash": digest,
                                    "payload": event.payload,
                                    "received_at": _iso(naive_utc_now()),
                                },
                            ]
                        previous.resolution = {**previous.resolution, "scope": "excluded_before_activation"}
                    return "ignored"
        else:
            if event.type not in _COLLECTOR_EVENT_TYPES:
                raise SandboxUsageError("unsupported_application_event")
            occurred = _utc(event.timestamp)
            if occurred is not None and occurred < start:
                return "ignored"
            canonical = event.model_dump(mode="json")
            if event.type == "collector_checkpoint":
                cls._validate_checkpoint(event.payload, start)
            elif event.type == "collector_retention_gap":
                lower = _utc(event.payload.get("uncovered_start"))
                upper = _utc(event.payload.get("uncovered_end"))
                if (
                    lower is None
                    or upper is None
                    or occurred is None
                    or not start <= lower < upper <= occurred
                    or _positive_int(event.payload.get("assumed_retention_seconds")) is None
                ):
                    raise SandboxUsageError("invalid_collector_retention_gap")
        digest = _hash(canonical)
        row = cls._event(session, project_id, event.source, event.id)
        if row is not None:
            if row.canonical_hash == digest:
                if event.source == "provider" and row.projection_status != "conflict":
                    cls._project_provider(session, row, canonical, start)
                return "duplicates"
            versions = list(row.payload_versions or [])
            if not any(version.get("hash") == digest for version in versions):
                versions.append({"hash": digest, "payload": event.payload, "received_at": _iso(naive_utc_now())})
                row.payload_versions = versions
            old = _mapping(row.resolution.get("canonical"))
            # Attribution labels are optional. A bad/changed label must not
            # invalidate otherwise identical provider-measured runtime.
            merged = (
                _enrich(
                    {key: value for key, value in old.items() if key != "metadata"},
                    {key: value for key, value in canonical.items() if key != "metadata"},
                )
                if old and event.source == "provider"
                else None
            )
            if merged is not None:
                merged["metadata"] = canonical.get("metadata") or old.get("metadata", {})
            if merged is None or row.projection_status == "conflict":
                cls._conflict(session, row, "event_content_conflict")
                return "conflicts"
            if merged == old:
                return "duplicates"
            canonical = merged
            row.resolution = {"canonical": canonical}
            row.canonical_hash = _hash(canonical)
        else:
            row = AgentSandboxUsageEvent(
                provider="e2b",
                provider_project_id=project_id,
                source=event.source,
                source_event_id=event.id,
                event_type=event.type,
                sandbox_id=event.sandbox_id,
                provider_execution_id=event.execution_id,
                occurred_at=occurred,
                payload=event.payload,
                canonical_hash=digest,
                resolution={"canonical": canonical},
            )
            session.add(row)
            session.flush()
        if event.source == "provider":
            cls._project_provider(session, row, canonical, start)
        else:
            row.projection_status = "applied"
            if event.type == "collector_checkpoint":
                row.occurred_at = _utc(event.payload["window_end"])
                row.purpose = str(event.payload["mode"])
            elif event.type == "collector_retention_gap":
                row.projection_status = "unresolved"
                row.projection_error_code = "provider_retention_gap"
        row.processed_at = naive_utc_now()
        session.flush()
        return "conflicts" if row.projection_status == "conflict" else "accepted"

    @staticmethod
    def _validate_checkpoint(payload: Mapping[str, Any], start: datetime) -> None:
        lower = _utc(payload.get("window_start"))
        upper = _utc(payload.get("window_end"))
        scan = _utc(payload.get("scan_started_at"))
        if (
            payload.get("completed") is not True
            or payload.get("mode") not in {"incremental", "full"}
            or lower is None
            or upper is None
            or scan is None
            or not start <= lower <= upper <= scan
            or scan > naive_utc_now()
            or type(payload.get("pages")) is not int
            or payload["pages"] < 1
            or type(payload.get("events")) is not int
            or payload["events"] < 0
        ):
            raise SandboxUsageError("invalid_collector_checkpoint")

    @staticmethod
    def _verified_owner(session: Session, sandbox_id: str, metadata: dict[str, Any]) -> AgentWorkspaceBinding | None:
        """Resolve optional labels through the existing tenant-owned resource chain.

        Metadata alone is never ownership evidence. Retired rows are still valid
        historical associations until physical collection removes them.
        """
        binding_id = metadata.get("dify.binding_id")
        tenant_id = metadata.get("dify.tenant_id")
        if not isinstance(binding_id, str) or not isinstance(tenant_id, str):
            return None
        try:
            binding_id, tenant_id = str(UUID(binding_id)), str(UUID(tenant_id))
        except ValueError:
            return None
        binding = session.scalar(
            sa.select(AgentWorkspaceBinding)
            .join(
                AgentWorkspace,
                sa.and_(
                    AgentWorkspace.id == AgentWorkspaceBinding.workspace_id,
                    AgentWorkspace.tenant_id == AgentWorkspaceBinding.tenant_id,
                    AgentWorkspace.app_id == AgentWorkspaceBinding.app_id,
                ),
            )
            .join(
                App,
                sa.and_(
                    App.id == AgentWorkspaceBinding.app_id,
                    App.tenant_id == AgentWorkspaceBinding.tenant_id,
                ),
            )
            .join(
                Agent,
                sa.and_(
                    Agent.id == AgentWorkspaceBinding.agent_id,
                    Agent.tenant_id == AgentWorkspaceBinding.tenant_id,
                ),
            )
            .where(
                AgentWorkspaceBinding.id == binding_id,
                AgentWorkspaceBinding.tenant_id == tenant_id,
                AgentWorkspaceBinding.backend_binding_ref == sandbox_id,
                AgentWorkspace.backend_workspace_ref == sandbox_id,
            )
        )
        if binding is None:
            return None
        for key, expected in (
            ("dify.agent_id", binding.agent_id),
            ("dify.workspace_id", binding.workspace_id),
        ):
            supplied = metadata.get(key)
            if supplied is not None and supplied != expected:
                return None
        return binding

    @classmethod
    def _attribute_execution(cls, session: Session, execution: AgentSandboxExecution, metadata: dict[str, Any]) -> None:
        owner = cls._verified_owner(session, execution.sandbox_id, metadata)
        if owner is None or execution.attribution_status == "conflict":
            # Existing snapshots survive missing/deleted business resources or
            # malformed labels. No fallback to unverified allocation metadata.
            return
        expected = (owner.tenant_id, owner.app_id, owner.agent_id, owner.id, owner.workspace_id)
        retained = (
            execution.tenant_id,
            execution.app_id,
            execution.agent_id,
            execution.binding_id,
            execution.workspace_id,
        )
        if execution.binding_id is not None:
            if retained != expected:
                execution.attribution_status = "conflict"
            return
        other_owner = session.scalar(
            sa.select(AgentSandboxExecution.id)
            .where(
                AgentSandboxExecution.provider == execution.provider,
                AgentSandboxExecution.provider_project_id == execution.provider_project_id,
                AgentSandboxExecution.sandbox_id == execution.sandbox_id,
                AgentSandboxExecution.attribution_status == "resolved",
                AgentSandboxExecution.binding_id != owner.id,
            )
            .limit(1)
        )
        if other_owner is not None:
            execution.attribution_status = "conflict"
            return
        execution.tenant_id, execution.app_id, execution.agent_id = owner.tenant_id, owner.app_id, owner.agent_id
        execution.binding_id, execution.workspace_id = owner.id, owner.workspace_id
        execution.attribution_status = "resolved"

    @classmethod
    def _project_provider(
        cls, session: Session, row: AgentSandboxUsageEvent, data: dict[str, Any], start: datetime
    ) -> None:
        row.sandbox_id = data["sandbox_id"]
        row.provider_execution_id = data["execution_id"]
        started_at = _utc(data["started_at"])
        if data["version"] != "v2" or not row.sandbox_id or not row.provider_execution_id:
            row.projection_status = "unresolved"
            row.projection_error_code = "incomplete_provider_execution"
            return
        if started_at is not None and started_at < start:
            cls._conflict(session, row, "execution_start_scope_conflict")
            return
        excluded = session.scalar(
            sa.select(AgentSandboxUsageEvent.id)
            .where(
                AgentSandboxUsageEvent.provider_project_id == row.provider_project_id,
                AgentSandboxUsageEvent.source == "provider",
                AgentSandboxUsageEvent.provider_execution_id == row.provider_execution_id,
                AgentSandboxUsageEvent.projection_error_code == "execution_predates_activation",
            )
            .limit(1)
        )
        if excluded is not None:
            if started_at is not None:
                cls._conflict(session, row, "execution_start_scope_conflict")
            else:
                row.projection_status = "applied"
                row.projection_error_code = "execution_predates_activation"
            return
        execution = session.scalar(
            sa.select(AgentSandboxExecution).where(
                AgentSandboxExecution.provider == "e2b",
                AgentSandboxExecution.provider_project_id == row.provider_project_id,
                AgentSandboxExecution.provider_execution_id == row.provider_execution_id,
            )
        )
        if execution is None:
            execution = AgentSandboxExecution(
                provider="e2b",
                provider_project_id=row.provider_project_id,
                sandbox_id=row.sandbox_id,
                provider_execution_id=row.provider_execution_id,
                started_at=started_at,
                started_at_source="provider_execution" if started_at else None,
                started_at_precision_ms=1000 if started_at else None,
                state="open",
                quality="pending",
                attribution_status="unresolved",
            )
            session.add(execution)
            session.flush()
        if execution.sandbox_id != row.sandbox_id or (
            execution.started_at is not None and started_at is not None and execution.started_at != started_at
        ):
            cls._conflict(session, row, "execution_identity_conflict", execution)
            return
        if started_at is not None and execution.started_at is None:
            execution.started_at = started_at
            execution.started_at_source = "provider_execution"
            execution.started_at_precision_ms = 1000
        cls._attribute_execution(session, execution, _mapping(data["metadata"]))
        for field, previous in (
            ("template_id", execution.template_id),
            ("template_build_id", execution.template_build_id),
            ("vcpu_count", execution.vcpu_count),
            ("memory_mib", execution.memory_mib),
        ):
            value = data[field]
            if previous is not None and value is not None and previous != value:
                cls._conflict(session, row, "execution_resources_conflict", execution)
                return
            if value is not None:
                setattr(execution, field, value)
        if row.event_type in _TERMINAL_TYPES:
            duration = data["duration_ms"]
            if (
                execution.metered_duration_ms is not None
                and duration is not None
                and execution.metered_duration_ms != duration
            ):
                cls._conflict(session, row, "execution_duration_conflict", execution)
                return
            execution.state = "closed"
            if duration is not None:
                execution.metered_duration_ms = duration
            if execution.quality != "conflict" and all(
                value is not None
                for value in (
                    execution.metered_duration_ms,
                    execution.started_at,
                    execution.vcpu_count,
                    execution.memory_mib,
                )
            ):
                execution.quality = "metered"
                execution.measurement_source = "provider_execution"
            if execution.terminal_event_id is None:
                execution.terminal_event_id = row.id
                execution.terminal_event_at = row.occurred_at
                execution.close_reason = row.event_type.rsplit(".", 1)[-1]
        execution.last_reconciled_at = naive_utc_now()
        execution.revision += 1
        if execution.quality == "conflict":
            row.projection_status = "conflict"
            row.projection_error_code = "execution_conflict"
        elif execution.quality == "metered" or row.event_type in _NONTERMINAL_TYPES:
            row.projection_status = "applied"
            row.projection_error_code = None
        else:
            row.projection_status = "unresolved"
            row.projection_error_code = "incomplete_provider_execution"

    @staticmethod
    def _conflict(
        session: Session, row: AgentSandboxUsageEvent, code: str, execution: AgentSandboxExecution | None = None
    ) -> None:
        row.projection_status = "conflict"
        row.projection_error_code = code
        if execution is None and row.provider_execution_id:
            execution = session.scalar(
                sa.select(AgentSandboxExecution).where(
                    AgentSandboxExecution.provider_project_id == row.provider_project_id,
                    AgentSandboxExecution.provider_execution_id == row.provider_execution_id,
                )
            )
        if execution:
            execution.quality = "conflict"
            execution.revision += 1

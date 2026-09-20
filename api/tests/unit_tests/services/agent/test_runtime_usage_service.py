"""Accounting invariants tested against real SQLAlchemy persistence."""

from collections.abc import Iterator
from copy import deepcopy
from datetime import datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from pydantic import JsonValue
from sqlalchemy.orm import Session, sessionmaker

from models.agent_sandbox_usage import AgentSandboxExecution, AgentSandboxUsageEvent
from services.agent.runtime_usage_service import SandboxUsageError, SandboxUsageEvent, SandboxUsageService
from tests.unit_tests.config_override import config_overrides_context

PROJECT = "431de237-596f-4d59-8a85-20a9846bf243"
START = "2026-09-20T00:00:00Z"


@pytest.fixture(autouse=True)
def metering_config(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr("services.agent.runtime_usage_service.naive_utc_now", lambda: datetime(2026, 9, 21))
    with config_overrides_context(
        AGENT_SANDBOX_METERING_ENABLED=True,
        AGENT_SANDBOX_METERING_PROJECT_ID=PROJECT,
        AGENT_SANDBOX_METERING_START_AT=START,
    ):
        yield


def owner() -> dict[str, str]:
    result = {key: str(uuid4()) for key in ("tenant_id", "app_id", "agent_id", "binding_id", "workspace_id")}
    return {**result, "allocation_id": result["binding_id"]}


def provider_event(
    *,
    event_id: str = "event-1",
    execution_id: str = "execution-1",
    sandbox_id: str = "sandbox-1",
    duration: int | None = 12345,
    started_at: str | None = "2026-09-20T00:00:02Z",
    kind: str = "paused",
    metadata: dict[str, str] | None = None,
) -> SandboxUsageEvent:
    return SandboxUsageEvent.model_validate(
        {
            "id": event_id,
            "source": "provider",
            "type": f"sandbox.lifecycle.{kind}",
            "sandbox_id": sandbox_id,
            "execution_id": execution_id,
            "payload": {
                "id": event_id,
                "version": "v2",
                "type": f"sandbox.lifecycle.{kind}",
                "timestamp": "2026-09-20T00:00:14.551745815Z",
                "sandboxId": sandbox_id,
                "sandboxExecutionId": execution_id,
                "sandboxTeamId": PROJECT,
                "sandboxTemplateId": "template-1",
                "sandboxBuildId": "build-1",
                "eventData": {
                    "execution": {
                        "started_at": started_at,
                        "execution_time": duration,
                        "memory_mb": 1024,
                        "vcpu_count": 2,
                    },
                    "sandbox_metadata": metadata or {},
                },
            },
        }
    )


def ingest(*events: SandboxUsageEvent) -> dict[str, int]:
    return SandboxUsageService.ingest(project_id=PROJECT, events=list(events))


def execution(factory: sessionmaker[Session]) -> AgentSandboxExecution:
    with factory() as session:
        return session.scalars(sa.select(AgentSandboxExecution)).one()


def test_duplicate_terminal_and_api_webhook_aliases_count_once(sqlite_session_factory: sessionmaker[Session]) -> None:
    event = provider_event()
    assert ingest(event)["accepted"] == 1
    alias = deepcopy(event.payload)
    for camel, snake in (
        ("sandboxId", "sandbox_id"),
        ("sandboxExecutionId", "sandbox_execution_id"),
        ("sandboxTeamId", "sandbox_team_id"),
        ("sandboxTemplateId", "sandbox_template_id"),
        ("sandboxBuildId", "sandbox_build_id"),
        ("eventData", "event_data"),
    ):
        alias[snake] = alias.pop(camel)
    assert ingest(event.model_copy(update={"payload": alias}))["duplicates"] == 1
    assert ingest(provider_event(event_id="killed-event", kind="killed"))["accepted"] == 1
    row = execution(sqlite_session_factory)
    assert row.metered_duration_ms == 12345
    assert row.quality == "metered"
    assert row.started_at == datetime(2026, 9, 20, 0, 0, 2)
    assert row.terminal_event_at == datetime(2026, 9, 20, 0, 0, 14, 551745)


def test_same_sandbox_resume_is_a_new_execution(sqlite_session_factory: sessionmaker[Session]) -> None:
    ingest(provider_event(), provider_event(event_id="second", execution_id="execution-2", duration=6789))
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.sum(AgentSandboxExecution.metered_duration_ms))) == 19134
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxExecution)) == 2


def test_registration_precedes_business_rows_and_survives_without_them(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    registered = owner()
    SandboxUsageService.register_allocation(**registered)
    SandboxUsageService.register_allocation(**registered, sandbox_id="sandbox-1")
    SandboxUsageService.register_allocation(**registered, sandbox_id="sandbox-1")
    ingest(provider_event(metadata={"dify.usage_allocation_id": registered["allocation_id"]}))
    row = execution(sqlite_session_factory)
    assert row.tenant_id == registered["tenant_id"]
    assert row.app_id == registered["app_id"]
    assert row.attribution_status == "resolved"
    with pytest.raises(SandboxUsageError, match="allocation_owner_conflict"):
        SandboxUsageService.register_allocation(**{**registered, "tenant_id": str(uuid4())})
    with pytest.raises(SandboxUsageError, match="allocation_sandbox_conflict"):
        SandboxUsageService.register_allocation(**registered, sandbox_id="wrong-sandbox")


def test_late_registration_resolves_orphan_execution(sqlite_session_factory: sessionmaker[Session]) -> None:
    registered = owner()
    ingest(provider_event(metadata={"dify.usage_allocation_id": registered["allocation_id"]}))
    assert execution(sqlite_session_factory).attribution_status == "unresolved"
    SandboxUsageService.register_allocation(**registered, sandbox_id="sandbox-1")
    assert execution(sqlite_session_factory).attribution_status == "resolved"


def test_unregistered_allocation_cannot_steal_resolved_execution(sqlite_session_factory: sessionmaker[Session]) -> None:
    first, second = owner(), owner()
    SandboxUsageService.register_allocation(**first, sandbox_id="sandbox-1")
    ingest(provider_event(metadata={"dify.usage_allocation_id": first["allocation_id"]}))
    assert (
        ingest(
            provider_event(event_id="different-owner", metadata={"dify.usage_allocation_id": second["allocation_id"]})
        )["conflicts"]
        == 1
    )
    with pytest.raises(SandboxUsageError, match="sandbox_owner_conflict"):
        SandboxUsageService.register_allocation(**second, sandbox_id="sandbox-1")
    SandboxUsageService.register_allocation(**first, sandbox_id="sandbox-1")
    row = execution(sqlite_session_factory)
    assert row.allocation_id == first["allocation_id"]
    assert row.tenant_id == first["tenant_id"]
    assert row.attribution_status == "conflict"
    assert row.quality == "conflict"


def test_two_allocations_cannot_register_same_physical_sandbox() -> None:
    SandboxUsageService.register_allocation(**owner(), sandbox_id="sandbox-1")
    with pytest.raises(SandboxUsageError, match="sandbox_owner_conflict"):
        SandboxUsageService.register_allocation(**owner(), sandbox_id="sandbox-1")


def test_provider_cannot_reassign_same_sandbox_on_another_execution(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first, second = owner(), owner()
    SandboxUsageService.register_allocation(**first, sandbox_id="sandbox-1")
    SandboxUsageService.register_allocation(**second)
    assert ingest(provider_event(metadata={"dify.usage_allocation_id": second["allocation_id"]}))["conflicts"] == 1
    assert execution(sqlite_session_factory).attribution_status == "conflict"


def test_state_reports_pending_and_conflict_counts_without_owner_ids() -> None:
    created = provider_event(event_id="created", kind="created", duration=None, started_at=None)
    created.payload["eventData"] = dict[str, JsonValue]()
    ingest(created)
    assert SandboxUsageService.get_state(project_id=PROJECT)["diagnostics"] == {
        "unresolved_events": 0,
        "conflict_events": 0,
        "open_executions": 1,
        "unattributed_executions": 1,
    }
    ingest(provider_event())
    ingest(provider_event(duration=1))
    diagnostics = SandboxUsageService.get_state(project_id=PROJECT)["diagnostics"]
    assert diagnostics == {
        "unresolved_events": 0,
        "conflict_events": 1,
        "open_executions": 0,
        "unattributed_executions": 1,
    }


def test_existing_sandbox_registered_at_first_use_counts_only_new_execution(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    SandboxUsageService.register_allocation(**owner(), sandbox_id="sandbox-1")
    assert ingest(provider_event(started_at="2026-09-19T23:59:59Z"))["ignored"] == 1
    ingest(provider_event(event_id="resume", execution_id="new-execution"))
    assert execution(sqlite_session_factory).attribution_status == "resolved"


def test_unknown_duration_stays_null_and_enrichment_is_replayable(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    missing = provider_event(duration=None)
    ingest(missing)
    assert execution(sqlite_session_factory).metered_duration_ms is None
    assert execution(sqlite_session_factory).quality == "pending"
    assert ingest(provider_event())["accepted"] == 1
    assert execution(sqlite_session_factory).metered_duration_ms == 12345
    assert ingest(missing)["duplicates"] == 1
    with sqlite_session_factory() as session:
        event = session.scalars(
            sa.select(AgentSandboxUsageEvent).where(AgentSandboxUsageEvent.source_event_id == "event-1")
        ).one()
        assert event.payload["eventData"]["execution"]["execution_time"] is None
        assert event.payload_versions
        assert event.resolution["canonical"]["duration_ms"] == 12345


def test_conflicting_event_keeps_both_payloads_and_quarantines_usage(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ingest(provider_event())
    assert ingest(provider_event(duration=999))["conflicts"] == 1
    assert execution(sqlite_session_factory).quality == "conflict"
    assert execution(sqlite_session_factory).metered_duration_ms == 12345
    with sqlite_session_factory() as session:
        event = session.scalars(
            sa.select(AgentSandboxUsageEvent).where(AgentSandboxUsageEvent.source_event_id == "event-1")
        ).one()
        assert event.payload_versions[0]["payload"]["eventData"]["execution"]["execution_time"] == 999
    ingest(provider_event(event_id="new-terminal"))
    assert execution(sqlite_session_factory).quality == "conflict"


def test_conflicting_executions_never_add_or_overwrite_duration(sqlite_session_factory: sessionmaker[Session]) -> None:
    ingest(provider_event())
    assert ingest(provider_event(event_id="other-terminal", duration=1))["conflicts"] == 1
    assert execution(sqlite_session_factory).metered_duration_ms == 12345


def test_late_start_does_not_reopen_closed_execution(sqlite_session_factory: sessionmaker[Session]) -> None:
    ingest(provider_event())
    ingest(provider_event(event_id="start", kind="resumed", duration=None))
    row = execution(sqlite_session_factory)
    assert (row.state, row.quality, row.metered_duration_ms) == ("closed", "metered", 12345)


def test_activation_survives_restarts_and_config_changes_are_rejected() -> None:
    state = SandboxUsageService.get_state(project_id=PROJECT)
    assert state["started_at"] == START
    assert SandboxUsageService.get_state(project_id=PROJECT) == state
    with config_overrides_context(AGENT_SANDBOX_METERING_START_AT="2026-09-21T00:00:00Z"):
        with pytest.raises(SandboxUsageError, match="immutable"):
            SandboxUsageService.get_state(project_id=PROJECT)


def test_no_old_data_even_when_terminal_arrives_after_activation(sqlite_session_factory: sessionmaker[Session]) -> None:
    assert ingest(provider_event(started_at="2026-09-19T23:59:59Z"))["ignored"] == 1
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxExecution)) == 0
        assert (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(AgentSandboxUsageEvent)
                .where(AgentSandboxUsageEvent.source == "provider")
            )
            == 0
        )


def test_t0_filter_cannot_hide_contradictory_existing_metered_event(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ingest(provider_event())
    assert ingest(provider_event(started_at="2026-09-19T23:59:59Z"))["conflicts"] == 1
    assert execution(sqlite_session_factory).quality == "conflict"


def test_unknown_start_proven_before_t0_removes_pending_execution(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    unknown = provider_event(started_at=None, duration=None)
    ingest(unknown)
    assert ingest(provider_event(started_at="2026-09-19T23:59:59Z"))["ignored"] == 1
    ingest(provider_event(event_id="late-start", kind="created", started_at=None, duration=None))
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxExecution)) == 0


def test_unusable_provider_data_is_visible_but_not_metered(sqlite_session_factory: sessionmaker[Session]) -> None:
    event = provider_event(started_at=None)
    assert ingest(event)["accepted"] == 1
    with sqlite_session_factory() as session:
        assert session.scalars(sa.select(AgentSandboxExecution)).one().quality == "pending"
        row = session.scalars(
            sa.select(AgentSandboxUsageEvent).where(AgentSandboxUsageEvent.source == "provider")
        ).one()
        assert row.projection_status == "unresolved"


def test_created_without_execution_data_then_terminal_and_late_start(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    created = provider_event(event_id="created", kind="created", duration=None, started_at=None)
    created.payload["eventData"] = dict[str, JsonValue]()
    assert ingest(created)["accepted"] == 1
    row = execution(sqlite_session_factory)
    assert row.started_at is None
    assert row.state == "open"
    assert row.metered_duration_ms is None
    ingest(provider_event())
    assert execution(sqlite_session_factory).quality == "metered"
    assert ingest(created)["duplicates"] == 1
    late = created.model_copy(deep=True, update={"id": "late"})
    late.payload["id"] = "late"
    ingest(late)
    row = execution(sqlite_session_factory)
    assert (row.state, row.quality, row.metered_duration_ms) == ("closed", "metered", 12345)


def test_missing_provider_project_is_rejected() -> None:
    event = provider_event()
    event.payload.pop("sandboxTeamId")
    with pytest.raises(SandboxUsageError, match="provider_project_mismatch"):
        ingest(event)


def test_retention_gap_is_saved_without_advancing_checkpoint(sqlite_session_factory: sessionmaker[Session]) -> None:
    with config_overrides_context(AGENT_SANDBOX_METERING_START_AT="2026-09-01T00:00:00Z"):
        event = SandboxUsageEvent(
            id="gap",
            source="application",
            type="collector_retention_gap",
            timestamp=START,
            payload={
                "uncovered_start": "2026-09-01T00:00:00Z",
                "uncovered_end": "2026-09-13T00:00:00Z",
                "assumed_retention_seconds": 604800,
            },
        )
        assert ingest(event)["accepted"] == 1
        assert SandboxUsageService.get_state(project_id=PROJECT)["checkpoint_at"] is None
    with sqlite_session_factory() as session:
        row = session.scalars(
            sa.select(AgentSandboxUsageEvent).where(AgentSandboxUsageEvent.source_event_id == "gap")
        ).one()
        assert row.projection_status == "unresolved"
        assert row.projection_error_code == "provider_retention_gap"


def test_checkpoint_only_advances_after_completed_scan() -> None:
    event = SandboxUsageEvent(
        id="checkpoint-1",
        source="application",
        type="collector_checkpoint",
        timestamp=START,
        payload={
            "scan_started_at": START,
            "window_start": START,
            "window_end": START,
            "completed": True,
            "mode": "full",
            "pages": 1,
            "events": 0,
        },
    )
    ingest(event)
    state = SandboxUsageService.get_state(project_id=PROJECT)
    assert state["checkpoint_at"] == START
    assert state["full_scan_at"] == START
    with pytest.raises(SandboxUsageError, match="invalid_collector_checkpoint"):
        ingest(event.model_copy(update={"id": "partial", "payload": {**event.payload, "completed": False}}))


def test_forbidden_project_and_reserved_application_events_fail_without_partial_batch(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with pytest.raises(SandboxUsageError, match="not_allowed"):
        SandboxUsageService.ingest(project_id="other-project", events=[provider_event()])
    reserved = SandboxUsageEvent(id="forged", source="application", type="allocation_registered", payload={})
    with pytest.raises(SandboxUsageError, match="unsupported_application_event"):
        ingest(provider_event(), reserved)
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxExecution)) == 0


def test_provider_team_must_match_configured_project() -> None:
    event = provider_event()
    event.payload["sandboxTeamId"] = "other-project"
    with pytest.raises(SandboxUsageError, match="provider_project_mismatch"):
        ingest(event)


def test_disabled_registration_is_noop_and_ingestion_does_not_ack(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with config_overrides_context(AGENT_SANDBOX_METERING_ENABLED=False):
        SandboxUsageService.register_allocation(**owner())
        assert SandboxUsageService.get_state(project_id=PROJECT)["enabled"] is False
        with pytest.raises(SandboxUsageError, match="disabled"):
            ingest(provider_event())
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxUsageEvent)) == 0

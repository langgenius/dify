"""Accounting invariants tested against real SQLAlchemy persistence."""

from collections.abc import Iterator
from copy import deepcopy
from datetime import datetime
from uuid import uuid4

import pytest
import sqlalchemy as sa
from pydantic import JsonValue
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.sql import ClauseElement

from models.agent import (
    Agent,
    AgentConfigVersionKind,
    AgentScope,
    AgentSource,
    AgentWorkspace,
    AgentWorkspaceBinding,
    AgentWorkspaceOwnerType,
)
from models.agent_sandbox_usage import AgentSandboxExecution, AgentSandboxUsageEvent
from models.model import App
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


def provider_event(
    *,
    event_id: str = "event-1",
    execution_id: str = "execution-1",
    sandbox_id: str = "sandbox-1",
    duration: int | None = 12345,
    started_at: str | None = "2026-09-20T00:00:02Z",
    kind: str = "paused",
    metadata: dict[str, JsonValue] | None = None,
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


def test_unknown_duration_stays_null_and_enrichment_is_replayable(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    missing = provider_event(duration=None)
    ingest(missing)
    assert ingest(missing)["duplicates"] == 1
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


def test_disabled_ingestion_does_not_ack(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with config_overrides_context(AGENT_SANDBOX_METERING_ENABLED=False):
        assert SandboxUsageService.get_state(project_id=PROJECT)["enabled"] is False
        with pytest.raises(SandboxUsageError, match="disabled"):
            ingest(provider_event())
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxUsageEvent)) == 0


@pytest.mark.parametrize(
    ("timestamp", "error"),
    [
        (123, "invalid_timestamp"),
        ("not-a-time", "invalid_timestamp"),
        ("2026-09-20T00:00:14", "timestamp_requires_timezone"),
    ],
)
def test_invalid_provider_time_rolls_back_entire_batch(
    timestamp: JsonValue, error: str, sqlite_session_factory: sessionmaker[Session]
) -> None:
    bad = provider_event(event_id="bad-time", execution_id="bad-execution")
    bad.payload["timestamp"] = timestamp
    with pytest.raises(SandboxUsageError, match=error):
        ingest(provider_event(), bad)
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxExecution)) == 0


@pytest.mark.parametrize("quantity", [-1, True, 1.5, 2**63])
def test_invalid_duration_is_rejected_before_any_accounting(quantity: JsonValue) -> None:
    event = provider_event()
    data = event.payload["eventData"]
    assert isinstance(data, dict)
    details = data["execution"]
    assert isinstance(details, dict)
    details["execution_time"] = quantity
    with pytest.raises(SandboxUsageError, match="invalid_provider_quantity"):
        ingest(event)


@pytest.mark.parametrize("field", ["id", "sandboxId", "sandboxExecutionId"])
def test_raw_identity_cannot_disagree_with_delivery_envelope(field: str) -> None:
    event = provider_event()
    event.payload[field] = "different-id"
    with pytest.raises(SandboxUsageError, match="provider_envelope_mismatch"):
        ingest(event)


def test_invalid_provider_identifier_without_envelope_hint_is_rejected() -> None:
    event = provider_event().model_copy(update={"sandbox_id": None})
    event.payload["sandboxId"] = ""
    with pytest.raises(SandboxUsageError, match="invalid_provider_identifier"):
        ingest(event)


@pytest.mark.parametrize(
    ("configured_start", "error"),
    [
        ("invalid", "sandbox_metering_start_not_configured"),
        ("2026-09-20T00:00:00.001Z", "sandbox_metering_start_requires_whole_second"),
    ],
)
def test_invalid_activation_configuration_cannot_create_ledger_scope(configured_start: str, error: str) -> None:
    with config_overrides_context(AGENT_SANDBOX_METERING_START_AT=configured_start):
        with pytest.raises(SandboxUsageError, match=error) as result:
            SandboxUsageService.get_state(project_id=PROJECT)
        assert result.value.status_code == 503


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("dify.usage_allocation_id", 42),
        ("dify.usage_allocation_id", "invalid-uuid"),
        ("dify.binding_id", 42),
        ("dify.binding_id", "invalid-uuid"),
    ],
)
def test_invalid_owner_metadata_does_not_discard_metered_usage(
    key: str, value: JsonValue, sqlite_session_factory: sessionmaker[Session]
) -> None:
    assert ingest(provider_event(metadata={key: value}))["accepted"] == 1
    row = execution(sqlite_session_factory)
    assert row.quality == "metered"
    assert row.metered_duration_ms == 12345
    assert row.tenant_id is None
    assert row.attribution_status == "unresolved"


@pytest.mark.parametrize("change", ["sandbox", "started_at", "resources"])
def test_execution_identity_and_resource_conflicts_preserve_original_usage(
    change: str, sqlite_session_factory: sessionmaker[Session]
) -> None:
    ingest(provider_event())
    different = provider_event(event_id="conflicting-terminal")
    if change == "sandbox":
        different = provider_event(event_id="conflicting-terminal", sandbox_id="other-sandbox")
    elif change == "started_at":
        different = provider_event(event_id="conflicting-terminal", started_at="2026-09-20T00:00:03Z")
    else:
        data = different.payload["eventData"]
        assert isinstance(data, dict)
        details = data["execution"]
        assert isinstance(details, dict)
        details["vcpu_count"] = 4
    assert ingest(different)["conflicts"] == 1
    row = execution(sqlite_session_factory)
    assert row.quality == "conflict"
    assert row.sandbox_id == "sandbox-1"
    assert row.vcpu_count == 2
    assert row.metered_duration_ms == 12345


def test_unsupported_provider_contract_is_visible_without_fabricated_execution(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    event = provider_event()
    event.payload["version"] = "unsupported"
    assert ingest(event)["accepted"] == 1
    with sqlite_session_factory() as session:
        assert session.scalar(sa.select(sa.func.count()).select_from(AgentSandboxExecution)) == 0
        row = session.scalars(
            sa.select(AgentSandboxUsageEvent).where(AgentSandboxUsageEvent.source_event_id == event.id)
        ).one()
        assert row.projection_status == "unresolved"
        assert row.projection_error_code == "incomplete_provider_execution"


def business_owner(
    session: Session,
    *,
    binding_id: str | None = None,
    tenant_id: str | None = None,
    sandbox_id: str = "sandbox-1",
) -> AgentWorkspaceBinding:
    tenant_id = tenant_id or str(uuid4())
    app_id, agent_id, workspace_id = (str(uuid4()) for _ in range(3))
    session.add_all(
        [
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="Metering test",
                description="",
                mode="agent",
                enable_site=False,
                enable_api=False,
                max_active_requests=None,
            ),
            Agent(
                id=agent_id, tenant_id=tenant_id, name=str(uuid4()), scope=AgentScope.ROSTER, source=AgentSource.ROSTER
            ),
            AgentWorkspace(
                id=workspace_id,
                tenant_id=tenant_id,
                app_id=app_id,
                owner_type=AgentWorkspaceOwnerType.CONVERSATION,
                owner_id=str(uuid4()),
                owner_scope_key="root",
                backend_workspace_ref=sandbox_id,
            ),
        ]
    )
    binding = AgentWorkspaceBinding(
        id=binding_id or str(uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        agent_id=agent_id,
        workspace_id=workspace_id,
        agent_config_version_id=str(uuid4()),
        agent_config_version_kind=AgentConfigVersionKind.SNAPSHOT,
        backend_binding_ref=sandbox_id,
    )
    session.add(binding)
    session.commit()
    return binding


def owner_metadata(binding: AgentWorkspaceBinding) -> dict[str, JsonValue]:
    return {
        "dify.binding_id": binding.id,
        "dify.tenant_id": binding.tenant_id,
        "dify.agent_id": binding.agent_id,
        "dify.workspace_id": binding.workspace_id,
    }


def test_provider_usage_without_business_rows_remains_metered(sqlite_session_factory: sessionmaker[Session]) -> None:
    ingest(provider_event(metadata={"dify.binding_id": str(uuid4()), "dify.tenant_id": str(uuid4())}))
    row = execution(sqlite_session_factory)
    assert row.quality == "metered"
    assert row.metered_duration_ms == 12345
    assert row.attribution_status == "unresolved"
    assert row.tenant_id is None
    assert row.allocation_id is None


def test_background_attribution_uses_verified_business_chain(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    binding = business_owner(sqlite_session)
    ingest(provider_event(metadata=owner_metadata(binding)))
    row = execution(sqlite_session_factory)
    assert (row.tenant_id, row.app_id, row.agent_id, row.binding_id, row.workspace_id) == (
        binding.tenant_id,
        binding.app_id,
        binding.agent_id,
        binding.id,
        binding.workspace_id,
    )
    assert row.attribution_status == "resolved"
    assert row.allocation_id is None
    with sqlite_session_factory() as session:
        assert (
            session.scalar(
                sa.select(sa.func.count())
                .select_from(AgentSandboxUsageEvent)
                .where(AgentSandboxUsageEvent.event_type == "allocation_registered")
            )
            == 0
        )


def test_duplicate_provider_replay_can_resolve_business_rows_committed_later(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    binding_id, tenant_id = str(uuid4()), str(uuid4())
    event = provider_event(metadata={"dify.binding_id": binding_id, "dify.tenant_id": tenant_id})
    ingest(event)
    assert execution(sqlite_session_factory).attribution_status == "unresolved"
    binding = business_owner(sqlite_session, binding_id=binding_id, tenant_id=tenant_id)
    assert ingest(event)["duplicates"] == 1
    row = execution(sqlite_session_factory)
    assert row.binding_id == binding.id
    assert row.attribution_status == "resolved"
    assert row.metered_duration_ms == 12345


@pytest.mark.parametrize("missing", ["binding", "workspace", "app", "agent"])
def test_deleted_business_rows_do_not_erase_retained_owner_or_usage(
    missing: str, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    binding = business_owner(sqlite_session)
    event = provider_event(metadata=owner_metadata(binding))
    ingest(event)
    if missing == "binding":
        sqlite_session.delete(binding)
    elif missing == "workspace":
        sqlite_session.execute(sa.delete(AgentWorkspace).where(AgentWorkspace.id == binding.workspace_id))
    elif missing == "app":
        sqlite_session.execute(sa.delete(App).where(App.id == binding.app_id))
    else:
        sqlite_session.execute(sa.delete(Agent).where(Agent.id == binding.agent_id))
    sqlite_session.commit()
    assert ingest(event)["duplicates"] == 1
    row = execution(sqlite_session_factory)
    assert (row.binding_id, row.tenant_id) == (binding.id, binding.tenant_id)
    assert row.attribution_status == "resolved"
    assert row.metered_duration_ms == 12345


@pytest.mark.parametrize(
    "broken_link",
    [
        "tenant_metadata",
        "agent_metadata",
        "workspace_metadata",
        "binding_sandbox",
        "workspace_sandbox",
        "app_tenant",
        "agent_tenant",
    ],
)
def test_unverified_business_chain_never_guesses_an_owner(
    broken_link: str, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    binding = business_owner(sqlite_session)
    metadata = owner_metadata(binding)
    if broken_link == "tenant_metadata":
        metadata["dify.tenant_id"] = str(uuid4())
    elif broken_link in {"agent_metadata", "workspace_metadata"}:
        metadata[f"dify.{broken_link.removesuffix('_metadata')}_id"] = str(uuid4())
    elif broken_link == "binding_sandbox":
        binding.backend_binding_ref = "different-sandbox"
    elif broken_link == "workspace_sandbox":
        sqlite_session.execute(
            sa.update(AgentWorkspace)
            .where(AgentWorkspace.id == binding.workspace_id)
            .values(backend_workspace_ref="different-sandbox")
        )
    elif broken_link == "app_tenant":
        sqlite_session.execute(sa.update(App).where(App.id == binding.app_id).values(tenant_id=str(uuid4())))
    else:
        sqlite_session.execute(sa.update(Agent).where(Agent.id == binding.agent_id).values(tenant_id=str(uuid4())))
    sqlite_session.commit()
    ingest(provider_event(metadata=metadata))
    row = execution(sqlite_session_factory)
    assert row.quality == "metered"
    assert row.tenant_id is None
    assert row.attribution_status == "unresolved"


@pytest.mark.parametrize("bad_value", [None, 42, "invalid-uuid"])
def test_bad_attribution_labels_do_not_invalidate_measured_runtime(
    bad_value: JsonValue, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    binding = business_owner(sqlite_session)
    ingest(provider_event(metadata=owner_metadata(binding)))
    changed = owner_metadata(binding)
    changed["dify.tenant_id"] = bad_value
    assert ingest(provider_event(metadata=changed))["accepted"] == 1
    row = execution(sqlite_session_factory)
    assert row.quality == "metered"
    assert row.attribution_status == "resolved"
    assert row.tenant_id == binding.tenant_id
    assert row.metered_duration_ms == 12345


def test_owner_conflict_does_not_reassign_history_or_discard_project_usage(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    first, second = business_owner(sqlite_session), business_owner(sqlite_session)
    ingest(provider_event(metadata=owner_metadata(first)))
    ingest(provider_event(event_id="other-owner", metadata=owner_metadata(second)))
    row = execution(sqlite_session_factory)
    assert row.attribution_status == "conflict"
    assert row.binding_id == first.id
    assert row.tenant_id == first.tenant_id
    assert row.quality == "metered"
    assert row.metered_duration_ms == 12345


def test_same_sandbox_cannot_change_owner_across_executions(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    first, second = business_owner(sqlite_session), business_owner(sqlite_session)
    ingest(provider_event(metadata=owner_metadata(first)))
    resumed = provider_event(event_id="new-execution", execution_id="execution-2", metadata=owner_metadata(second))
    ingest(resumed)
    # A subsequent replay with the original owner cannot erase the conflicting
    # association. Both physical executions remain counted at project level.
    ingest(provider_event(event_id="later-event", execution_id="execution-2", metadata=owner_metadata(first)))
    with sqlite_session_factory() as session:
        rows = list(
            session.scalars(sa.select(AgentSandboxExecution).order_by(AgentSandboxExecution.provider_execution_id))
        )
    assert [(row.attribution_status, row.binding_id) for row in rows] == [
        ("resolved", first.id),
        ("conflict", None),
    ]
    assert [row.quality for row in rows] == ["metered", "metered"]
    assert sum(row.metered_duration_ms or 0 for row in rows) == 24690


@pytest.mark.parametrize("event_type", ["operation_requested", "operation_observed", "allocation_registered"])
def test_application_operations_are_no_longer_accepted(event_type: str) -> None:
    event = SandboxUsageEvent(id="legacy-operation", source="application", type=event_type, payload={})
    with pytest.raises(SandboxUsageError, match="unsupported_application_event"):
        ingest(event)


def test_steady_state_lookup_only_selects_without_locking_activation(sqlite_session: Session) -> None:
    engine = sqlite_session.get_bind()
    assert isinstance(engine, Engine)
    initial = SandboxUsageService.get_state(project_id=PROJECT)
    statements: list[str] = []

    def observe(_connection: Connection, statement: ClauseElement, *_args: object) -> None:
        statements.append(str(statement.compile(dialect=postgresql.dialect())))

    sqlalchemy_event.listen(engine, "before_execute", observe)
    try:
        assert SandboxUsageService.get_state(project_id=PROJECT) == initial
    finally:
        sqlalchemy_event.remove(engine, "before_execute", observe)
    assert statements
    assert all(statement.lstrip().startswith("SELECT") for statement in statements)
    assert all("FOR UPDATE" not in statement for statement in statements)

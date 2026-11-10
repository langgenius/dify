"""Real SQLite owner, update, policy, delivery and lifecycle boundaries."""

import json
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from dify_trace_sdk.provider import SendResult
from sqlalchemy import Table, create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, sessionmaker

from enums.account import TenantAccountRole
from extensions.storage.storage_type import StorageType
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin
from models.agent import WorkflowAgentNodeBinding
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole
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
    ExternalAgentTraceDelivery,
    ExternalAgentTraceReceipt,
    ExternalAgentTraceRecord,
    ExternalAgentTraceStep,
    ExternalAgentTraceTarget,
    ExternalAgentTraceUsageSummary,
    ExternalAgentTracingConfig,
)
from models.model import App, AppMode, Message, TraceAppConfig, UploadFile
from repositories.external_agents.observability_repository import (
    DatabaseExternalObservationAccess,
    ExternalObservabilityRepository,
)
from services.external_agents.contracts import ExternalAgentForbiddenError, ExternalAgentNotFoundError
from services.external_agents.io_contracts import FileScope, JsonObject, StoredFile
from services.external_agents.observability import (
    ExternalObservabilityService,
    MonitoringQuery,
    ObservationAccessDeniedError,
    ObservationConflictError,
    ObservationExpiredError,
    ObservationNotFoundError,
    TraceQuery,
)
from services.external_agents.retention import ExternalDeletionScope, ExternalRetentionService
from services.external_agents.traceability import ReportedCallUsage, TraceabilityNormalizer, TraceLimits
from services.external_agents.tracing_config import ExternalTraceDeliveryService, build_external_trace
from services.rbac.contracts import MyPermissionsResponse, ResourcePermissionKeys, ResourcePermissionSnapshot


def uid() -> str:
    return str(uuid4())


def required[T](value: object, expected_type: type[T]) -> T:
    assert isinstance(value, expected_type)
    return value


def model_table(model: type[TypeBase]) -> Table:
    table = model.__table__
    assert isinstance(table, Table)
    return table


class UnexpectedIO:
    """Fail explicitly if a source/cleanup-only test starts provider/file I/O."""

    def send(
        self,
        *,
        tenant_id: str,
        provider: str,
        encrypted_config: Mapping[str, object],
        trace_payload: Mapping[str, object],
    ) -> SendResult:
        del tenant_id, provider, encrypted_config, trace_payload
        raise AssertionError("Provider I/O was not expected in this test.")

    def remove(self, *, tenant_id: str, file_id: str, storage_key: str | None) -> None:
        del tenant_id, file_id, storage_key
        raise AssertionError("File cleanup was not expected in this test.")

    def materialize(
        self, scope: FileScope, part: JsonObject, *, artifact_id: str, part_index: int, max_bytes: int | None = None
    ) -> StoredFile:
        del scope, part, artifact_id, part_index, max_bytes
        raise AssertionError("File materialization was not expected in this test.")


def test_postgresql_tombstone_owner_comparisons_cast_native_uuid_columns_to_text() -> None:
    statement = select(ExternalAgentInvocation.id).where(~ExternalObservabilityRepository._tombstone_predicate())
    sql = " ".join(str(statement.compile(dialect=postgresql.dialect())).split())
    for column in ("tenant_id", "app_id", "workflow_run_id", "id"):
        assert f"external_agent_data_tombstones.owner_id = CAST(external_agent_invocations.{column} AS VARCHAR)" in sql
    assert (
        "CAST(external_agent_context_slots.conversation_id AS VARCHAR) = external_agent_data_tombstones.owner_id" in sql
    )
    assert "external_agent_data_tombstones.owner_id = external_agent_invocations.context_slot_key" in sql
    assert "CAST(external_agent_data_tombstones.owner_id AS UUID)" not in sql


TENANT, OTHER, AGENT, APP, APP2, ACTOR, NORMAL, EDITOR, REVISION = (uid() for _ in range(9))
NOW = datetime(2026, 11, 9, 12, tzinfo=UTC)
DBNOW = NOW.replace(tzinfo=None)
CONTEXT = RequestContext("req", None, ACTOR, TENANT)


@pytest.fixture
def sessions() -> Iterator[sessionmaker[Session]]:
    engine = create_engine("sqlite://")
    tables = [
        model_table(model)
        for model in (
            TenantAccountJoin,
            Account,
            Tenant,
            App,
            Message,
            TraceAppConfig,
            UploadFile,
            WorkflowAgentNodeBinding,
            ExternalAgentHead,
            ExternalAgentConnectionRevision,
            ExternalAgentInvocation,
            ExternalAgentOperation,
            ExternalAgentVerification,
            ExternalWorkflowBudget,
            ExternalAgentContextSlot,
            ExternalAgentFileLease,
            ExternalAgentCommand,
            ExternalAgentTraceRecord,
            ExternalAgentTraceReceipt,
            ExternalAgentTraceStep,
            ExternalAgentTraceUsageSummary,
            ExternalAgentTracingConfig,
            ExternalAgentTraceTarget,
            ExternalAgentTraceDelivery,
            ExternalAgentDataTombstone,
        )
    ]
    TypeBase.metadata.create_all(engine, tables=tables)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory.begin() as session:
        for actor, role in (
            (ACTOR, TenantAccountRole.OWNER),
            (NORMAL, TenantAccountRole.NORMAL),
            (EDITOR, TenantAccountRole.EDITOR),
        ):
            session.add(TenantAccountJoin(tenant_id=TENANT, account_id=actor, role=role))
        session.add(ExternalAgentHead(agent_id=AGENT, tenant_id=TENANT, active_connection_revision_id=REVISION))
        for identifier in (APP, APP2):
            session.add(
                App(
                    id=identifier,
                    tenant_id=TENANT,
                    name=identifier,
                    mode=AppMode.WORKFLOW,
                    enable_site=False,
                    enable_api=False,
                )
            )
        session.add(
            ExternalAgentConnectionRevision(
                id=REVISION,
                tenant_id=TENANT,
                agent_id=AGENT,
                endpoint="https://agent.example",
                interface_url="https://agent.example",
                auth_type="bearer",
                credential_ciphertext="sealed",
                agent_card={},
                capabilities={},
                fingerprint="f" * 64,
                auth_check="not_exercised",
                created_by=ACTOR,
                verified_at=DBNOW,
            )
        )
    yield factory
    engine.dispose()


class Access:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions

    def role(self, context: RequestContext) -> str | None:
        with self.sessions() as session:
            value = session.scalar(
                select(TenantAccountJoin.role).where(
                    TenantAccountJoin.tenant_id == context.active_workspace_id,
                    TenantAccountJoin.account_id == context.account_id,
                )
            )
            return str(value) if value else None

    def visible_agent_ids(self, context: RequestContext) -> frozenset[str] | None:
        assert context.active_workspace_id == TENANT
        return None


class Permissions:
    allowed = frozenset({APP, APP2})

    def permissions(self, workspace_id: str, account_id: str | None, **_: object) -> MyPermissionsResponse:
        assert workspace_id == TENANT
        assert account_id in {ACTOR, EDITOR, NORMAL}
        return MyPermissionsResponse(
            app=ResourcePermissionSnapshot(
                overrides=[
                    ResourcePermissionKeys(
                        resource_id=identifier,
                        permission_keys=["app.acl.monitor", "app.acl.log_and_annotation", "app.acl.test_and_run"],
                    )
                    for identifier in self.allowed
                ]
            )
        )


class Secrets:
    def values(self, **_: object) -> tuple[str, ...]:
        return ("hidden-token",)


def invocation(sessions: sessionmaker[Session], **changes: object) -> str:
    identifier = uid()
    row = ExternalAgentInvocation(
        id=identifier,
        tenant_id=TENANT,
        agent_id=AGENT,
        request_key=identifier,
        execution_key=identifier,
        origin="production",
        app_id=APP,
        connection_revision_id=REVISION,
        tracing_enabled=True,
        initiator_id=ACTOR,
        started_at=DBNOW,
        dispatched_at=DBNOW,
        ended_at=DBNOW + timedelta(seconds=2),
        local_state="succeeded",
        remote_state="completed",
    )
    for name, value in changes.items():
        assert name in model_table(ExternalAgentInvocation).c
        setattr(row, name, value)
    with sessions.begin() as session:
        session.add(row)
    return identifier


def services(
    sessions: sessionmaker[Session],
) -> tuple[
    ExternalObservabilityRepository,
    ExternalObservabilityService,
    DatabaseExternalObservationAccess,
    Permissions,
]:
    repository = ExternalObservabilityRepository(sessions=sessions, limits=TraceLimits())
    permissions = Permissions()
    access = DatabaseExternalObservationAccess(sessions=sessions, assets=Access(sessions), permissions=permissions)
    return (
        repository,
        ExternalObservabilityService(
            store=repository, access=access, normalizer=TraceabilityNormalizer(TraceLimits()), secrets=Secrets()
        ),
        access,
        permissions,
    )


def test_reference_details_use_monitoring_app_scope_and_reject_normal_demotion(
    sessions: sessionmaker[Session],
) -> None:
    """Reuse actual permission admission; Normal's aggregate never becomes all Apps."""
    _, _, access, permissions = services(sessions)
    permissions.allowed = frozenset({APP})
    context = CONTEXT._replace(account_id=EDITOR, resource_app_ids=frozenset({APP2}))
    assert access.reference_app_ids(context, AGENT) == frozenset()
    assert access.reference_app_ids(CONTEXT._replace(account_id=EDITOR), AGENT) == frozenset({APP})
    with pytest.raises(ExternalAgentForbiddenError):
        access.reference_app_ids(CONTEXT._replace(account_id=NORMAL), AGENT)
    with sessions.begin() as session:
        membership = session.scalars(select(TenantAccountJoin).where(TenantAccountJoin.account_id == EDITOR)).one()
        membership.role = TenantAccountRole.NORMAL
    with pytest.raises(ExternalAgentForbiddenError):
        access.reference_app_ids(CONTEXT._replace(account_id=EDITOR), AGENT)
    with pytest.raises(ExternalAgentNotFoundError):
        access.reference_app_ids(CONTEXT, uid())


def test_record_duplicate_enrichment_conflict_and_owned_read(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions)
    repository, service, _, _ = services(sessions)
    payload = {
        "trace_id": "remote",
        "steps": [
            {
                "step_id": "s",
                "name": "search",
                "start_time": "2026-11-09T12:00:00Z",
                "parameters": {"authorization": "hidden-token"},
            }
        ],
    }
    first = service.record_trace(
        tenant_id=TENANT, invocation_id=identifier, payload=payload, source_id="m", received_at=NOW
    )
    replay = service.record_trace(
        tenant_id=TENANT, invocation_id=identifier, payload=payload, source_id="different-carrier", received_at=NOW
    )
    assert replay.revision == first.revision
    assert len(replay.steps) == 1
    payload["steps"][0]["end_time"] = "2026-11-09T12:00:00.5Z"
    enriched = service.record_trace(
        tenant_id=TENANT, invocation_id=identifier, payload=payload, source_id="m2", received_at=NOW
    )
    assert enriched.steps[0].duration_seconds == 0.5
    payload["steps"][0]["name"] = "conflicting"
    conflicted = service.record_trace(
        tenant_id=TENANT, invocation_id=identifier, payload=payload, source_id="m3", received_at=NOW
    )
    assert conflicted.steps[0].name == "search"
    assert "step_identity_conflict" in conflicted.diagnostics
    page = service.trace(CONTEXT, identifier, TraceQuery(), now=NOW)
    assert page.received_steps == 1
    assert (
        service.raw_data(CONTEXT, identifier, page.steps[0].key, now=NOW)["parameters"]["authorization"] == "[redacted]"
    )
    with pytest.raises(ObservationNotFoundError):
        repository.owner(tenant_id=OTHER, invocation_id=identifier, now=NOW)
    with pytest.raises(ObservationAccessDeniedError):
        service.trace(CONTEXT._replace(account_id=NORMAL), identifier, TraceQuery(), now=NOW)


def test_zero_usage_delta_and_identical_permission_scope(sessions: sessionmaker[Session]) -> None:
    first = invocation(sessions)
    invocation(sessions, app_id=APP2)
    _, service, _, permissions = services(sessions)
    service.record_usage(
        tenant_id=TENANT,
        invocation_id=first,
        usage=ReportedCallUsage(0, "adapter.call.total", "verified-test-profile"),
        revision=1,
        received_at=NOW,
    )
    query = MonitoringQuery(start=NOW - timedelta(days=1), end=NOW + timedelta(days=1))
    normal = service.monitoring(CONTEXT._replace(account_id=NORMAL), AGENT, query, now=NOW)
    assert normal.summary.calls == 2
    assert normal.summary.reported_tokens == 0
    assert normal.summary.token_reporting_coverage == 0.5
    assert normal.apps is None
    permissions.allowed = frozenset({APP})
    editor = service.monitoring(CONTEXT._replace(account_id=EDITOR), AGENT, query, now=NOW)
    assert editor.summary.calls == 1
    assert editor.summary.token_reporting_coverage == 1
    assert editor.apps is not None
    assert {row["id"] for row in editor.apps} == {APP}
    with pytest.raises(ObservationAccessDeniedError):
        service.monitoring(
            CONTEXT._replace(account_id=NORMAL), AGENT, query.model_copy(update={"app_id": APP}), now=NOW
        )
    service.record_usage(
        tenant_id=TENANT,
        invocation_id=first,
        usage=ReportedCallUsage(7, "adapter.call.total", "verified-test-profile"),
        revision=2,
        received_at=NOW,
    )
    after = service.monitoring(CONTEXT, AGENT, query, now=NOW)
    assert after.summary.calls == 1
    assert after.summary.reported_tokens == 7
    with pytest.raises(ObservationConflictError):
        service.record_usage(
            tenant_id=TENANT,
            invocation_id=first,
            usage=ReportedCallUsage(8, "adapter.call.total", "verified-test-profile"),
            revision=2,
            received_at=NOW,
        )


def test_asset_and_app_destinations_freeze_and_payloads_are_idempotent(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions, dispatched_at=None, ended_at=None, local_state="waiting")
    repository, _, access, _ = services(sessions)
    with sessions.begin() as session:
        app = required(session.get(App, APP), App)
        app.tracing = json.dumps(
            {"enabled": True, "tracing_provider": "langfuse", "capture_content": False, "capture_agent": True}
        )
        session.add(
            TraceAppConfig(
                app_id=APP, tracing_provider="langfuse", tracing_config={"host": "app-target"}, is_active=True
            )
        )
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=TENANT,
                agent_id=AGENT,
                provider="langfuse",
                encrypted_config={"host": "asset-target"},
                enabled=True,
                capture_content=True,
            )
        )
    targets = repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    assert len(targets) == 2
    assert all(not target.capture_content for target in targets)
    with sessions.begin() as session:
        config = required(session.scalar(select(ExternalAgentTracingConfig)), ExternalAgentTracingConfig)
        config.encrypted_config = {"host": "new-target"}
        config.revision += 1
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        row.dispatched_at, row.ended_at, row.local_state = DBNOW, DBNOW + timedelta(seconds=1), "succeeded"
    assert repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW) == targets

    class Sender:
        calls = 0

        def send(self, **kwargs: object) -> SendResult:
            assert kwargs["tenant_id"] == TENANT

            self.calls += 1
            return SendResult("accepted", "https://platform.example/trace", {})

    sender = Sender()
    deliveries = ExternalTraceDeliveryService(store=repository, sender=sender, access=access, clock=lambda: NOW)
    assert deliveries.reconcile_sources(now=NOW) == 1
    ids = tuple(status.id for status in deliveries.statuses(CONTEXT, identifier, now=NOW))
    assert len(ids) == 2
    assert set(deliveries.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)) == set(ids)
    for delivery_id in ids:
        deliveries.deliver(tenant_id=TENANT, delivery_id=delivery_id, now=NOW)
        deliveries.deliver(tenant_id=TENANT, delivery_id=delivery_id, now=NOW)
    assert sender.calls == 2
    with sessions() as session:
        assert {row.state for row in session.scalars(select(ExternalAgentTraceDelivery))} == {"accepted"}


def test_export_source_scan_filters_expiry_tombstone_missing_parent_and_unfrozen_before_limit(
    sessions: sessionmaker[Session],
) -> None:
    repository, _, access, _ = services(sessions)
    service = ExternalTraceDeliveryService(store=repository, sender=UnexpectedIO(), access=access, clock=lambda: NOW)
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(), tenant_id=TENANT, agent_id=AGENT, provider="phoenix", enabled=True, encrypted_config={}
            )
        )
    calls = {
        kind: invocation(sessions, dispatched_at=None, ended_at=None, local_state="waiting")
        for kind in ("expired", "tombstoned", "deleted", "orphan", "unfrozen", "live")
    }
    for identifier in calls.values():
        service.freeze(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        for identifier in calls.values():
            row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
            row.dispatched_at, row.ended_at, row.local_state = DBNOW, DBNOW, "succeeded"
        required(
            session.get(ExternalAgentInvocation, calls["expired"]), ExternalAgentInvocation
        ).retention_expires_at = DBNOW
        required(session.get(ExternalAgentInvocation, calls["deleted"]), ExternalAgentInvocation).deleted_at = DBNOW
        required(session.get(ExternalAgentInvocation, calls["orphan"]), ExternalAgentInvocation).app_id = uid()
        required(
            session.get(ExternalAgentTraceRecord, calls["unfrozen"]), ExternalAgentTraceRecord
        ).targets_frozen = False
        session.add(
            ExternalAgentDataTombstone(
                id=uid(), tenant_id=TENANT, owner_kind="invocation", owner_id=calls["tombstoned"], deleted_at=DBNOW
            )
        )
    assert service.reconcile_sources(now=NOW, limit=1) == 1
    assert service.reconcile_sources(now=NOW, limit=1) == 0
    with sessions() as session:
        assert tuple(session.scalars(select(ExternalAgentTraceDelivery.invocation_id))) == (calls["live"],)


def test_empty_target_set_cannot_follow_later_configuration(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions, dispatched_at=None)
    repository, _, _, _ = services(sessions)
    assert not repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=TENANT,
                agent_id=AGENT,
                provider="langfuse",
                encrypted_config={"secret": "new"},
                enabled=True,
            )
        )
    assert not repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)


def test_parent_deletion_blocks_late_data_and_keeps_unresolved_context(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions)
    repository, service, _, _ = services(sessions)
    slot_key, conversation = "s" * 64, uid()
    with sessions.begin() as session:
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        row.context_slot_key = slot_key
        row.asset_snapshot = {"name": "Historical agent"}
        row.runtime_snapshot = {
            "asset_snapshot": row.asset_snapshot,
            "parts": [{"text": "private"}],
            "job": {"secret": "private"},
            "outputs": {"answer": "private"},
            "queries_blocked": True,
            "observation_error_code": "tracking_exhausted",
        }
        session.add(
            ExternalAgentContextSlot(
                key=slot_key,
                tenant_id=TENANT,
                app_id=APP,
                conversation_id=conversation,
                node_id="node",
                agent_id=AGENT,
                connection_revision_id=REVISION,
                binding_epoch="epoch",
                unresolved=True,
                reserved_invocation_id=identifier,
            )
        )
    repository.delete_scope(scope=ExternalDeletionScope(TENANT, "invocation", identifier), now=NOW)
    with sessions() as session:
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        assert row.asset_snapshot == {"name": "Historical agent"}
        assert row.runtime_snapshot["asset_snapshot"] == row.asset_snapshot
        assert row.runtime_snapshot["parts"] == []
        assert row.runtime_snapshot["job"] == {}
        assert row.runtime_snapshot["outputs"] is None
        assert row.runtime_snapshot["queries_blocked"] is True
    with pytest.raises(ObservationNotFoundError):
        service.record_trace(
            tenant_id=TENANT,
            invocation_id=identifier,
            payload={"trace_id": "x", "steps": []},
            source_id="late",
            received_at=NOW,
        )
    with sessions() as session:
        assert required(session.get(ExternalAgentContextSlot, slot_key), ExternalAgentContextSlot).unresolved
    repository.delete_scope(scope=ExternalDeletionScope(TENANT, "conversation", conversation), now=NOW)
    with sessions() as session:
        slot = required(session.get(ExternalAgentContextSlot, slot_key), ExternalAgentContextSlot)
        assert slot.deleted_at is not None
        assert slot.server_context_id is None
        assert not slot.unresolved


def test_expiry_is_fixed_and_does_not_release_context(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions, local_wait_ended_at=DBNOW, remote_state="working", local_state="ended")
    repository, service, _, _ = services(sessions)
    with pytest.raises(ObservationExpiredError):
        service.record_trace(
            tenant_id=TENANT,
            invocation_id=identifier,
            payload={"trace_id": "x", "steps": []},
            source_id="late",
            received_at=NOW + timedelta(hours=24),
        )
    service.record_trace(
        tenant_id=TENANT,
        invocation_id=identifier,
        payload={"trace_id": "x", "steps": []},
        source_id="within",
        received_at=NOW + timedelta(hours=23),
    )
    assert (
        repository.owner(tenant_id=TENANT, invocation_id=identifier, now=NOW + timedelta(days=2)).local_state == "ended"
    )


def test_test_file_cleanup_retries_and_preserves_shared_original(sessions: sessionmaker[Session]) -> None:
    repository, _, _, _ = services(sessions)
    temporary, shared = uid(), uid()
    with sessions.begin() as session:
        for identifier, copy in ((temporary, True), (shared, False)):
            session.add(
                ExternalAgentFileLease(
                    id=uid(),
                    tenant_id=TENANT,
                    owner_id=ACTOR,
                    file_id=identifier,
                    purpose="test_input",
                    expires_at=DBNOW - timedelta(seconds=1),
                    temporary_copy=copy,
                    created_at=DBNOW - timedelta(hours=2),
                )
            )

    class Files:
        fail = True
        removed: list[str] = []

        def remove(self, *, tenant_id: str, file_id: str, storage_key: str | None) -> None:
            assert tenant_id == TENANT
            assert storage_key is None
            if self.fail:
                raise OSError("private storage location")
            self.removed.append(file_id)

    files = Files()
    cleanup = ExternalRetentionService(store=repository, files=files)
    first = cleanup.sweep(now=NOW)
    assert first.files_pending_retry == 1
    assert first.released_file_leases == 1
    files.fail = False
    second = cleanup.sweep(now=NOW + timedelta(seconds=61))
    assert second.files_pending_retry == 0
    assert files.removed == [temporary]


def test_active_credentials_survive_and_old_revision_waits_for_lease(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions, local_wait_ended_at=DBNOW - timedelta(days=2), remote_state="working")
    repository, _, _, _ = services(sessions)
    assert repository.reclaim_credentials(now=NOW, limit=100) == 0
    with sessions.begin() as session:
        required(session.get(ExternalAgentHead, AGENT), ExternalAgentHead).active_connection_revision_id = None
        session.add(
            ExternalAgentCommand(
                id=uid(),
                tenant_id=TENANT,
                invocation_id=identifier,
                command_key="io",
                kind="poll",
                next_run_at=DBNOW,
                state="leased",
                lease_token=uid(),
                lease_until=DBNOW + timedelta(minutes=1),
            )
        )
    assert repository.reclaim_credentials(now=NOW, limit=100) == 0
    assert repository.reclaim_credentials(now=NOW + timedelta(minutes=2), limit=100) == 1
    with sessions() as session:
        assert (
            required(
                session.get(ExternalAgentConnectionRevision, REVISION), ExternalAgentConnectionRevision
            ).credential_ciphertext
            is None
        )


@pytest.mark.parametrize("in_flight", ["command", "file_write"])
def test_workspace_deletion_retires_current_head_and_proofs_but_waits_for_io_to_clear_secret(
    sessions: sessionmaker[Session],
    in_flight: str,
) -> None:
    repository, _, _, _ = services(sessions)
    identifier = invocation(sessions, remote_state="working", ended_at=None)
    other_agent, other_revision, io_id = uid(), uid(), uid()
    proof_ids: dict[str, str] = {}
    operation_ids: dict[str, str] = {}
    with sessions.begin() as session:
        required(session.get(ExternalAgentHead, AGENT), ExternalAgentHead).tracing_enabled = True
        for tenant_id in (TENANT, OTHER):
            tenant = Tenant(name="isolated retention scope")
            tenant.id = tenant_id
            session.add(tenant)
            proof_id, operation_id = uid(), uid()
            proof_ids[tenant_id], operation_ids[tenant_id] = proof_id, operation_id
            session.add(
                ExternalAgentVerification(
                    id=proof_id,
                    tenant_id=tenant_id,
                    actor_id=ACTOR,
                    endpoint="https://agent.example",
                    interface_url="https://agent.example",
                    auth_type="bearer",
                    credential_ciphertext="fresh-proof-secret",
                    auth_check="not_exercised",
                    agent_card={},
                    capabilities={},
                    fingerprint="f" * 64,
                    expires_at=DBNOW + timedelta(minutes=10),
                )
            )
            session.add(
                ExternalAgentOperation(
                    id=operation_id,
                    tenant_id=tenant_id,
                    actor_id=ACTOR,
                    kind="create",
                    idempotency_key="workspace-deletion-proof",
                    fingerprint="f" * 64,
                    resource_id=uid(),
                    result={"saved": True},
                )
            )
        session.add(
            ExternalAgentHead(agent_id=other_agent, tenant_id=OTHER, active_connection_revision_id=other_revision)
        )
        session.add(
            ExternalAgentConnectionRevision(
                id=other_revision,
                tenant_id=OTHER,
                agent_id=other_agent,
                endpoint="https://agent.example",
                interface_url="https://agent.example",
                auth_type="bearer",
                credential_ciphertext="other-workspace-secret",
                agent_card={},
                capabilities={},
                fingerprint="f" * 64,
                auth_check="not_exercised",
                created_by=ACTOR,
                verified_at=DBNOW,
            )
        )
        if in_flight == "command":
            session.add(
                ExternalAgentCommand(
                    id=io_id,
                    tenant_id=TENANT,
                    invocation_id=identifier,
                    command_key="in-flight-query",
                    kind="poll",
                    state="leased",
                    next_run_at=DBNOW,
                    lease_token=uid(),
                    lease_until=DBNOW + timedelta(minutes=5),
                )
            )
        else:
            session.add(
                ExternalAgentFileLease(
                    id=io_id,
                    tenant_id=TENANT,
                    invocation_id=identifier,
                    file_id=uid(),
                    owner_id=ACTOR,
                    purpose="output",
                    expires_at=DBNOW + timedelta(days=1),
                    write_state="planned",
                    write_lease_until=DBNOW + timedelta(minutes=5),
                )
            )
    repository.delete_scope(scope=ExternalDeletionScope(TENANT, "tenant", TENANT), now=NOW)
    repository.delete_scope(scope=ExternalDeletionScope(TENANT, "tenant", TENANT), now=NOW + timedelta(seconds=1))
    assert repository.reclaim_credentials(now=NOW + timedelta(seconds=1), limit=100) == 0
    with sessions.begin() as session:
        if in_flight == "command":
            command = required(session.get(ExternalAgentCommand, io_id), ExternalAgentCommand)
            command.state, command.lease_token, command.lease_until = "done", None, None
        else:
            write = required(session.get(ExternalAgentFileLease, io_id), ExternalAgentFileLease)
            write.write_state, write.write_lease_until = "aborted", None
    # Before the fix the current head stays active after workspace deletion,
    # permanently exempting this secret even after all I/O has drained.
    assert repository.reclaim_credentials(now=NOW + timedelta(seconds=2), limit=100) == 1
    with sessions() as session:
        head = required(session.get(ExternalAgentHead, AGENT), ExternalAgentHead)
        assert head.deleted_at == DBNOW
        assert head.enabled is False
        assert head.tracing_enabled is False
        assert head.row_version == 2
        assert (
            required(
                session.get(ExternalAgentConnectionRevision, REVISION), ExternalAgentConnectionRevision
            ).credential_ciphertext
            is None
        )
        assert session.get(ExternalAgentVerification, proof_ids[TENANT]) is None
        assert session.get(ExternalAgentOperation, operation_ids[TENANT]) is None
        assert required(session.get(ExternalAgentHead, other_agent), ExternalAgentHead).deleted_at is None
        assert required(session.get(ExternalAgentHead, other_agent), ExternalAgentHead).enabled is True
        assert (
            required(
                session.get(ExternalAgentConnectionRevision, other_revision), ExternalAgentConnectionRevision
            ).credential_ciphertext
            == "other-workspace-secret"
        )
        assert (
            required(
                session.get(ExternalAgentVerification, proof_ids[OTHER]), ExternalAgentVerification
            ).credential_ciphertext
            == "fresh-proof-secret"
        )
        assert session.get(ExternalAgentOperation, operation_ids[OTHER]) is not None


def test_retention_limit_does_not_starve_later_commands_or_reclaimable_secrets(sessions: sessionmaker[Session]) -> None:
    first = invocation(
        sessions,
        local_wait_ended_at=DBNOW - timedelta(days=3),
        local_state="timed_out",
        remote_state="working",
        remote_task_id="still-running",
        ended_at=None,
    )
    second = invocation(sessions, local_wait_ended_at=DBNOW - timedelta(days=2))
    old, future = uid(), uid()
    repository, _, _, _ = services(sessions)
    with sessions.begin() as session:
        session.add(
            ExternalAgentCommand(
                id=uid(),
                tenant_id=TENANT,
                invocation_id=second,
                command_key="due",
                kind="poll",
                state="ready",
                next_run_at=DBNOW,
            )
        )
        required(session.get(ExternalAgentHead, AGENT), ExternalAgentHead).active_connection_revision_id = None
        # The oldest revision is still leased; it must not occupy the entire
        # reclaim batch while a later unreferenced revision contains a secret.
        required(session.get(ExternalAgentConnectionRevision, REVISION), ExternalAgentConnectionRevision).created_at = (
            DBNOW - timedelta(days=5)
        )
        session.add(
            ExternalAgentCommand(
                id=uid(),
                tenant_id=TENANT,
                invocation_id=first,
                command_key="leased",
                kind="poll",
                state="leased",
                next_run_at=DBNOW,
                lease_token=uid(),
                lease_until=DBNOW + timedelta(minutes=1),
            )
        )
        for identifier in (old, future):
            session.add(
                ExternalAgentConnectionRevision(
                    id=identifier,
                    tenant_id=TENANT,
                    agent_id=AGENT,
                    endpoint="https://agent.example",
                    interface_url="https://agent.example",
                    auth_type="bearer",
                    credential_ciphertext="sealed",
                    agent_card={},
                    capabilities={},
                    fingerprint="f" * 64,
                    auth_check="not_exercised",
                    created_by=ACTOR,
                    verified_at=DBNOW,
                    created_at=DBNOW,
                )
            )
    assert repository.stop_expired_tracking(now=NOW, limit=1) == 1
    assert repository.reclaim_credentials(now=NOW, limit=1) == 1
    with sessions() as session:
        assert (
            required(
                session.get(ExternalAgentConnectionRevision, REVISION), ExternalAgentConnectionRevision
            ).credential_ciphertext
            == "sealed"
        )
        assert (
            sum(
                required(
                    session.get(ExternalAgentConnectionRevision, key), ExternalAgentConnectionRevision
                ).credential_ciphertext
                is None
                for key in (old, future)
            )
            == 1
        )


def test_expired_and_consumed_verify_proofs_release_secrets_without_affecting_active_connection(
    sessions: sessionmaker[Session],
) -> None:
    identifiers = [uid(), uid(), uid()]
    repository, _, _, _ = services(sessions)
    with sessions.begin() as session:
        for index, identifier in enumerate(identifiers):
            session.add(
                ExternalAgentVerification(
                    id=identifier,
                    tenant_id=TENANT,
                    actor_id=ACTOR,
                    endpoint="https://agent.example",
                    interface_url="https://agent.example",
                    auth_type="bearer",
                    credential_ciphertext="pending-proof-secret",
                    auth_check="not_exercised",
                    agent_card={},
                    capabilities={},
                    fingerprint="f" * 64,
                    expires_at=DBNOW - timedelta(seconds=1) if index == 0 else DBNOW + timedelta(minutes=10),
                    consumed_at=DBNOW if index == 1 else None,
                )
            )
    assert repository.reclaim_credentials(now=NOW, limit=100) == 2
    with sessions() as session:
        assert session.get(ExternalAgentVerification, identifiers[0]) is None
        assert session.get(ExternalAgentVerification, identifiers[1]) is None
        assert (
            required(
                session.get(ExternalAgentVerification, identifiers[2]), ExternalAgentVerification
            ).credential_ciphertext
            == "pending-proof-secret"
        )
        assert (
            required(
                session.get(ExternalAgentConnectionRevision, REVISION), ExternalAgentConnectionRevision
            ).credential_ciphertext
            == "sealed"
        )


def test_production_output_is_not_subject_to_test_24h(sessions: sessionmaker[Session]) -> None:
    identifier = invocation(sessions)
    repository, _, _, _ = services(sessions)
    lease_id = uid()
    with sessions.begin() as session:
        session.add(
            ExternalAgentFileLease(
                id=lease_id,
                tenant_id=TENANT,
                owner_id=ACTOR,
                file_id=uid(),
                invocation_id=identifier,
                purpose="output",
                temporary_copy=True,
                created_at=DBNOW - timedelta(days=5),
                expires_at=DBNOW + timedelta(days=20),
            )
        )
    assert repository.file_cleanup_candidates(now=NOW, limit=100) == ()
    with sessions() as session:
        assert required(session.get(ExternalAgentFileLease, lease_id), ExternalAgentFileLease).released_at is None


def test_confirmed_cancel_waiting_for_retry_preserves_input_until_original_hard_ttl(
    sessions: sessionmaker[Session],
) -> None:
    identifier = invocation(
        sessions,
        origin="overview_test",
        app_id=None,
        remote_state="canceled",
        remote_task_id="canceled-task",
        local_state="retry_pending",
        cancel_state="confirmed",
        ended_at=DBNOW,
        local_wait_ended_at=DBNOW,
    )
    repository, _, _, _ = services(sessions)
    lease_id, file_id = uid(), uid()
    with sessions.begin() as session:
        session.add(
            ExternalAgentFileLease(
                id=lease_id,
                tenant_id=TENANT,
                owner_id=ACTOR,
                file_id=file_id,
                invocation_id=identifier,
                purpose="input",
                temporary_copy=True,
                created_at=DBNOW - timedelta(hours=1),
                expires_at=DBNOW + timedelta(hours=23),
            )
        )
        session.add(
            ExternalAgentCommand(
                id=uid(),
                tenant_id=TENANT,
                invocation_id=identifier,
                command_key="confirmed-cancel-retry",
                kind="retry",
                next_run_at=DBNOW + timedelta(seconds=5),
            )
        )
    # Maintenance falls inside the five-second gap after authoritative cancel.
    assert repository.file_cleanup_candidates(now=NOW + timedelta(seconds=4), limit=100) == ()
    with sessions() as session:
        assert required(session.get(ExternalAgentFileLease, lease_id), ExternalAgentFileLease).released_at is None
    # A stalled handoff never renews the original upload's hard lifetime.
    (expired,) = repository.file_cleanup_candidates(now=NOW + timedelta(hours=23), limit=100)
    assert expired.lease_id == lease_id
    assert expired.temporary_copy


def test_shared_test_input_last_lease_owns_physical_cleanup(sessions: sessionmaker[Session]) -> None:
    first = invocation(sessions, origin="overview_test", app_id=None)
    second = invocation(
        sessions,
        origin="overview_test",
        app_id=None,
        remote_state="working",
        local_state="waiting",
        remote_task_id="remote",
        ended_at=None,
    )
    repository, _, _, _ = services(sessions)
    file_id = uid()
    with sessions.begin() as session:
        for identifier in (first, second):
            session.add(
                ExternalAgentFileLease(
                    id=uid(),
                    tenant_id=TENANT,
                    owner_id=ACTOR,
                    file_id=file_id,
                    invocation_id=identifier,
                    purpose="input",
                    temporary_copy=True,
                    created_at=DBNOW - timedelta(hours=1),
                    expires_at=DBNOW + timedelta(hours=23),
                )
            )
    ready = repository.file_cleanup_candidates(now=NOW, limit=100)
    assert len(ready) == 1
    assert not ready[0].temporary_copy
    repository.complete_file_cleanup(ready[0])
    with sessions.begin() as session:
        required(session.get(ExternalAgentInvocation, second), ExternalAgentInvocation).remote_state = "completed"
    ready = repository.file_cleanup_candidates(now=NOW, limit=100)
    assert len(ready) == 1
    assert ready[0].temporary_copy


def test_planned_upload_intent_survives_cleanup_and_late_put(sessions: sessionmaker[Session]) -> None:
    from repositories.external_agents.observability_repository import DatabaseTemporaryTestFileRemover

    file_id, lease_id = uid(), uid()
    key = f"upload_files/{TENANT}/{file_id}.txt"
    repository, _, _, _ = services(sessions)
    with sessions.begin() as session:
        session.add(
            ExternalAgentFileLease(
                id=lease_id,
                tenant_id=TENANT,
                owner_id=ACTOR,
                file_id=file_id,
                purpose="test_input",
                expires_at=DBNOW - timedelta(seconds=1),
                temporary_copy=True,
                storage_key=key,
                write_state="planned",
                created_at=DBNOW - timedelta(hours=2),
            )
        )

    class Objects:
        values = {key}

        def delete(self, filename: str) -> None:
            self.values.discard(filename)

        def exists(self, filename: str) -> bool:
            return filename in self.values

    objects = Objects()
    service = ExternalRetentionService(
        store=repository, files=DatabaseTemporaryTestFileRemover(sessions=sessions, storage=objects)
    )
    service.sweep(now=NOW)
    assert key not in objects.values
    with sessions() as session:
        lease = required(session.get(ExternalAgentFileLease, lease_id), ExternalAgentFileLease)
        assert lease is not None
        assert lease.released_at is not None
        assert lease.write_state == "planned"
        assert lease.cleanup_after is not None
        assert lease.cleanup_after > DBNOW
    objects.values.add(key)  # a save that finishes after its first cleanup
    service.sweep(now=NOW + timedelta(seconds=61))
    assert key not in objects.values
    with sessions.begin() as session:
        required(session.get(ExternalAgentFileLease, lease_id), ExternalAgentFileLease).write_state = "aborted"
    service.sweep(now=NOW + timedelta(seconds=122))
    with sessions() as session:
        assert session.get(ExternalAgentFileLease, lease_id) is None


@pytest.mark.parametrize(("temporary_copy", "purpose"), [(True, "test_input"), (False, "output")])
def test_revoked_origin_marker_survives_storage_and_shared_grants_until_both_are_gone(
    sessions: sessionmaker[Session],
    temporary_copy: bool,
    purpose: str,
) -> None:
    repository, _, _, _ = services(sessions)
    file_id, origin_id, grant_id = uid(), uid(), uid()
    consumer = invocation(sessions, local_state="waiting", remote_state="working", ended_at=None)
    with sessions.begin() as session:
        upload = UploadFile(
            tenant_id=TENANT,
            storage_type=StorageType.LOCAL,
            key=f"upload_files/{TENANT}/{file_id}.txt",
            name="test.txt",
            size=4,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=ACTOR,
            created_at=DBNOW,
            used=True,
        )
        upload.id = file_id
        session.add(upload)
        session.add(
            ExternalAgentFileLease(
                id=origin_id,
                tenant_id=TENANT,
                file_id=file_id,
                owner_id=ACTOR,
                purpose=purpose,
                expires_at=DBNOW - timedelta(seconds=1),
                temporary_copy=temporary_copy,
                page_session_id="overview-page",
                released_at=DBNOW,
                file_value={"upload_file_id": file_id},
                created_at=DBNOW - timedelta(hours=2),
            )
        )
        session.add(
            ExternalAgentFileLease(
                id=grant_id,
                tenant_id=TENANT,
                file_id=file_id,
                owner_id=ACTOR,
                invocation_id=consumer,
                purpose="input_grant",
                temporary_copy=False,
                expires_at=DBNOW + timedelta(hours=23),
                created_at=DBNOW,
            )
        )
    (candidate,) = repository.file_cleanup_candidates(now=NOW, limit=100)
    assert not candidate.temporary_copy  # shared grant postponed physical deletion
    assert repository.complete_file_cleanup(candidate) is False
    with sessions() as session:
        origin = required(session.get(ExternalAgentFileLease, origin_id), ExternalAgentFileLease)
        assert origin.purpose == purpose
        assert origin.temporary_copy is temporary_copy
        assert origin.page_session_id == "overview-page"
        assert origin.released_at == DBNOW
        assert origin.file_value is None
        assert origin.cleanup_after is not None
        assert origin.cleanup_after > DBNOW
    with sessions.begin() as session:
        session.delete(session.get(UploadFile, file_id))
    assert repository.complete_file_cleanup(candidate) is False  # writer/grant identity still exists
    with sessions.begin() as session:
        required(session.get(ExternalAgentFileLease, grant_id), ExternalAgentFileLease).released_at = DBNOW
    assert repository.complete_file_cleanup(candidate) is True
    with sessions() as session:
        assert session.get(ExternalAgentFileLease, origin_id) is None


def test_composed_conversation_hook_fences_real_owned_data(
    sessions: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from types import SimpleNamespace

    import extensions.ext_application_services as composition
    from services import conversation_service

    identifier = invocation(sessions)
    conversation, slot_key = uid(), "c" * 64
    with sessions.begin() as session:
        required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation).context_slot_key = slot_key
        session.add(
            ExternalAgentContextSlot(
                key=slot_key,
                tenant_id=TENANT,
                app_id=APP,
                conversation_id=conversation,
                node_id="node",
                agent_id=AGENT,
                connection_revision_id=REVISION,
                binding_epoch="e",
                unresolved=True,
            )
        )
    repository, _, _, _ = services(sessions)
    retention = ExternalRetentionService(store=repository, files=UnexpectedIO())
    monkeypatch.setattr(
        composition,
        "application_services",
        lambda: SimpleNamespace(external_agents=SimpleNamespace(retention=retention)),
    )

    def skip_broker_publication(conversation_id: str) -> None:
        del conversation_id

    monkeypatch.setattr(conversation_service.delete_conversation_related_data, "delay", skip_broker_publication)
    conversation_service.ConversationService.enqueue_delete_cleanup(
        tenant_id=TENANT, conversation_id=conversation, retired_workspace_ids=()
    )
    with pytest.raises(ObservationNotFoundError):
        repository.owner(tenant_id=TENANT, invocation_id=identifier, now=NOW)


def test_sql_date_buckets_honor_timezone_and_gap_fill(sessions: sessionmaker[Session]) -> None:
    invocation(sessions, dispatched_at=datetime(2026, 11, 9, 23, 30), started_at=DBNOW, ended_at=DBNOW)
    _, service, _, _ = services(sessions)
    query = MonitoringQuery(start=NOW - timedelta(days=1), end=NOW + timedelta(days=2), timezone="Asia/Shanghai")
    result = service.monitoring(CONTEXT, AGENT, query, now=NOW)
    assert result.summary.calls == 1
    assert result.summary.average_call_duration == 0
    populated = [day for day in result.days if day.metrics.calls]
    assert len(populated) == 1
    assert populated[0].date.isoformat() == "2026-11-10"
    assert any(day.metrics.calls == 0 and day.metrics.reported_tokens is None for day in result.days)


def test_native_message_cleanup_uses_run_link_not_a2a_wire_message_id(sessions: sessionmaker[Session]) -> None:
    parent_message, source_run, other_run = uid(), uid(), uid()
    selected = invocation(sessions, workflow_run_id=source_run, message_id=uid())
    unrelated = invocation(sessions, workflow_run_id=other_run, message_id=parent_message)
    repository, _, _, _ = services(sessions)
    with sessions.begin() as session:
        session.add(
            Message(
                id=parent_message,
                app_id=APP,
                conversation_id=uid(),
                query="q",
                message="[]",
                answer="a",
                from_source=ConversationFromSource.API,
                workflow_run_id=source_run,
            )
        )
    assert repository.delete_scope(scope=ExternalDeletionScope(TENANT, "message", parent_message), now=NOW) == 1
    with pytest.raises(ObservationNotFoundError):
        repository.owner(tenant_id=TENANT, invocation_id=selected, now=NOW)
    assert repository.owner(tenant_id=TENANT, invocation_id=unrelated, now=NOW).id == unrelated


def test_real_provider_codec_has_no_hidden_app_and_never_returns_credentials(sessions: sessionmaker[Session]) -> None:
    from dify_trace_langfuse.provider import LangfuseProvider
    from dify_trace_sdk.testing import RecordingEgress, response

    from repositories.external_agents.observability_repository import ExistingProviderTraceSender
    from services.external_agents.tracing_config import ExternalTracingConfigService
    from services.tracing.provider_configs import ProviderConfigGateway
    from services.tracing.providers import ProviderConfigCodec
    from tests.helpers.unit.services.tracing_ports import InstalledTraceProviders, WorkspaceBoundCipher

    repository, _, access, _ = services(sessions)
    egress = RecordingEgress([response(200, {"data": [{"id": "project"}]}), response(200, b"")], grpc_target=None)
    providers = InstalledTraceProviders(LangfuseProvider)
    codec = ProviderConfigCodec(WorkspaceBoundCipher())
    gateway = ProviderConfigGateway(providers=providers, codec=codec, egress=egress)
    config_service = ExternalTracingConfigService(store=repository, access=access, provider=gateway)
    configured = config_service.save(
        CONTEXT,
        AGENT,
        provider="langfuse",
        config={"host": "https://trace.example", "public_key": "test-public", "secret_key": "test-private"},
        enabled=True,
        capture_content=True,
        expected_revision=0,
        now=NOW,
    )
    assert configured.enabled
    assert {"public_key", "secret_key"} <= set(configured.configured_secrets)
    assert "public_key" not in configured.values
    assert "secret_key" not in configured.values
    assert egress.requests[0].method == "GET"
    assert egress.requests[0].url.endswith("/api/public/projects")
    with sessions() as session:
        stored = required(session.scalar(select(ExternalAgentTracingConfig)), ExternalAgentTracingConfig)
        assert stored.encrypted_config["secret_key"].startswith(f"enc:{TENANT}:")
        assert set(session.scalars(select(App.id))) == {APP, APP2}
    identifier = invocation(sessions, origin="overview_test", app_id=None, dispatched_at=None, ended_at=None)
    sender = ExistingProviderTraceSender(providers=providers, codec=codec, egress=egress)
    delivery = ExternalTraceDeliveryService(store=repository, sender=sender, access=access, clock=lambda: NOW)
    delivery.freeze(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        row = required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation)
        row.dispatched_at, row.ended_at = DBNOW, DBNOW + timedelta(seconds=1)
    (delivery_id,) = delivery.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    delivery.deliver(tenant_id=TENANT, delivery_id=delivery_id, now=NOW)
    assert egress.requests[1].url.endswith("/api/public/otel/v1/traces")
    assert delivery.statuses(CONTEXT, identifier, now=NOW)[0].state == "accepted"


def test_uncertain_delivery_requires_ack_and_reuses_frozen_payload(sessions: sessionmaker[Session]) -> None:
    from dify_trace_sdk.errors import ExportOutcomeUnknownError

    repository, _, access, _ = services(sessions)
    identifier = invocation(sessions, dispatched_at=None)
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=TENANT,
                agent_id=AGENT,
                provider="langfuse",
                enabled=True,
                encrypted_config={"frozen": "original"},
            )
        )

    class Sender:
        seen: list[dict[str, object]] = []

        def send(self, **kwargs: object) -> SendResult:
            self.seen.append(kwargs)
            raise ExportOutcomeUnknownError("sensitive transport details")

    sender = Sender()
    service = ExternalTraceDeliveryService(store=repository, sender=sender, access=access, clock=lambda: NOW)
    service.freeze(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation).dispatched_at = DBNOW
    (delivery_id,) = service.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    service.deliver(tenant_id=TENANT, delivery_id=delivery_id, now=NOW)
    with pytest.raises(ObservationConflictError, match="acknowledge"):
        service.retry(CONTEXT, identifier, delivery_id, acknowledge_possible_duplicates=False, now=NOW)
    service.retry(CONTEXT, identifier, delivery_id, acknowledge_possible_duplicates=True, now=NOW)
    service.deliver(tenant_id=TENANT, delivery_id=delivery_id, now=NOW)
    assert len(sender.seen) == 2
    assert sender.seen[0] == sender.seen[1]
    assert service.statuses(CONTEXT, identifier, now=NOW)[0].error_code == "provider_outcome_unknown"


def test_late_trace_and_zero_usage_create_new_frozen_payload_revision(sessions: sessionmaker[Session]) -> None:
    repository, observations, access, _ = services(sessions)
    identifier = invocation(sessions, dispatched_at=None)
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(),
                tenant_id=TENANT,
                agent_id=AGENT,
                provider="langfuse",
                enabled=True,
                encrypted_config={"frozen": "original"},
            )
        )
    service = ExternalTraceDeliveryService(store=repository, sender=UnexpectedIO(), access=access, clock=lambda: NOW)
    service.freeze(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation).dispatched_at = DBNOW
    original = service.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions() as session:
        frozen = dict(
            required(session.get(ExternalAgentTraceDelivery, original[0]), ExternalAgentTraceDelivery).trace_payload
        )
    observations.record_usage(
        tenant_id=TENANT,
        invocation_id=identifier,
        usage=ReportedCallUsage(0, "profile.total", "verified-adapter"),
        revision=1,
        received_at=NOW,
    )
    revised = service.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    assert original != revised
    with sessions() as session:
        assert (
            required(session.get(ExternalAgentTraceDelivery, original[0]), ExternalAgentTraceDelivery).trace_payload
            == frozen
        )
        payload = required(
            session.get(ExternalAgentTraceDelivery, revised[0]), ExternalAgentTraceDelivery
        ).trace_payload
        assert payload["spans"][0]["attributes"]["a2a.reported_call_total_tokens"] == 0


def test_publication_lease_allows_worker_claim_and_never_replays_stale_export(sessions: sessionmaker[Session]) -> None:
    repository, _, access, _ = services(sessions)
    identifier = invocation(sessions, dispatched_at=None)
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(), tenant_id=TENANT, agent_id=AGENT, provider="langfuse", enabled=True, encrypted_config={}
            )
        )
    service = ExternalTraceDeliveryService(store=repository, sender=UnexpectedIO(), access=access, clock=lambda: NOW)
    service.freeze(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation).dispatched_at = DBNOW
    (delivery_id,) = service.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    assert service.claim_publishable_deliveries(now=NOW) == ((TENANT, delivery_id),)
    assert service.claim_publishable_deliveries(now=NOW) == ()
    claimed = repository.claim_delivery(tenant_id=TENANT, delivery_id=delivery_id, now=NOW)
    assert claimed is not None
    assert service.claim_publishable_deliveries(now=NOW + timedelta(seconds=121)) == ()
    with sessions() as session:
        assert (
            required(session.get(ExternalAgentTraceDelivery, delivery_id), ExternalAgentTraceDelivery).state
            == "uncertain"
        )
    assert (
        repository.claim_delivery(tenant_id=TENANT, delivery_id=delivery_id, now=NOW + timedelta(seconds=122)) is None
    )


def test_unknown_remote_kind_remains_local_without_fabricated_export_kind(sessions: sessionmaker[Session]) -> None:
    repository, observations, _, _ = services(sessions)
    identifier = invocation(sessions, dispatched_at=None)
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(), tenant_id=TENANT, agent_id=AGENT, provider="langfuse", enabled=True, encrypted_config={}
            )
        )
    (target,) = repository.freeze_targets(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation).dispatched_at = DBNOW
    snapshot = observations.record_trace(
        tenant_id=TENANT,
        invocation_id=identifier,
        source_id="message",
        received_at=NOW,
        payload={
            "trace_id": "remote",
            "steps": [
                {
                    "step_id": str(index),
                    "name": f"step-{index}",
                    "call_type": kind,
                    "status": "completed",
                    "start_time": "2026-11-09T12:00:00Z",
                    "end_time": "2026-11-09T12:00:01Z",
                }
                for index, kind in enumerate((None, "HOST", 2))
            ],
        },
    )
    assert len(snapshot.steps) == 3
    trace = build_external_trace(
        repository.owner(tenant_id=TENANT, invocation_id=identifier, now=NOW), snapshot, target
    )
    assert trace is not None
    assert [span.name for span in trace.spans] == ["External Agent invocation", "step-2"]


@pytest.mark.parametrize("expires_during_send", [False, True])
def test_unknown_send_uses_completion_time_and_does_not_offer_safe_retry(
    sessions: sessionmaker[Session],
    expires_during_send: bool,
) -> None:
    repository, _, access, _ = services(sessions)
    identifier = invocation(
        sessions, dispatched_at=None, retention_expires_at=DBNOW + timedelta(seconds=1) if expires_during_send else None
    )
    with sessions.begin() as session:
        session.add(
            ExternalAgentTracingConfig(
                id=uid(), tenant_id=TENANT, agent_id=AGENT, provider="langfuse", enabled=True, encrypted_config={}
            )
        )

    class Sender:
        def send(self, **kwargs: object) -> SendResult:
            assert kwargs["tenant_id"] == TENANT
            raise RuntimeError("could have sent; sensitive transport details")

    service = ExternalTraceDeliveryService(
        store=repository, sender=Sender(), access=access, clock=lambda: NOW + timedelta(seconds=2)
    )
    service.freeze(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    with sessions.begin() as session:
        required(session.get(ExternalAgentInvocation, identifier), ExternalAgentInvocation).dispatched_at = DBNOW
    (delivery_id,) = service.enqueue(tenant_id=TENANT, invocation_id=identifier, now=NOW)
    service.deliver(tenant_id=TENANT, delivery_id=delivery_id, now=NOW)
    with sessions() as session:
        row = required(session.get(ExternalAgentTraceDelivery, delivery_id), ExternalAgentTraceDelivery)
        assert row.state == ("stopped" if expires_during_send else "uncertain")
        assert row.error_code == ("source_deleted_or_expired" if expires_during_send else "provider_outcome_unknown")

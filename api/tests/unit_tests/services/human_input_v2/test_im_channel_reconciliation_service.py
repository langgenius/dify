"""Database-backed behavior tests for Channel-bound reconciliation orchestration."""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider, IMSyncResultType, IMSyncRunStatus
from core.human_input_v2.im_integration.adapters import (
    CredentialTestFailure,
    CredentialTestFailureKind,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    IMCardEventDecoder,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMEventStream,
    IMMessaging,
    IMWebhookHandler,
    ProviderUserId,
)
from core.human_input_v2.shared import AccountId, ContactId, IMSyncRunId, TenantId
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMChannel,
    HumanInputIMIdentity,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.contact import Contact, ContactType
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from services.human_input_v2.im_contact_sync import coordinator as coordinator_module
from services.human_input_v2.im_contact_sync.coordinator import IMChannelReconciliationService
from services.human_input_v2.im_contact_sync.service import IMSyncRunNotFoundError

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000101")
_ACCOUNT_ID = AccountId("00000000-0000-0000-0000-000000000201")
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000301")
_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000401")
_SECOND_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000402")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000501")


def _channel(
    *,
    channel_id: IMChannelId = _CHANNEL_ID,
    config_version: int = 1,
    provider: IMProvider = IMProvider.FEISHU,
) -> IMChannel:
    return IMChannel(
        id=channel_id,
        created_at=_NOW,
        updated_at=_NOW,
        provider=provider,
        provider_tenant_id="provider-tenant-1",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=config_version,
        status=IMChannelStatus.CONNECTED,
    )


class _ContactReader:
    def list_contacts(self, page: int, limit: int) -> tuple[Contact, ...]:
        assert (page, limit) == (1, 500)
        return (
            Contact(
                id=_CONTACT_ID,
                type=ContactType.WORKSPACE,
                name="Reviewer",
                email="reviewer@example.com",
                avatar_file_id=None,
                created_at=_NOW,
            ),
        )

    def get_contact(self, contact_id: ContactId) -> Contact | None:
        if contact_id != _CONTACT_ID:
            return None
        return self.list_contacts(1, 500)[0]


class _DirectoryCapability:
    def __init__(self, result: Directory | DirectoryReadFailure | Exception) -> None:
        self._result = result

    def read_directory(self) -> Directory | DirectoryReadFailure:
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


class _Adapter:
    provider = IMProvider.FEISHU

    def __init__(self, result: Directory | DirectoryReadFailure | Exception) -> None:
        self.directory = _DirectoryCapability(result)
        self.close_calls = 0
        self.close_error: Exception | None = None

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder | None:
        return None

    def test_credentials(self) -> CredentialTestFailure:
        return CredentialTestFailure(CredentialTestFailureKind.UNKNOWN, "not exercised")

    @property
    def messaging(self) -> IMMessaging:
        raise AssertionError("messaging is outside reconciliation")

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging | None:
        return None

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler | None:
        del consumer
        return None

    def create_stream_handler(self, consumer: IMEventConsumer) -> IMEventStream | None:
        del consumer
        return None

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass(frozen=True)
class _ReconciliationContext:
    sessions: sessionmaker[Session]
    channel: IMChannel

    def service(self, adapter: _Adapter) -> IMChannelReconciliationService:
        return IMChannelReconciliationService(
            self.sessions,
            self.channel,
            lambda _channel: adapter,
            lambda _session: _ContactReader(),
            clock=lambda: _NOW,
        )


@pytest.fixture
def reconciliation_context(sqlite_engine: Engine) -> _ReconciliationContext:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    channel = _channel()
    with sessions.begin() as session:
        WorkspaceIMChannelWriter(session, _TENANT_ID, _ACCOUNT_ID).create(channel)
        decision = SQLAlchemyIMControlPlaneRepository(session, channel).create_or_get_active_run(
            sync_run_id=_RUN_ID,
            started_by_account_id=_ACCOUNT_ID,
            now=_NOW,
        )
        assert decision.run is not None
    return _ReconciliationContext(sessions, channel)


def _successful_directory() -> Directory:
    return Directory(
        (
            DirectoryEntry(
                ProviderUserId("provider-user-1"),
                "Reviewer",
                "reviewer@example.com",
            ),
        )
    )


def _create_active_run(
    sessions: sessionmaker[Session],
    channel: IMChannel,
    sync_run_id: IMSyncRunId,
) -> None:
    with sessions.begin() as session:
        decision = SQLAlchemyIMControlPlaneRepository(session, channel).create_or_get_active_run(
            sync_run_id=sync_run_id,
            started_by_account_id=_ACCOUNT_ID,
            now=_NOW,
        )
        assert decision.run is not None


def test_success_atomically_persists_current_state_history_results_and_terminal_run(
    reconciliation_context: _ReconciliationContext,
) -> None:
    adapter = _Adapter(_successful_directory())

    run = reconciliation_context.service(adapter).reconcile(_RUN_ID)

    assert run.status is IMSyncRunStatus.SUCCEEDED
    assert (run.added_count, run.not_matched_count, run.failed_count) == (1, 0, 0)
    assert adapter.close_calls == 1
    with reconciliation_context.sessions() as session:
        identity = session.scalar(sa.select(HumanInputIMIdentity))
        binding = session.scalar(sa.select(HumanInputIMBinding))
        results = session.scalars(sa.select(HumanInputIMSyncResult)).all()
        changes = session.scalars(sa.select(HumanInputIMReconciliationChange)).all()
        assert identity is not None
        assert identity.channel_id == str(_CHANNEL_ID)
        assert binding is not None
        assert binding.channel_id == str(_CHANNEL_ID)
        assert binding.im_identity_id == identity.id
        assert binding.contact_id == str(_CONTACT_ID)
        assert [result.result_type for result in results] == [IMSyncResultType.ADDED]
        assert len(changes) == 2
        assert {change.subject_kind.value for change in changes} == {"identity", "binding"}


@pytest.mark.parametrize(
    "directory_result",
    [DirectoryReadFailure("provider unavailable"), ConnectionError("provider exploded")],
)
def test_directory_failure_persists_safe_terminal_diagnostic_and_always_closes_adapter(
    reconciliation_context: _ReconciliationContext,
    directory_result: DirectoryReadFailure | Exception,
) -> None:
    adapter = _Adapter(directory_result)
    adapter.close_error = RuntimeError("close failed")

    run = reconciliation_context.service(adapter).reconcile(_RUN_ID)

    assert run.status is IMSyncRunStatus.FAILED
    assert run.error_code == "directory_read_failed"
    assert run.failed_count == 1
    assert adapter.close_calls == 1
    with reconciliation_context.sessions() as session:
        result = session.scalar(sa.select(HumanInputIMSyncResult))
        assert result is not None
        assert result.result_type is IMSyncResultType.FAILED
        assert result.reason_code == "directory_read_failed"
        assert result.directory_entry_payload is None
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 0


def test_apply_failure_rolls_back_current_mutations_before_persisting_failure(
    reconciliation_context: _ReconciliationContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = _Adapter(_successful_directory())

    def fail_change_mapping(_change: object) -> None:
        raise RuntimeError("change storage unavailable")

    monkeypatch.setattr(coordinator_module, "reconciliation_change_to_record", fail_change_mapping)
    run = reconciliation_context.service(adapter).reconcile(_RUN_ID)

    assert run.status is IMSyncRunStatus.FAILED
    assert run.error_code == "unexpected_apply_failure"
    with reconciliation_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMReconciliationChange.id))) == 0
        diagnostic = session.scalar(sa.select(HumanInputIMSyncResult))
        assert diagnostic is not None
        assert diagnostic.reason_code == "unexpected_apply_failure"


@pytest.mark.parametrize(
    ("changed_field", "changed_value"),
    [("config_version", 2), ("provider", IMProvider.SLACK)],
)
def test_apply_revalidates_current_channel_revision_and_provider(
    reconciliation_context: _ReconciliationContext,
    changed_field: str,
    changed_value: int | IMProvider,
) -> None:
    with reconciliation_context.sessions.begin() as session:
        record = session.get_one(HumanInputIMChannel, str(_CHANNEL_ID))
        if changed_field == "config_version":
            assert isinstance(changed_value, int)
            record.config_version = changed_value
        else:
            assert isinstance(changed_value, IMProvider)
            record.provider = changed_value
    adapter = _Adapter(_successful_directory())

    run = reconciliation_context.service(adapter).reconcile(_RUN_ID)

    assert run.status is IMSyncRunStatus.FAILED
    assert run.error_code == "stale_revision"
    assert adapter.close_calls == 1
    with reconciliation_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(sa.select(sa.func.count(HumanInputIMBinding.id))) == 0


def test_foreign_channel_run_is_rejected_before_provider_or_current_state_access(
    reconciliation_context: _ReconciliationContext,
) -> None:
    foreign_channel = replace(
        reconciliation_context.channel,
        id=IMChannelId("00000000-0000-0000-0000-000000000399"),
        webhook_id=WebhookId("00000000000000000000000000000002"),
    )
    adapter = _Adapter(_successful_directory())
    service = IMChannelReconciliationService(
        reconciliation_context.sessions,
        foreign_channel,
        lambda _channel: adapter,
        lambda _session: _ContactReader(),
        clock=lambda: _NOW,
    )

    with pytest.raises(IMSyncRunNotFoundError):
        service.reconcile(_RUN_ID)

    assert adapter.close_calls == 0


def test_duplicate_terminal_delivery_is_idempotent_without_provider_reentry(
    reconciliation_context: _ReconciliationContext,
) -> None:
    adapters: list[_Adapter] = []

    def build_adapter(_channel: IMChannel) -> _Adapter:
        adapter = _Adapter(_successful_directory())
        adapters.append(adapter)
        return adapter

    service = IMChannelReconciliationService(
        reconciliation_context.sessions,
        reconciliation_context.channel,
        build_adapter,
        lambda _session: _ContactReader(),
        clock=lambda: _NOW,
    )

    first = service.reconcile(_RUN_ID)
    duplicate = service.reconcile(_RUN_ID)

    assert duplicate == first
    assert len(adapters) == 1
    assert adapters[0].close_calls == 1
    with reconciliation_context.sessions() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncRun.id))) == 1
        assert session.scalar(sa.select(sa.func.count(HumanInputIMSyncResult.id))) == 1
        assert session.scalar(sa.select(sa.func.count(HumanInputIMReconciliationChange.id))) == 2


def test_next_run_replaces_an_absent_identity_binding_and_deletes_the_old_identity(
    reconciliation_context: _ReconciliationContext,
) -> None:
    service = reconciliation_context.service(_Adapter(_successful_directory()))
    assert service.reconcile(_RUN_ID).status is IMSyncRunStatus.SUCCEEDED
    _create_active_run(reconciliation_context.sessions, reconciliation_context.channel, _SECOND_RUN_ID)
    replacement_directory = Directory(
        (
            DirectoryEntry(
                ProviderUserId("provider-user-2"),
                "Replacement Reviewer",
                "reviewer@example.com",
            ),
        )
    )

    run = reconciliation_context.service(_Adapter(replacement_directory)).reconcile(_SECOND_RUN_ID)

    assert run.status is IMSyncRunStatus.SUCCEEDED
    assert (run.added_count, run.removed_count) == (1, 1)
    with reconciliation_context.sessions() as session:
        identities = session.scalars(sa.select(HumanInputIMIdentity)).all()
        binding = session.scalar(sa.select(HumanInputIMBinding))
        changes = session.scalars(
            sa.select(HumanInputIMReconciliationChange).where(
                HumanInputIMReconciliationChange.sync_run_id == str(_SECOND_RUN_ID)
            )
        ).all()
        assert [identity.provider_user_id for identity in identities] == ["provider-user-2"]
        assert binding is not None
        assert binding.im_identity_id == identities[0].id
        assert {change.operation.value for change in changes} == {"create", "replace", "delete"}


def test_credential_failure_persists_a_safe_terminal_result(
    reconciliation_context: _ReconciliationContext,
) -> None:
    def fail_credentials(_channel: IMChannel) -> _Adapter:
        raise coordinator_module.IMCredentialError("sensitive credential failure")

    service = IMChannelReconciliationService(
        reconciliation_context.sessions,
        reconciliation_context.channel,
        fail_credentials,
        lambda _session: _ContactReader(),
        clock=lambda: _NOW,
    )

    run = service.reconcile(_RUN_ID)

    assert run.status is IMSyncRunStatus.FAILED
    assert run.error_code == "directory_read_failed"
    assert "sensitive" not in (run.error_message or "")

"""Service-level PostgreSQL integration tests for Channel configuration owners."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.helper import encrypter
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ConfirmedIMConfiguration,
    EncryptedCredentials,
    IMProviderTestResult,
    IntegrationRevisionToken,
)
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.shared import (
    AccountId,
    DirectoryScope,
    EmailProviderId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from repositories.human_input_v2.email_channel import ResendCandidate, SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_integration import (
    SQLAlchemyIMControlPlaneRepository,
    SQLAlchemyOrganizationIMWriteUnitOfWork,
)
from services.human_input_v2.email_channel_management_service import HumanInputEmailChannelManagementService
from services.human_input_v2.errors import ProviderConfigurationUpdatedError
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from services.human_input_v2.im_integration_management_service import HumanInputIMIntegrationManagementService
from tests.test_containers_integration_tests.controllers.console.helpers import create_console_account_and_tenant

_NOW = datetime(2026, 8, 24, 8)
_LATER = datetime(2026, 8, 24, 9)
_EMAIL_CHANNEL_ID = EmailProviderId("00000000-0000-0000-0000-000000000801")
_IM_CHANNEL_ID = IntegrationId("00000000-0000-0000-0000-000000000802")


class _AcceptingResendGateway:
    def validate(self, candidate: ResendCandidate) -> None:
        assert candidate.api_key

    def send_test(self, candidate: ResendCandidate, recipient: NormalizedEmail) -> None:
        assert candidate.sender_email == recipient


@dataclass(frozen=True, slots=True)
class _IMCredentials:
    provider: IMProvider = IMProvider.SLACK


class _StaticIMProviderPort:
    def available_providers(self) -> tuple[IMProvider, ...]:
        return (IMProvider.SLACK,)

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        assert isinstance(scope, WorkspaceScope)
        assert credentials.provider is IMProvider.SLACK
        return _confirmed_slack_configuration()

    def test(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> IMProviderTestResult:
        assert isinstance(scope, WorkspaceScope)
        assert credentials.provider is IMProvider.SLACK
        return IMProviderTestResult(IMProvider.SLACK, "slack-tenant-1")


def _confirmed_slack_configuration() -> ConfirmedIMConfiguration:
    return ConfirmedIMConfiguration(
        provider=IMProvider.SLACK,
        provider_tenant_id="slack-tenant-1",
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-slack-ciphertext"),
        app_identifier="slack-client-1",
        callback_url=None,
        provider_tenant_display=None,
    )


def _im_repository(
    sessions: sessionmaker[Session],
) -> SQLAlchemyIMControlPlaneRepository:
    def unit_of_work(scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        assert isinstance(scope, WorkspaceScope)
        return SQLAlchemyOrganizationIMWriteUnitOfWork(
            sessions,
            OrganizationIMWriteLock(
                redis_client,
                OrganizationIMWriteScope.for_workspace(scope.id),
                acquisition_timeout_seconds=1,
                lease_seconds=10,
            ),
        )

    return SQLAlchemyIMControlPlaneRepository(sessions, unit_of_work)


def test_email_service_uses_owner_native_snapshot_for_postgresql_cas(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    scope = WorkspaceScope(tenant_id)
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    repository = SQLAlchemyEmailChannelRepository(sessions)
    clock_values = iter((_NOW, _LATER))
    service = HumanInputEmailChannelManagementService(
        repository,
        _AcceptingResendGateway(),
        clock=lambda: next(clock_values),
        id_factory=lambda: str(_EMAIL_CHANNEL_ID),
    )
    monkeypatch.setattr(
        encrypter,
        "encrypt_token",
        lambda tenant_id, api_key: f"{tenant_id}:cipher:{api_key}",
    )
    created = service.create(
        scope,
        AccountId(account.id),
        ResendCandidate(
            sender_email=NormalizedEmail("sender@example.com"),
            sender_name="Dify",
            api_key="resend-api-key",
        ),
    )

    updated = service.update(
        scope,
        created.id,
        created.revision,
        AccountId(account.id),
        ResendCandidate(
            sender_email=NormalizedEmail("updated@example.com"),
            sender_name="Updated Dify",
            api_key="rotated-resend-api-key",
        ),
    )

    assert updated.revision.config_version == 2
    persisted = repository.load(tenant_id)
    assert persisted is not None
    assert persisted.snapshot == updated.revision
    assert persisted.sender_email == NormalizedEmail("updated@example.com")
    with pytest.raises(ProviderConfigurationUpdatedError):
        service.delete(scope, updated.id, created.revision)
    assert repository.load(tenant_id) == persisted


def test_im_service_uses_complete_native_revision_for_postgresql_cas(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    scope = WorkspaceScope(tenant_id)
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    repository = _im_repository(sessions)
    service = HumanInputIMIntegrationManagementService(
        repository,
        _StaticIMProviderPort(),
        clock=lambda: _NOW,
        id_factory=lambda: str(_IM_CHANNEL_ID),
    )
    created = service.create(scope, AccountId(account.id), _IMCredentials())

    rotated = service.update(
        scope,
        created.id,
        created.revision,
        AccountId(account.id),
        _IMCredentials(),
    )

    assert rotated.revision == IntegrationRevisionToken(_IM_CHANNEL_ID, 2)
    persisted = repository.load_current_integration(tenant_id)
    assert persisted is not None
    assert persisted.revision == rotated.revision
    with pytest.raises(ProviderConfigurationUpdatedError):
        service.delete(scope, rotated.id, created.revision)
    persisted_after_stale_delete = repository.load_current_integration(tenant_id)
    assert persisted_after_stale_delete is not None
    assert persisted_after_stale_delete.revision == rotated.revision

"""PostgreSQL contracts for guarded IM configuration, binding, and input loading."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.email_channel import EmailChannelConfiguration
from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ConfigurationTransition,
    ConfirmedIMConfiguration,
    EncryptedCredentials,
    IMBinding,
    IMBindingCommandError,
    IMBindingCommandErrorCode,
    IMControlPlanePersistenceError,
    IMIdentity,
    IMIntegration,
    IMIntegrationAlreadyExistsError,
    IMProviderCredentials,
    IMProviderTestResult,
    IMSyncRun,
    IntegrationDeletion,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    ReconciliationRunRef,
    StaleRevision,
)
from core.human_input_v2.im_provider import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    EmailProviderId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    WorkspaceScope,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import HumanInputIMBinding, HumanInputIMIdentity, HumanInputIMIntegration
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.email_channel.repository import SQLAlchemyEmailChannelRepository
from repositories.human_input_v2.im_integration.mappers import (
    binding_to_record,
    identity_to_record,
    integration_from_record,
    integration_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork
from services.human_input_v2.errors import ProviderConfigurationUpdatedError
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from services.human_input_v2.im_integration_management_service import HumanInputIMIntegrationManagementService
from tests.test_containers_integration_tests.controllers.console.helpers import create_console_account_and_tenant

_NOW = datetime(2026, 8, 11, 8)
_LATER = datetime(2026, 8, 11, 9)
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000201")
_REPLACEMENT_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000202")
_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000301")
_SECONDARY_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000302")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000401")
_SECONDARY_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000402")
_MANAGED_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000701")
_TENANT_REPLACEMENT_ID = IntegrationId("00000000-0000-0000-0000-000000000702")
_CROSS_PROVIDER_REPLACEMENT_ID = IntegrationId("00000000-0000-0000-0000-000000000703")
_UNRELATED_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000704")
_MANAGED_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000711")
_MANAGED_BINDING_ID = IMBindingId("00000000-0000-0000-0000-000000000721")
_UNRELATED_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000712")
_UNRELATED_BINDING_ID = IMBindingId("00000000-0000-0000-0000-000000000722")
_MANAGED_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000731")
_UNRELATED_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000732")
_EMAIL_CONFIGURATION_ID = EmailProviderId("00000000-0000-0000-0000-000000000741")


@dataclass(slots=True)
class _ProviderCredentials:
    provider: IMProvider


class _StaticProviderConfigurationPort:
    def __init__(self, confirmed: ConfirmedIMConfiguration) -> None:
        self.confirmed = confirmed

    def available_providers(self) -> tuple[IMProvider, ...]:
        return (IMProvider.SLACK, IMProvider.FEISHU)

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        assert isinstance(scope, (WorkspaceScope, DeploymentScope))
        assert credentials.provider is self.confirmed.provider
        return self.confirmed

    def test(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> IMProviderTestResult:
        assert isinstance(scope, (WorkspaceScope, DeploymentScope))
        assert credentials.provider is self.confirmed.provider
        return IMProviderTestResult(self.confirmed.provider, self.confirmed.provider_tenant_id)


def _write_unit_of_work(
    sessions: sessionmaker[Session],
    scope: WorkspaceScope | DeploymentScope,
) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
    lock_scope = (
        OrganizationIMWriteScope.for_workspace(scope.id)
        if isinstance(scope, WorkspaceScope)
        else OrganizationIMWriteScope.for_deployment()
    )
    return SQLAlchemyOrganizationIMWriteUnitOfWork(
        sessions,
        OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=1,
            lease_seconds=10,
        ),
    )


def _control_plane_repository(sessions: sessionmaker[Session]) -> SQLAlchemyIMControlPlaneRepository:
    return SQLAlchemyIMControlPlaneRepository(
        sessions,
        lambda scope: _write_unit_of_work(sessions, scope),
    )


def _confirmed_configuration(
    provider: IMProvider,
    provider_tenant_id: str,
    *,
    app_identifier: str,
) -> ConfirmedIMConfiguration:
    if provider not in (IMProvider.SLACK, IMProvider.FEISHU):
        raise ValueError("unsupported test provider")
    return ConfirmedIMConfiguration(
        provider=provider,
        provider_tenant_id=provider_tenant_id,
        encrypted_credentials=EncryptedCredentials(ciphertext=f"opaque-{provider.value}-ciphertext"),
        app_identifier=app_identifier,
        callback_url=f"https://example.test/callback/{provider.value}",
        provider_tenant_display=None,
    )


def _email_configuration(tenant_id: TenantId, account_id: AccountId) -> EmailChannelConfiguration:
    return EmailChannelConfiguration(
        id=_EMAIL_CONFIGURATION_ID,
        tenant_id=tenant_id,
        sender_email=NormalizedEmail("sender@example.com"),
        sender_name="PostgreSQL Sender",
        protected_api_key="cipher-email-key",
        configured_by_account_id=account_id,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _seed_identity_and_binding(
    session: Session,
    *,
    integration_id: IntegrationId,
    provider: IMProvider,
    identity_id: IMIdentityId,
    binding_id: IMBindingId,
    contact_id: ContactId,
) -> None:
    identity = IMIdentity.create(
        identity_id=identity_id,
        integration_id=integration_id,
        provider=provider,
        provider_user_id=f"provider-user-{identity_id}",
        display_name="Provider User",
        email="provider-user@example.com",
        raw_payload={"provider_payload": "diagnostic"},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    binding = IMBinding.create(
        binding_id=binding_id,
        integration_id=integration_id,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(integration_id),
        contact_id=contact_id,
        identity_id=identity_id,
        provider=provider,
        bound_by_account_id=None,
        now=_NOW,
    )
    session.add_all((identity_to_record(identity), binding_to_record(binding)))
    session.commit()


def _assert_current_state_presence(
    sessions: sessionmaker[Session],
    *,
    integration_id: IntegrationId,
    identity_id: IMIdentityId,
    binding_id: IMBindingId,
    present: bool,
) -> None:
    with sessions() as session:
        assert (session.get(HumanInputIMIntegration, str(integration_id)) is not None) is present
        assert (session.get(HumanInputIMIdentity, str(identity_id)) is not None) is present
        assert (session.get(HumanInputIMBinding, str(binding_id)) is not None) is present


def _integration(tenant_id: TenantId | None, integration_id: IntegrationId = _INTEGRATION_ID) -> IMIntegration:
    return IMIntegration.create(
        integration_id=integration_id,
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-feishu-ciphertext"),
        app_identifier="app-1",
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )


def _identity(identity_id: IMIdentityId, integration_id: IntegrationId, provider_user_id: str) -> IMIdentity:
    return IMIdentity.create(
        identity_id=identity_id,
        integration_id=integration_id,
        provider=IMProvider.FEISHU,
        provider_user_id=provider_user_id,
        display_name=provider_user_id,
        email=f"{provider_user_id}@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )


def test_guarded_configuration_cas_and_active_run_matrix_use_postgresql(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    scope = WorkspaceScope(id=tenant_id)
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    initial = _integration(tenant_id)
    db_session_with_containers.add(integration_to_record(initial))
    db_session_with_containers.commit()
    unit_of_work = _write_unit_of_work(sessions, scope)

    with pytest.raises(RuntimeError, match="active"):
        _ = unit_of_work.protected_repository
    with unit_of_work as repository:
        assert repository is unit_of_work.protected_repository
        with pytest.raises(IMIntegrationAlreadyExistsError):
            repository.create_integration(
                _integration(tenant_id, _REPLACEMENT_INTEGRATION_ID), organization_scope=scope
            )
    with pytest.raises(RuntimeError, match="active"):
        _ = unit_of_work.protected_repository

    with sessions() as session:
        current = integration_from_record(session.get_one(HumanInputIMIntegration, str(initial.id)))
    rotation = current.reconfigure(
        expected_revision=current.revision,
        provider_tenant=current.provider_tenant,
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-rotated-ciphertext"),
        app_identifier="app-1",
        configured_by_account_id=AccountId(account.id),
        callback_url=None,
        now=_LATER,
    )
    assert isinstance(rotation, ConfigurationTransition)
    with _write_unit_of_work(sessions, scope) as repository:
        rotated = repository.compare_and_swap_configuration(rotation, organization_scope=scope)
    assert isinstance(rotated, IMIntegration)
    assert rotated.config_version == 2

    with _write_unit_of_work(sessions, scope) as repository:
        stale_rotation = repository.compare_and_swap_configuration(rotation, organization_scope=scope)
        stale_run = repository.create_or_get_active_run(
            IntegrationRevisionToken(initial.id, 1),
            organization_scope=scope,
            sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000501"),
            started_by_account_id=AccountId(account.id),
            now=_NOW,
        )
        created_run = repository.create_or_get_active_run(
            rotated.revision,
            organization_scope=scope,
            sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000502"),
            started_by_account_id=AccountId(account.id),
            now=_NOW,
        )
        existing_run = repository.create_or_get_active_run(
            rotated.revision,
            organization_scope=scope,
            sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000503"),
            started_by_account_id=AccountId(account.id),
            now=_LATER,
        )
    assert isinstance(stale_rotation, StaleRevision)
    assert stale_run.kind is ActiveRunDecisionKind.STALE_REVISION
    assert stale_run.stale_revision is not None
    assert stale_run.stale_revision.actual == rotated.revision
    assert created_run.kind is ActiveRunDecisionKind.CREATED
    assert existing_run.kind is ActiveRunDecisionKind.EXISTING_ACTIVE
    assert existing_run.run == created_run.run

    with _write_unit_of_work(sessions, scope) as repository:
        stale_delete = repository.compare_and_swap_delete(
            IntegrationDeletion(IntegrationRevisionToken(initial.id, 1)),
            organization_scope=scope,
        )
        deleted = repository.compare_and_swap_delete(
            IntegrationDeletion(rotated.revision),
            organization_scope=scope,
        )
    assert isinstance(stale_delete, StaleRevision)
    assert deleted is None

    replacement = _integration(tenant_id, _REPLACEMENT_INTEGRATION_ID)
    with _write_unit_of_work(sessions, scope) as repository:
        created = repository.create_integration(replacement, organization_scope=scope)
    assert created == replacement


def test_deployment_binding_and_input_loading_matrix_use_postgresql(
    db_session_with_containers: Session,
) -> None:
    primary_account, tenant = create_console_account_and_tenant(db_session_with_containers)
    secondary_account = Account(
        name="Secondary Reviewer",
        email="secondary@example.com",
        password="hashed-password",
        password_salt="salt",
        interface_language="en-US",
        timezone="UTC",
    )
    db_session_with_containers.add(secondary_account)
    db_session_with_containers.flush()
    db_session_with_containers.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=secondary_account.id,
            current=True,
            role=TenantAccountRole.NORMAL,
        )
    )
    deployment_integration = _integration(None)
    primary_identity = _identity(_IDENTITY_ID, deployment_integration.id, "provider-user-primary")
    secondary_identity = _identity(_SECONDARY_IDENTITY_ID, deployment_integration.id, "provider-user-secondary")
    primary_contact = Contact.organization_account(
        contact_id=_CONTACT_ID,
        account_id=AccountId(primary_account.id),
        name=primary_account.name,
        email=primary_account.email,
        now=_NOW,
    )
    secondary_contact = Contact.organization_account(
        contact_id=_SECONDARY_CONTACT_ID,
        account_id=AccountId(secondary_account.id),
        name=secondary_account.name,
        email=secondary_account.email,
        now=_NOW,
    )
    run = IMSyncRun.create(
        sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000511"),
        integration_revision=deployment_integration.revision,
        provider=deployment_integration.provider_tenant.provider,
        started_by_account_id=AccountId(primary_account.id),
        now=_NOW,
    )
    db_session_with_containers.add_all(
        (
            integration_to_record(deployment_integration),
            identity_to_record(primary_identity),
            identity_to_record(secondary_identity),
            contact_to_record(primary_contact),
            contact_to_record(secondary_contact),
            sync_run_to_record(run),
        )
    )
    db_session_with_containers.commit()
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    scope = DeploymentScope()
    tenant_id = TenantId(tenant.id)

    with _write_unit_of_work(sessions, scope) as repository:
        assert repository.require_current_integration(scope) == deployment_integration
        organization_binding = repository.create_organization_binding(
            organization_scope=scope,
            integration_id=deployment_integration.id,
            contact_id=primary_contact.id,
            identity_id=primary_identity.id,
            binding_id=IMBindingId("00000000-0000-0000-0000-000000000601"),
            bound_by_account_id=AccountId(primary_account.id),
            now=_NOW,
        )
        workspace_override = repository.set_workspace_override(
            organization_scope=scope,
            tenant_id=tenant_id,
            integration_id=deployment_integration.id,
            contact_id=primary_contact.id,
            identity_id=secondary_identity.id,
            binding_id=IMBindingId("00000000-0000-0000-0000-000000000602"),
            bound_by_account_id=AccountId(primary_account.id),
            now=_NOW,
        )
        view = repository.load_contact_im_binding_view(
            tenant_id=tenant_id,
            integration_id=deployment_integration.id,
            contact_id=primary_contact.id,
        )
        reconciliation_input = repository.load_reconciliation_input(
            ReconciliationRunRef(run.id, run.integration_revision, run.provider),
            (
                DirectoryEntry(
                    ProviderUserId(primary_identity.provider_user_id),
                    primary_identity.display_name,
                    primary_identity.email,
                ),
            ),
            scope,
        )

        with pytest.raises(IMBindingCommandError) as conflict:
            repository.set_workspace_override(
                organization_scope=scope,
                tenant_id=tenant_id,
                integration_id=deployment_integration.id,
                contact_id=secondary_contact.id,
                identity_id=secondary_identity.id,
                binding_id=IMBindingId("00000000-0000-0000-0000-000000000603"),
                bound_by_account_id=AccountId(primary_account.id),
                now=_NOW,
            )

    assert conflict.value.code is IMBindingCommandErrorCode.BINDING_CONFLICT
    assert view.im_bindings == (workspace_override,)
    assert {identity.identity_id for identity in reconciliation_input.current_identities} == {
        primary_identity.id,
        secondary_identity.id,
    }
    assert {binding.binding_id for binding in reconciliation_input.current_bindings} == {
        organization_binding.id,
        workspace_override.id,
    }
    assert reconciliation_input.reconciled_binding_ids == frozenset((organization_binding.id,))
    assert {contact.contact_id for contact in reconciliation_input.contacts_for_email_matching} == {
        primary_contact.id,
        secondary_contact.id,
    }


def test_reconciliation_input_rejects_stale_or_cross_owner_captures(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    scope = WorkspaceScope(id=tenant_id)
    integration = _integration(tenant_id)
    run = IMSyncRun.create(
        sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000521"),
        integration_revision=integration.revision,
        provider=integration.provider_tenant.provider,
        started_by_account_id=AccountId(account.id),
        now=_NOW,
    )
    db_session_with_containers.add_all((integration_to_record(integration), sync_run_to_record(run)))
    db_session_with_containers.commit()
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)

    with _write_unit_of_work(sessions, scope) as repository:
        with pytest.raises(ValueError, match="sync run not found"):
            repository.load_reconciliation_input(
                ReconciliationRunRef(
                    IMSyncRunId("00000000-0000-0000-0000-000000000599"),
                    integration.revision,
                    integration.provider_tenant.provider,
                ),
                (),
                scope,
            )
        with pytest.raises(ValueError, match="capture does not match"):
            repository.load_reconciliation_input(
                ReconciliationRunRef(
                    run.id,
                    IntegrationRevisionToken(integration.id, 2),
                    run.provider,
                ),
                (),
                scope,
            )
        with pytest.raises(ValueError, match="does not own"):
            repository.load_reconciliation_input(
                ReconciliationRunRef(run.id, run.integration_revision, run.provider),
                (),
                WorkspaceScope(id=TenantId("00000000-0000-0000-0000-000000000999")),
            )

    with sessions.begin() as session:
        session.delete(session.get_one(HumanInputIMIntegration, str(integration.id)))
    with _write_unit_of_work(sessions, scope) as repository:
        with pytest.raises(ValueError, match="Integration not found"):
            repository.load_reconciliation_input(
                ReconciliationRunRef(run.id, run.integration_revision, run.provider),
                (),
                scope,
            )


def test_channel_management_lifecycle_uses_postgresql_cas_and_scoped_cleanup(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    unrelated_account, unrelated_tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    unrelated_tenant_id = TenantId(unrelated_tenant.id)
    scope = WorkspaceScope(tenant_id)
    unrelated_scope = WorkspaceScope(unrelated_tenant_id)
    account_id = AccountId(account.id)
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    repository = _control_plane_repository(sessions)
    email_repository = SQLAlchemyEmailChannelRepository(sessions)
    email_configuration = _email_configuration(tenant_id, account_id)
    assert email_repository.create(email_configuration).configuration == email_configuration

    integration_ids = iter((_MANAGED_INTEGRATION_ID, _TENANT_REPLACEMENT_ID, _CROSS_PROVIDER_REPLACEMENT_ID))
    provider_port = _StaticProviderConfigurationPort(
        _confirmed_configuration(IMProvider.SLACK, "slack-tenant-1", app_identifier="slack-client-1")
    )
    service = HumanInputIMIntegrationManagementService(
        repository,
        provider_port,
        clock=lambda: _LATER,
        id_factory=lambda: str(next(integration_ids)),
    )
    created = service.create(scope, account_id, _ProviderCredentials(IMProvider.SLACK))
    assert created.id == _MANAGED_INTEGRATION_ID
    assert created.revision == IntegrationRevisionToken(_MANAGED_INTEGRATION_ID, 1)

    unrelated_port = _StaticProviderConfigurationPort(
        _confirmed_configuration(IMProvider.SLACK, "unrelated-tenant", app_identifier="unrelated-client")
    )
    unrelated_service = HumanInputIMIntegrationManagementService(
        repository,
        unrelated_port,
        clock=lambda: _LATER,
        id_factory=lambda: str(_UNRELATED_INTEGRATION_ID),
    )
    unrelated = unrelated_service.create(
        unrelated_scope,
        AccountId(unrelated_account.id),
        _ProviderCredentials(IMProvider.SLACK),
    )
    assert unrelated.id == _UNRELATED_INTEGRATION_ID

    _seed_identity_and_binding(
        db_session_with_containers,
        integration_id=created.id,
        provider=IMProvider.SLACK,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        contact_id=_MANAGED_CONTACT_ID,
    )
    _seed_identity_and_binding(
        db_session_with_containers,
        integration_id=unrelated.id,
        provider=IMProvider.SLACK,
        identity_id=_UNRELATED_IDENTITY_ID,
        binding_id=_UNRELATED_BINDING_ID,
        contact_id=_UNRELATED_CONTACT_ID,
    )

    rotated = service.update(
        scope,
        created.id,
        created.revision,
        account_id,
        _ProviderCredentials(IMProvider.SLACK),
    )
    assert rotated.id == created.id
    current_after_rotation = repository.load_current_integration(tenant_id)
    assert current_after_rotation is not None
    assert current_after_rotation.config_version == 2
    _assert_current_state_presence(
        sessions,
        integration_id=created.id,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        present=True,
    )

    with pytest.raises(ProviderConfigurationUpdatedError):
        service.delete(scope, rotated.id, created.revision)
    current_after_stale_write = repository.load_current_integration(tenant_id)
    assert current_after_stale_write is not None
    assert current_after_stale_write.revision == IntegrationRevisionToken(rotated.id, 2)

    provider_port.confirmed = _confirmed_configuration(
        IMProvider.SLACK,
        "slack-tenant-2",
        app_identifier="slack-client-2",
    )
    tenant_replacement = service.replace(
        scope,
        rotated.id,
        rotated.revision,
        account_id,
        _ProviderCredentials(IMProvider.SLACK),
    )
    assert tenant_replacement.id == _TENANT_REPLACEMENT_ID
    _assert_current_state_presence(
        sessions,
        integration_id=rotated.id,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        present=False,
    )

    _seed_identity_and_binding(
        db_session_with_containers,
        integration_id=tenant_replacement.id,
        provider=IMProvider.SLACK,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        contact_id=_MANAGED_CONTACT_ID,
    )
    provider_port.confirmed = _confirmed_configuration(
        IMProvider.FEISHU,
        "feishu-tenant",
        app_identifier="feishu-app",
    )
    cross_provider_replacement = service.replace(
        scope,
        tenant_replacement.id,
        tenant_replacement.revision,
        account_id,
        _ProviderCredentials(IMProvider.FEISHU),
    )
    assert cross_provider_replacement.id == _CROSS_PROVIDER_REPLACEMENT_ID
    _assert_current_state_presence(
        sessions,
        integration_id=tenant_replacement.id,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        present=False,
    )

    _seed_identity_and_binding(
        db_session_with_containers,
        integration_id=cross_provider_replacement.id,
        provider=IMProvider.FEISHU,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        contact_id=_MANAGED_CONTACT_ID,
    )
    assert (
        service.delete(
            scope,
            cross_provider_replacement.id,
            cross_provider_replacement.revision,
        )
        == cross_provider_replacement.id
    )
    _assert_current_state_presence(
        sessions,
        integration_id=cross_provider_replacement.id,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        present=False,
    )

    assert email_repository.load(tenant_id) == email_configuration
    assert repository.load_current_integration(tenant_id) is None
    unrelated_after_lifecycle = repository.load_current_integration(unrelated_tenant_id)
    assert unrelated_after_lifecycle is not None
    assert unrelated_after_lifecycle.id == unrelated.id
    _assert_current_state_presence(
        sessions,
        integration_id=unrelated.id,
        identity_id=_UNRELATED_IDENTITY_ID,
        binding_id=_UNRELATED_BINDING_ID,
        present=True,
    )


def test_failed_replacement_rolls_back_configuration_children_and_email(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    unrelated_account, unrelated_tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    unrelated_tenant_id = TenantId(unrelated_tenant.id)
    scope = WorkspaceScope(tenant_id)
    unrelated_scope = WorkspaceScope(unrelated_tenant_id)
    account_id = AccountId(account.id)
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)
    repository = _control_plane_repository(sessions)
    email_repository = SQLAlchemyEmailChannelRepository(sessions)
    email_configuration = _email_configuration(tenant_id, account_id)
    assert email_repository.create(email_configuration).configuration == email_configuration

    primary_ids = iter((_MANAGED_INTEGRATION_ID, _UNRELATED_INTEGRATION_ID))
    provider_port = _StaticProviderConfigurationPort(
        _confirmed_configuration(IMProvider.SLACK, "slack-tenant-1", app_identifier="slack-client-1")
    )
    service = HumanInputIMIntegrationManagementService(
        repository,
        provider_port,
        clock=lambda: _LATER,
        id_factory=lambda: str(next(primary_ids)),
    )
    current = service.create(scope, account_id, _ProviderCredentials(IMProvider.SLACK))

    unrelated_port = _StaticProviderConfigurationPort(
        _confirmed_configuration(IMProvider.SLACK, "unrelated-tenant", app_identifier="unrelated-client")
    )
    unrelated_service = HumanInputIMIntegrationManagementService(
        repository,
        unrelated_port,
        clock=lambda: _LATER,
        id_factory=lambda: str(_UNRELATED_INTEGRATION_ID),
    )
    unrelated = unrelated_service.create(
        unrelated_scope,
        AccountId(unrelated_account.id),
        _ProviderCredentials(IMProvider.SLACK),
    )
    _seed_identity_and_binding(
        db_session_with_containers,
        integration_id=current.id,
        provider=IMProvider.SLACK,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        contact_id=_MANAGED_CONTACT_ID,
    )
    _seed_identity_and_binding(
        db_session_with_containers,
        integration_id=unrelated.id,
        provider=IMProvider.SLACK,
        identity_id=_UNRELATED_IDENTITY_ID,
        binding_id=_UNRELATED_BINDING_ID,
        contact_id=_UNRELATED_CONTACT_ID,
    )

    provider_port.confirmed = _confirmed_configuration(
        IMProvider.FEISHU,
        "feishu-tenant",
        app_identifier="feishu-app",
    )
    with pytest.raises(IMControlPlanePersistenceError) as captured:
        service.replace(
            scope,
            current.id,
            current.revision,
            account_id,
            _ProviderCredentials(IMProvider.FEISHU),
        )
    assert isinstance(captured.value.__cause__, IntegrityError)

    persisted = repository.load_current_integration(tenant_id)
    assert persisted is not None
    assert persisted.id == current.id
    assert persisted.revision == IntegrationRevisionToken(current.id, 1)
    assert email_repository.load(tenant_id) == email_configuration
    _assert_current_state_presence(
        sessions,
        integration_id=current.id,
        identity_id=_MANAGED_IDENTITY_ID,
        binding_id=_MANAGED_BINDING_ID,
        present=True,
    )
    _assert_current_state_presence(
        sessions,
        integration_id=unrelated.id,
        identity_id=_UNRELATED_IDENTITY_ID,
        binding_id=_UNRELATED_BINDING_ID,
        present=True,
    )

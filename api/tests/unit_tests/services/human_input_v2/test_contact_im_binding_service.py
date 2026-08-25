"""SQLite tests for guarded manual IM binding commands."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.entities import HumanInputContactType, IMBindingScope, IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import IMBindingCommandError, IMBindingCommandErrorCode, IMIdentity
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    TenantId,
)
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputContactIdentitySource,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputPlatformContactWorkspaceEntry,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.im_integration.mappers import identity_to_record
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork
from services.human_input_v2.im_contact_sync.binding_service import ContactIMBindingService
from services.human_input_v2.im_contact_sync.errors import IMWriteUnavailableError
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLockUnavailableError

_NOW = datetime(2026, 8, 11, 8)
_INTEGRATION_ID = IntegrationId("integration-1")
_TENANT_ID = TenantId("workspace-1")
_CONTACT_ID = ContactId("contact-1")
_IDENTITY_ID = IMIdentityId("identity-1")


class _OwnedWriteLock:
    def __init__(self) -> None:
        self.held = False

    def __enter__(self) -> _OwnedWriteLock:
        self.held = True
        return self

    def __exit__(self, *_unused: object) -> None:
        self.held = False

    def ensure_owned(self) -> None:
        if not self.held:
            raise RuntimeError("lock is not held")

    def extend(self) -> None:
        self.ensure_owned()


@pytest.fixture
def binding_context(
    sqlite_engine: Engine,
) -> tuple[sessionmaker[Session], _OwnedWriteLock]:
    tables = [
        HumanInputContact.__table__,
        HumanInputPlatformContactWorkspaceEntry.__table__,
        HumanInputIMIntegration.__table__,
        HumanInputIMIdentity.__table__,
        HumanInputIMBinding.__table__,
    ]
    HumanInputIMIntegration.metadata.create_all(sqlite_engine, tables=tables)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    contact = Contact.organization_account(
        contact_id=_CONTACT_ID,
        account_id=AccountId("account-1"),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )
    identity = IMIdentity.create(
        identity_id=_IDENTITY_ID,
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload={},
        last_seen_sync_run_id=None,
        last_seen_at=_NOW,
        now=_NOW,
    )
    with sessions.begin() as session:
        integration = HumanInputIMIntegration(
            provider=IMProvider.FEISHU,
            encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
            tenant_id=None,
            provider_tenant_id="provider-tenant-1",
            app_identifier="app-1",
            status=IMIntegrationStatus.CONFIGURED,
            config_version=1,
        )
        integration.id = str(_INTEGRATION_ID)
        platform_entry = HumanInputPlatformContactWorkspaceEntry(
            tenant_id=str(_TENANT_ID),
            contact_id=str(_CONTACT_ID),
            added_by_account_id="account-admin",
        )
        platform_entry.id = "platform-entry-1"
        session.add_all(
            [
                integration,
                contact_to_record(contact),
                identity_to_record(identity),
                platform_entry,
            ]
        )
    return sessions, _OwnedWriteLock()


def test_organization_binding_create_and_delete_are_scope_guarded(binding_context) -> None:
    sessions, lock = binding_context

    with SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock) as repository:
        binding = repository.create_organization_binding(
            organization_scope=DeploymentScope(),
            integration_id=_INTEGRATION_ID,
            contact_id=_CONTACT_ID,
            identity_id=_IDENTITY_ID,
            binding_id=IMBindingId("binding-organization"),
            bound_by_account_id=AccountId("account-admin"),
            now=_NOW,
        )

    assert binding.scope is IMBindingScope.ORGANIZATION
    assert binding.scope_id == str(_INTEGRATION_ID)
    assert binding.provider is IMProvider.FEISHU
    with SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock) as repository:
        repository.delete_organization_binding(
            organization_scope=DeploymentScope(),
            integration_id=_INTEGRATION_ID,
            contact_id=_CONTACT_ID,
            binding_id=binding.id,
        )

    with sessions() as session:
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0


def test_binding_service_resolves_current_integration_and_returns_contact_projection(binding_context) -> None:
    sessions, lock = binding_context
    service = ContactIMBindingService(
        lambda _scope: SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock),
        binding_id_factory=lambda: IMBindingId("binding-organization"),
        clock=lambda: _NOW,
    )

    contact = service.create_organization_binding(
        organization_scope=DeploymentScope(),
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=AccountId("account-admin"),
    )

    assert contact.id == _CONTACT_ID
    assert contact.type is HumanInputContactType.PLATFORM
    assert contact.name == "Reviewer"
    assert contact.email == "reviewer@example.com"
    assert contact.avatar_file_id is None
    assert [binding.id for binding in contact.im_bindings] == [IMBindingId("binding-organization")]


@pytest.mark.parametrize("command", ["create_organization_binding", "set_workspace_override"])
def test_binding_service_maps_lock_unavailable_to_retryable_application_error(command: str) -> None:
    lock_error = OrganizationIMWriteLockUnavailableError("busy")

    class UnavailableUnitOfWork:
        def __enter__(self):
            raise lock_error

        def __exit__(self, *_unused: object) -> None:
            pass

    service = ContactIMBindingService(lambda _scope: UnavailableUnitOfWork())
    method = getattr(service, command)

    with pytest.raises(RuntimeError) as error_info:
        method(
            organization_scope=DeploymentScope(),
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=_IDENTITY_ID,
            bound_by_account_id=AccountId("account-admin"),
        )

    assert isinstance(error_info.value, IMWriteUnavailableError)
    assert error_info.value.__cause__ is lock_error


def test_organization_binding_rejects_identity_provider_mismatch_without_writing(binding_context) -> None:
    sessions, lock = binding_context
    with sessions.begin() as session:
        identity = session.get_one(HumanInputIMIdentity, str(_IDENTITY_ID))
        identity.provider = IMProvider.SLACK

    with pytest.raises(IMBindingCommandError) as error_info:
        with SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock) as repository:
            repository.create_organization_binding(
                organization_scope=DeploymentScope(),
                integration_id=_INTEGRATION_ID,
                contact_id=_CONTACT_ID,
                identity_id=_IDENTITY_ID,
                binding_id=IMBindingId("binding-invalid-provider"),
                bound_by_account_id=None,
                now=_NOW,
            )
    assert error_info.value.code is IMBindingCommandErrorCode.IDENTITY_NOT_FOUND

    with sessions() as session:
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0


def test_organization_binding_rejects_contact_outside_organization(binding_context) -> None:
    sessions, lock = binding_context
    with sessions.begin() as session:
        contact = session.get_one(HumanInputContact, str(_CONTACT_ID))
        contact.identity_source = HumanInputContactIdentitySource.WORKSPACE_MEMBER
        contact.tenant_id = str(_TENANT_ID)

    with pytest.raises(IMBindingCommandError) as error_info:
        with SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock) as repository:
            repository.create_organization_binding(
                organization_scope=DeploymentScope(),
                integration_id=_INTEGRATION_ID,
                contact_id=_CONTACT_ID,
                identity_id=_IDENTITY_ID,
                binding_id=IMBindingId("binding-invalid-contact"),
                bound_by_account_id=None,
                now=_NOW,
            )
    assert error_info.value.code is IMBindingCommandErrorCode.CONTACT_NOT_FOUND


def test_workspace_override_set_replaces_and_reset_removes_only_workspace_scope(binding_context) -> None:
    sessions, lock = binding_context
    service = ContactIMBindingService(
        lambda _scope: SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock),
        binding_id_factory=iter(
            (
                IMBindingId("binding-organization"),
                IMBindingId("binding-workspace"),
                IMBindingId("binding-unused"),
            )
        ).__next__,
        clock=lambda: _NOW,
    )
    organization_binding = service.create_organization_binding(
        organization_scope=DeploymentScope(),
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=AccountId("account-admin"),
    )
    workspace_binding = service.set_workspace_override(
        organization_scope=DeploymentScope(),
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=AccountId("account-admin"),
    )
    replaced = service.set_workspace_override(
        organization_scope=DeploymentScope(),
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
        identity_id=_IDENTITY_ID,
        bound_by_account_id=AccountId("account-2"),
    )

    assert workspace_binding.im_bindings[0].scope is IMBindingScope.WORKSPACE
    assert workspace_binding.im_bindings[0].scope_id == str(_TENANT_ID)
    assert replaced.im_bindings[0].id == workspace_binding.im_bindings[0].id
    assert replaced.im_bindings[0].bound_by_account_id == AccountId("account-2")

    service.reset_workspace_override(
        organization_scope=DeploymentScope(),
        tenant_id=_TENANT_ID,
        contact_id=_CONTACT_ID,
    )

    with sessions() as session:
        remaining = tuple(session.scalars(select(HumanInputIMBinding)).all())
        assert [record.id for record in remaining] == [str(organization_binding.im_bindings[0].id)]
        assert remaining[0].scope is IMBindingScope.ORGANIZATION


def test_workspace_override_rejects_contact_not_available_in_workspace(binding_context) -> None:
    sessions, lock = binding_context
    with sessions.begin() as session:
        session.delete(session.get_one(HumanInputPlatformContactWorkspaceEntry, "platform-entry-1"))
    service = ContactIMBindingService(
        lambda _scope: SQLAlchemyOrganizationIMWriteUnitOfWork(sessions, lock),
        binding_id_factory=lambda: IMBindingId("binding-workspace"),
        clock=lambda: _NOW,
    )

    with pytest.raises(IMBindingCommandError) as error_info:
        service.set_workspace_override(
            organization_scope=DeploymentScope(),
            tenant_id=_TENANT_ID,
            contact_id=_CONTACT_ID,
            identity_id=_IDENTITY_ID,
            bound_by_account_id=AccountId("account-admin"),
        )
    assert error_info.value.code is IMBindingCommandErrorCode.CONTACT_NOT_FOUND

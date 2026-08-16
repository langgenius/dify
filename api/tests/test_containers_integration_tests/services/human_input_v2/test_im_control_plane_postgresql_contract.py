"""PostgreSQL contracts for guarded IM configuration, binding, and input loading."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ConfigurationTransition,
    EncryptedCredentials,
    IMBindingCommandError,
    IMBindingCommandErrorCode,
    IMIdentity,
    IMIntegration,
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
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import HumanInputIMIntegration
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.im_integration.mappers import (
    identity_to_record,
    integration_from_record,
    integration_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from tests.test_containers_integration_tests.controllers.console.helpers import create_console_account_and_tenant

_NOW = datetime(2026, 8, 11, 8)
_LATER = datetime(2026, 8, 11, 9)
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000201")
_REPLACEMENT_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000202")
_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000301")
_SECONDARY_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000302")
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000401")
_SECONDARY_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000402")


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


def _integration(tenant_id: TenantId | None, integration_id: IntegrationId = _INTEGRATION_ID) -> IMIntegration:
    return IMIntegration.create(
        integration_id=integration_id,
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
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
        with pytest.raises(ValueError, match="already exists"):
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
        encrypted_credentials=EncryptedCredentials.from_mapping({"app_id": "app-1", "encrypted_app_secret": "rotated"}),
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

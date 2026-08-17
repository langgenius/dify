"""PostgreSQL and Redis contracts for Contact Directory persistence."""

from __future__ import annotations

from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import Contact, ContactDirectoryError, ContactRejectionCode
from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    TenantId,
    WorkspaceScope,
)
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import HumanInputContact, HumanInputIMBinding
from models.model import DifySetup
from repositories.human_input_v2.contact_directory.repository import SQLAlchemyContactDirectoryRepository
from repositories.human_input_v2.organization_write_unit_of_work import SQLAlchemyOrganizationWriteUnitOfWork
from services.human_input_v2.im_contact_sync.locking import OrganizationIMWriteLock, OrganizationIMWriteScope
from tests.test_containers_integration_tests.controllers.console.helpers import (
    create_console_account_and_tenant,
    ensure_dify_setup,
)

_NOW = datetime(2026, 8, 11, 8)
_LATER = datetime(2026, 8, 11, 9)
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000101")
_SECONDARY_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000102")
_OTHER_TENANT_ID = TenantId("00000000-0000-0000-0000-000000000901")


def _repository() -> SQLAlchemyContactDirectoryRepository:
    sessions = sessionmaker(bind=db.engine, expire_on_commit=False)

    def create_write_unit_of_work(scope: DirectoryScope) -> SQLAlchemyOrganizationWriteUnitOfWork:
        lock_scope = (
            OrganizationIMWriteScope.for_workspace(scope.id)
            if isinstance(scope, WorkspaceScope)
            else OrganizationIMWriteScope.for_deployment()
        )
        write_lock = OrganizationIMWriteLock(
            redis_client,
            lock_scope,
            acquisition_timeout_seconds=1,
            lease_seconds=10,
        )
        return SQLAlchemyOrganizationWriteUnitOfWork(sessions, write_lock)

    return SQLAlchemyContactDirectoryRepository(sessions, create_write_unit_of_work)


def test_workspace_member_contact_contract_uses_guarded_postgresql_writes(
    db_session_with_containers: Session,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    scope = WorkspaceScope(id=tenant_id)
    repository = _repository()
    contact = Contact.workspace_member(
        contact_id=_CONTACT_ID,
        tenant_id=tenant_id,
        account_id=AccountId(account.id),
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )

    created = repository.save_workspace_member_contact(contact, organization_scope=scope)
    updated = repository.save_workspace_member_contact(
        Contact.workspace_member(
            contact_id=contact.id,
            tenant_id=tenant_id,
            account_id=AccountId(account.id),
            name="Updated Reviewer",
            email="updated@example.com",
            now=_LATER,
        ),
        organization_scope=scope,
    )

    assert created.id == updated.id == contact.id
    assert updated.name == "Updated Reviewer"
    snapshot = repository.load_snapshot(tenant_id)
    assert snapshot.contacts == (updated,)
    assert snapshot.member_account_ids == frozenset((AccountId(account.id),))
    assert snapshot.unavailable_account_ids == frozenset()

    with pytest.raises(ValueError, match="scope does not match"):
        repository.save_workspace_member_contact(
            contact,
            organization_scope=WorkspaceScope(id=_OTHER_TENANT_ID),
        )

    unavailable_account = Account(
        name="Unavailable Reviewer",
        email="unavailable@example.com",
        status=AccountStatus.BANNED,
    )
    db_session_with_containers.add(unavailable_account)
    db_session_with_containers.flush()
    db_session_with_containers.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=unavailable_account.id,
            current=True,
            role=TenantAccountRole.NORMAL,
        )
    )
    db_session_with_containers.commit()
    unavailable_contact = Contact.workspace_member(
        contact_id=_SECONDARY_CONTACT_ID,
        tenant_id=tenant_id,
        account_id=AccountId(unavailable_account.id),
        name=unavailable_account.name,
        email=unavailable_account.email,
        now=_NOW,
    )
    with pytest.raises(ContactDirectoryError) as unavailable:
        repository.save_workspace_member_contact(unavailable_contact, organization_scope=scope)
    assert unavailable.value.code is ContactRejectionCode.ACCOUNT_UNAVAILABLE

    missing_membership_contact = Contact.workspace_member(
        contact_id=ContactId("00000000-0000-0000-0000-000000000103"),
        tenant_id=_OTHER_TENANT_ID,
        account_id=AccountId(account.id),
        name=account.name,
        email=account.email,
        now=_NOW,
    )
    with pytest.raises(ContactDirectoryError) as missing_membership:
        repository.save_workspace_member_contact(
            missing_membership_contact,
            organization_scope=WorkspaceScope(id=_OTHER_TENANT_ID),
        )
    assert missing_membership.value.code is ContactRejectionCode.INVALID_OWNER


def test_deployment_external_and_platform_contracts_use_postgresql(
    db_session_with_containers: Session,
) -> None:
    ensure_dify_setup(db_session_with_containers)
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    repository = _repository()
    organization_contact = Contact.organization_account(
        contact_id=_CONTACT_ID,
        account_id=AccountId(account.id),
        name="Organization Reviewer",
        email="organization@example.com",
        now=_NOW,
    )

    stored_organization = repository.save_organization_contact(
        organization_contact,
        organization_scope=DeploymentScope(),
    )
    repository.set_platform_availability(
        tenant_id,
        stored_organization.id,
        added_by_account_id=AccountId(account.id),
        enabled=True,
    )
    repository.set_platform_availability(
        tenant_id,
        stored_organization.id,
        added_by_account_id=AccountId(account.id),
        enabled=True,
    )
    snapshot = repository.load_snapshot(tenant_id)
    assert snapshot.platform_contact_ids == frozenset((stored_organization.id,))

    with pytest.raises(ContactDirectoryError) as duplicate_email:
        repository.admit_external(
            tenant_id,
            name="Duplicate Reviewer",
            email=" ORGANIZATION@EXAMPLE.COM ",
        )
    assert duplicate_email.value.code is ContactRejectionCode.CONFLICTING_IDENTITY

    external = repository.admit_external(
        tenant_id,
        name="External Reviewer",
        email="external@example.com",
    )
    with pytest.raises(ContactDirectoryError) as invalid_platform_owner:
        repository.set_platform_availability(
            tenant_id,
            external.id,
            added_by_account_id=AccountId(account.id),
            enabled=True,
        )
    assert invalid_platform_owner.value.code is ContactRejectionCode.INVALID_OWNER
    with pytest.raises(ContactDirectoryError) as missing_platform_contact:
        repository.set_platform_availability(
            tenant_id,
            ContactId("00000000-0000-0000-0000-000000000199"),
            added_by_account_id=AccountId(account.id),
            enabled=True,
        )
    assert missing_platform_contact.value.code is ContactRejectionCode.CONTACT_NOT_FOUND

    with pytest.raises(ContactDirectoryError) as wrong_workspace:
        repository.hard_delete_external(_OTHER_TENANT_ID, external.id)
    assert wrong_workspace.value.code is ContactRejectionCode.CONTACT_NOT_FOUND
    repository.hard_delete_external(tenant_id, external.id)
    recreated = repository.admit_external(
        tenant_id,
        name="External Reviewer",
        email="external@example.com",
    )
    assert recreated.id != external.id

    repository.set_platform_availability(
        tenant_id,
        stored_organization.id,
        added_by_account_id=AccountId(account.id),
        enabled=False,
    )
    repository.set_platform_availability(
        tenant_id,
        stored_organization.id,
        added_by_account_id=AccountId(account.id),
        enabled=False,
    )
    assert repository.load_snapshot(tenant_id).platform_contact_ids == frozenset()

    with pytest.raises(ValueError, match="scope does not match"):
        repository.save_organization_contact(
            organization_contact,
            organization_scope=WorkspaceScope(id=tenant_id),
        )
    with pytest.raises(ContactDirectoryError) as invalid_owner:
        repository.save_organization_contact(recreated, organization_scope=DeploymentScope())
    assert invalid_owner.value.code is ContactRejectionCode.INVALID_OWNER


def test_external_hard_delete_removes_all_im_bindings_in_same_postgresql_write(
    db_session_with_containers: Session,
) -> None:
    _account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant_id = TenantId(tenant.id)
    repository = _repository()
    external = repository.admit_external(
        tenant_id,
        name="External Reviewer",
        email="external-delete@example.com",
    )
    organization_binding = HumanInputIMBinding(
        integration_id="00000000-0000-0000-0000-000000000201",
        scope=IMBindingScope.ORGANIZATION,
        scope_id="00000000-0000-0000-0000-000000000201",
        contact_id=str(external.id),
        im_identity_id="00000000-0000-0000-0000-000000000301",
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
    )
    organization_binding.id = "00000000-0000-0000-0000-000000000401"
    workspace_binding = HumanInputIMBinding(
        integration_id="00000000-0000-0000-0000-000000000201",
        scope=IMBindingScope.WORKSPACE,
        scope_id=str(tenant_id),
        contact_id=str(external.id),
        im_identity_id="00000000-0000-0000-0000-000000000302",
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
    )
    workspace_binding.id = "00000000-0000-0000-0000-000000000402"
    db_session_with_containers.add_all((organization_binding, workspace_binding))
    db_session_with_containers.commit()

    repository.hard_delete_external(tenant_id, external.id)

    db_session_with_containers.expire_all()
    assert db_session_with_containers.get(HumanInputContact, str(external.id)) is None
    assert (
        db_session_with_containers.scalar(
            sa.select(sa.func.count(HumanInputIMBinding.id)).where(HumanInputIMBinding.contact_id == str(external.id))
        )
        == 0
    )


def test_deployment_contact_write_fails_closed_without_setup_owner(
    db_session_with_containers: Session,
) -> None:
    account, _tenant = create_console_account_and_tenant(db_session_with_containers)
    db_session_with_containers.execute(sa.delete(DifySetup))
    db_session_with_containers.commit()
    repository = _repository()
    contact = Contact.organization_account(
        contact_id=_CONTACT_ID,
        account_id=AccountId(account.id),
        name=account.name,
        email=account.email,
        now=_NOW,
    )

    with pytest.raises(ContactDirectoryError) as error:
        repository.save_organization_contact(contact, organization_scope=DeploymentScope())
    assert error.value.code is ContactRejectionCode.SETUP_ROW_MISSING

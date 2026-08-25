"""SQLite tests for scope-aware reconciliation input projection."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.entities import IMBindingScope, IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import (
    IMBinding,
    IMIdentity,
    IMSyncRun,
    IntegrationRevisionToken,
    ReconciliationRunRef,
)
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
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncRun,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.im_integration.mappers import (
    binding_to_record,
    identity_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("workspace-1")
_OTHER_TENANT_ID = TenantId("workspace-2")
_INTEGRATION_ID = IntegrationId("integration-1")


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
def loader_context(sqlite_engine: Engine) -> tuple[sessionmaker[Session], _OwnedWriteLock, ReconciliationRunRef]:
    return _create_loader_context(sqlite_engine, owner_tenant_id=str(_TENANT_ID))


@pytest.fixture
def deployment_loader_context(
    sqlite_engine: Engine,
) -> tuple[sessionmaker[Session], _OwnedWriteLock, ReconciliationRunRef]:
    return _create_loader_context(sqlite_engine, owner_tenant_id=None)


def _create_loader_context(
    sqlite_engine: Engine,
    *,
    owner_tenant_id: str | None,
) -> tuple[sessionmaker[Session], _OwnedWriteLock, ReconciliationRunRef]:
    tables = [
        Account.__table__,
        TenantAccountJoin.__table__,
        HumanInputContact.__table__,
        HumanInputIMIntegration.__table__,
        HumanInputIMIdentity.__table__,
        HumanInputIMBinding.__table__,
        HumanInputIMSyncRun.__table__,
    ]
    HumanInputIMIntegration.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    run = ReconciliationRunRef(
        IMSyncRunId("run-1"),
        IntegrationRevisionToken(_INTEGRATION_ID, 1),
        IMProvider.FEISHU,
    )
    sync_run = IMSyncRun.create(
        sync_run_id=run.sync_run_id,
        integration_revision=run.integration_revision,
        provider=run.provider,
        started_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        integration = HumanInputIMIntegration(
            provider=IMProvider.FEISHU,
            encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
            tenant_id=owner_tenant_id,
            provider_tenant_id="provider-tenant-1",
            app_identifier="app-1",
            status=IMIntegrationStatus.CONFIGURED,
            config_version=1,
        )
        integration.id = str(_INTEGRATION_ID)
        session.add(integration)
        session.add(sync_run_to_record(sync_run))
    return session_maker, _OwnedWriteLock(), run


def _account(account_id: str, *, status: AccountStatus = AccountStatus.ACTIVE) -> Account:
    account = Account(name=account_id, email=f"{account_id}@example.com", status=status)
    account.id = account_id
    return account


def _identity(
    identity_id: str, provider_user_id: str, *, integration_id: IntegrationId = _INTEGRATION_ID
) -> IMIdentity:
    return IMIdentity.create(
        identity_id=IMIdentityId(identity_id),
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


def test_workspace_projection_rejects_scope_that_does_not_own_integration(loader_context) -> None:
    session_maker, lock, run = loader_context

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        with pytest.raises(ValueError, match="Contact scope does not own IM Integration"):
            repository.load_reconciliation_input(run, (), WorkspaceScope(id=_OTHER_TENANT_ID))


def test_run_capture_mismatch_fails_before_loading_reconciliation_snapshots(
    sqlite_engine: Engine,
    loader_context,
) -> None:
    session_maker, lock, run = loader_context
    mismatched_run = ReconciliationRunRef(
        run.sync_run_id,
        IntegrationRevisionToken(run.integration_revision.integration_id, 2),
        run.provider,
    )
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
            with pytest.raises(ValueError, match="sync run capture does not match reconciliation input"):
                repository.load_reconciliation_input(mismatched_run, (), WorkspaceScope(id=_TENANT_ID))
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    executed_sql = "\n".join(statements).lower()
    assert "human_input_im_sync_runs" in executed_sql
    assert "human_input_im_integrations" not in executed_sql
    assert "human_input_im_identities" not in executed_sql
    assert "human_input_im_bindings" not in executed_sql
    assert "human_input_contacts" not in executed_sql


def test_empty_identity_namespace_does_not_load_unreferenced_bindings(
    sqlite_engine: Engine,
    loader_context,
) -> None:
    session_maker, lock, run = loader_context
    unrelated_binding = IMBinding.create(
        binding_id=IMBindingId("binding-unrelated"),
        integration_id=IntegrationId("integration-other"),
        scope=IMBindingScope.ORGANIZATION,
        scope_id="integration-other",
        contact_id=ContactId("contact-unrelated"),
        identity_id=IMIdentityId("identity-unrelated"),
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(binding_to_record(unrelated_binding))
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
            reconciliation_input = repository.load_reconciliation_input(run, (), WorkspaceScope(id=_TENANT_ID))
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert reconciliation_input.current_identities == ()
    assert reconciliation_input.current_bindings == ()
    assert reconciliation_input.reconciled_binding_ids == frozenset()
    assert all("FOR UPDATE" not in statement.upper() for statement in statements)


def test_deployment_projection_loads_only_active_organization_account_contacts(deployment_loader_context) -> None:
    session_maker, lock, run = deployment_loader_context
    active_contact = Contact.organization_account(
        contact_id=ContactId("contact-active-organization"),
        account_id=AccountId("account-active-organization"),
        name="Active Organization",
        email="active-organization@example.com",
        now=_NOW,
    )
    banned_contact = Contact.organization_account(
        contact_id=ContactId("contact-banned-organization"),
        account_id=AccountId("account-banned-organization"),
        name="Banned Organization",
        email="banned-organization@example.com",
        now=_NOW,
    )
    orphan_contact = Contact.organization_account(
        contact_id=ContactId("contact-orphan-organization"),
        account_id=AccountId("account-missing"),
        name="Orphan Organization",
        email="orphan-organization@example.com",
        now=_NOW,
    )
    workspace_contact = Contact.workspace_member(
        contact_id=ContactId("contact-workspace"),
        tenant_id=_TENANT_ID,
        account_id=AccountId("account-workspace"),
        name="Workspace",
        email="workspace@example.com",
        now=_NOW,
    )
    external_contact = Contact.external(
        contact_id=ContactId("contact-external"),
        tenant_id=_TENANT_ID,
        name="External",
        email="external@example.com",
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add_all(
            [
                _account("account-active-organization"),
                _account("account-banned-organization", status=AccountStatus.BANNED),
                _account("account-workspace"),
            ]
        )
        session.add_all(
            [
                contact_to_record(active_contact),
                contact_to_record(banned_contact),
                contact_to_record(orphan_contact),
                contact_to_record(workspace_contact),
                contact_to_record(external_contact),
            ]
        )

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        reconciliation_input = repository.load_reconciliation_input(run, (), DeploymentScope())

    assert {contact.contact_id for contact in reconciliation_input.contacts_for_email_matching} == {active_contact.id}


def test_workspace_projection_loads_complete_namespace_and_only_active_member_contacts(loader_context) -> None:
    session_maker, lock, run = loader_context
    bound_identity = _identity("identity-bound", "provider-bound")
    unbound_identity = _identity("identity-unbound", "provider-unbound")
    other_identity = _identity(
        "identity-other-integration",
        "provider-other",
        integration_id=IntegrationId("integration-other"),
    )
    organization_binding = IMBinding.create(
        binding_id=IMBindingId("binding-organization"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(_INTEGRATION_ID),
        contact_id=ContactId("contact-active"),
        identity_id=bound_identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    workspace_override = IMBinding.create(
        binding_id=IMBindingId("binding-override"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.WORKSPACE,
        scope_id=str(_TENANT_ID),
        contact_id=ContactId("contact-active"),
        identity_id=bound_identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    other_integration_binding = IMBinding.create(
        binding_id=IMBindingId("binding-other-integration"),
        integration_id=IntegrationId("integration-other"),
        scope=IMBindingScope.ORGANIZATION,
        scope_id="integration-other",
        contact_id=ContactId("contact-other-integration"),
        identity_id=other_identity.id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    active_contact = Contact.workspace_member(
        contact_id=ContactId("contact-active"),
        tenant_id=_TENANT_ID,
        account_id=AccountId("account-active"),
        name="Active",
        email="active@example.com",
        now=_NOW,
    )
    banned_contact = Contact.workspace_member(
        contact_id=ContactId("contact-banned"),
        tenant_id=_TENANT_ID,
        account_id=AccountId("account-banned"),
        name="Banned",
        email="banned@example.com",
        now=_NOW,
    )
    stale_member_contact = Contact.workspace_member(
        contact_id=ContactId("contact-stale-member"),
        tenant_id=_TENANT_ID,
        account_id=AccountId("account-stale-member"),
        name="Stale Member",
        email="stale-member@example.com",
        now=_NOW,
    )
    other_workspace_contact = Contact.workspace_member(
        contact_id=ContactId("contact-other-workspace"),
        tenant_id=_OTHER_TENANT_ID,
        account_id=AccountId("account-other-workspace"),
        name="Other Workspace",
        email="other-workspace@example.com",
        now=_NOW,
    )
    external_contact = Contact.external(
        contact_id=ContactId("contact-external"),
        tenant_id=_TENANT_ID,
        name="External",
        email="external@example.com",
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add_all(
            [
                _account("account-active"),
                _account("account-banned", status=AccountStatus.BANNED),
                _account("account-stale-member"),
                _account("account-other-workspace"),
            ]
        )
        session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=str(_TENANT_ID),
                    account_id="account-active",
                    role=TenantAccountRole.NORMAL,
                    current=False,
                ),
                TenantAccountJoin(
                    tenant_id=str(_TENANT_ID),
                    account_id="account-banned",
                    role=TenantAccountRole.NORMAL,
                ),
                TenantAccountJoin(
                    tenant_id=str(_OTHER_TENANT_ID),
                    account_id="account-other-workspace",
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
        session.add_all(
            [
                contact_to_record(active_contact),
                contact_to_record(banned_contact),
                contact_to_record(stale_member_contact),
                contact_to_record(other_workspace_contact),
                contact_to_record(external_contact),
            ]
        )
        session.add_all(
            [
                identity_to_record(bound_identity),
                identity_to_record(unbound_identity),
                identity_to_record(other_identity),
                binding_to_record(organization_binding),
                binding_to_record(workspace_override),
                binding_to_record(other_integration_binding),
            ]
        )

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        reconciliation_input = repository.load_reconciliation_input(run, (), WorkspaceScope(id=_TENANT_ID))

    assert {identity.identity_id for identity in reconciliation_input.current_identities} == {
        bound_identity.id,
        unbound_identity.id,
    }
    assert {binding.binding_id for binding in reconciliation_input.current_bindings} == {
        organization_binding.id,
        workspace_override.id,
    }
    assert reconciliation_input.reconciled_binding_ids == frozenset((organization_binding.id,))
    assert {contact.contact_id for contact in reconciliation_input.contacts_for_email_matching} == {active_contact.id}

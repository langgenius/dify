"""Contract tests for the SQLAlchemy Contact Directory adapter."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from unittest.mock import MagicMock

import pytest
import sqlalchemy as sa
from sqlalchemy import event, select
from sqlalchemy.dialects import mysql, postgresql
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import (
    Contact,
    ContactDirectoryError,
    ContactDirectoryPolicy,
    ContactIdentitySource,
    ContactRejectionCode,
    ContactResolution,
    ExternalContactOwner,
    PlatformWorkspaceEntry,
    WorkspaceMemberOwner,
)
from core.human_input_v2.entities import IMBindingScope, IMProvider
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    DeploymentScope,
    DirectoryScope,
    PlatformEntryId,
    TenantId,
    WorkspaceScope,
)
from models.account import Account, AccountStatus, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import HumanInputContact, HumanInputIMBinding, HumanInputPlatformContactWorkspaceEntry
from models.model import DifySetup
from repositories.human_input_v2.contact_directory.repository import SQLAlchemyContactDirectoryRepository
from repositories.human_input_v2.organization_write_unit_of_work import SQLAlchemyOrganizationWriteUnitOfWork

_NOW = datetime(2026, 7, 25)
_TENANT_ID = TenantId("workspace-1")
_OTHER_TENANT_ID = TenantId("workspace-2")


class _RecordingOwnedWriteLock:
    def __init__(self, factory: _RecordingWriteUnitOfWorkFactory) -> None:
        self._factory = factory

    def __enter__(self) -> _RecordingOwnedWriteLock:
        self._factory.active = True
        return self

    def __exit__(self, *_unused: object) -> None:
        self._factory.active = False

    def ensure_owned(self) -> None:
        if not self._factory.active:
            raise RuntimeError("lock is not held")

    def extend(self) -> None:
        self.ensure_owned()


class _RecordingWriteUnitOfWorkFactory:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker
        self.scopes: list[DirectoryScope] = []
        self.active = False

    def __call__(self, scope: DirectoryScope) -> SQLAlchemyOrganizationWriteUnitOfWork:
        self.scopes.append(scope)
        return SQLAlchemyOrganizationWriteUnitOfWork(self._session_maker, _RecordingOwnedWriteLock(self))


@pytest.fixture
def repository_context(
    sqlite_engine: Engine,
) -> Iterator[tuple[SQLAlchemyContactDirectoryRepository, sessionmaker[Session]]]:
    tables = [
        DifySetup.__table__,
        Account.__table__,
        TenantAccountJoin.__table__,
        HumanInputContact.__table__,
        HumanInputIMBinding.__table__,
        HumanInputPlatformContactWorkspaceEntry.__table__,
    ]
    DifySetup.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with session_maker.begin() as session:
        session.add(DifySetup(version="test-version"))
    write_unit_of_work_factory = _RecordingWriteUnitOfWorkFactory(session_maker)
    return SQLAlchemyContactDirectoryRepository(session_maker, write_unit_of_work_factory), session_maker


def _account(account_id: str, *, status: AccountStatus = AccountStatus.ACTIVE) -> Account:
    account = Account(name=account_id, email=f"{account_id}@example.com", status=status)
    account.id = account_id
    return account


def _organization_contact(contact_id: str, account_id: str, email: str | None) -> Contact:
    return Contact.organization_account(
        contact_id=ContactId(contact_id),
        account_id=AccountId(account_id),
        name=account_id,
        email=email,
        now=_NOW,
    )


def _workspace_member_contact(contact_id: str, tenant_id: TenantId, account_id: str) -> Contact:
    return Contact.workspace_member(
        contact_id=ContactId(contact_id),
        tenant_id=tenant_id,
        account_id=AccountId(account_id),
        name=account_id,
        email=f"{account_id}@example.com",
        now=_NOW,
    )


def _save_organization_contact(repository: SQLAlchemyContactDirectoryRepository, contact: Contact) -> Contact:
    return repository.save_organization_contact(contact, organization_scope=DeploymentScope())


def _save_workspace_member_contact(repository: SQLAlchemyContactDirectoryRepository, contact: Contact) -> Contact:
    if not isinstance(contact.owner, (ExternalContactOwner, WorkspaceMemberOwner)):
        raise TypeError("test Contact owner does not have a workspace scope")
    return repository.save_workspace_member_contact(
        contact,
        organization_scope=WorkspaceScope(id=contact.owner.tenant_id),
    )


def test_account_backed_writes_enter_the_explicit_owner_guard_before_sql(sqlite_engine: Engine) -> None:
    tables = [
        DifySetup.__table__,
        Account.__table__,
        TenantAccountJoin.__table__,
        HumanInputContact.__table__,
    ]
    DifySetup.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with session_maker.begin() as session:
        session.add(DifySetup(version="test-version"))
        session.add_all([_account("organization-account"), _account("workspace-account")])
        session.add(
            TenantAccountJoin(
                tenant_id=str(_TENANT_ID),
                account_id="workspace-account",
                role=TenantAccountRole.NORMAL,
            )
        )
    write_unit_of_work_factory = _RecordingWriteUnitOfWorkFactory(session_maker)
    repository = SQLAlchemyContactDirectoryRepository(session_maker, write_unit_of_work_factory)

    def assert_guarded(_connection, _cursor, _statement, _parameters, _context, _executemany) -> None:
        assert write_unit_of_work_factory.active is True

    event.listen(sqlite_engine, "before_cursor_execute", assert_guarded)
    try:
        _save_organization_contact(
            repository,
            _organization_contact("organization", "organization-account", "organization@example.com"),
        )
        _save_workspace_member_contact(
            repository,
            _workspace_member_contact("workspace", _TENANT_ID, "workspace-account"),
        )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", assert_guarded)

    assert write_unit_of_work_factory.scopes == [DeploymentScope(), WorkspaceScope(id=_TENANT_ID)]


def test_snapshot_is_owner_scoped_and_contains_coherent_resolution_facts(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add_all([_account("account-1"), _account("account-2"), _account("account-3")])
        session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=str(_TENANT_ID),
                    account_id="account-1",
                    role=TenantAccountRole.NORMAL,
                ),
                TenantAccountJoin(
                    tenant_id=str(_TENANT_ID),
                    account_id="account-2",
                    role=TenantAccountRole.NORMAL,
                ),
                TenantAccountJoin(
                    tenant_id=str(_OTHER_TENANT_ID),
                    account_id="account-3",
                    role=TenantAccountRole.NORMAL,
                ),
            ]
        )
    organization = _save_organization_contact(
        repository, _organization_contact("organization", "account-1", "ada@example.com")
    )
    member = _save_workspace_member_contact(repository, _workspace_member_contact("member", _TENANT_ID, "account-2"))
    _save_workspace_member_contact(repository, _workspace_member_contact("other-member", _OTHER_TENANT_ID, "account-3"))
    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("account-2"),
        enabled=True,
    )

    snapshot = repository.load_snapshot(_TENANT_ID)

    assert {contact.id for contact in snapshot.contacts} == {organization.id, member.id}
    assert snapshot.member_account_ids == frozenset({AccountId("account-1"), AccountId("account-2")})
    assert snapshot.platform_contact_ids == frozenset({organization.id})
    assert ContactDirectoryPolicy.resolve_for_workspace(snapshot, organization.id) is ContactResolution.WORKSPACE


def test_snapshot_scopes_eager_platform_entries_in_sql(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add_all([_account("account-1"), _account("admin")])
    organization = _save_organization_contact(
        repository, _organization_contact("organization", "account-1", "ada@example.com")
    )
    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("admin"),
        enabled=True,
    )
    repository.set_platform_availability(
        _OTHER_TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("admin"),
        enabled=True,
    )
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(session_maker.kw["bind"], "before_cursor_execute", record_statement)
    try:
        snapshot = repository.load_snapshot(_TENANT_ID)
    finally:
        event.remove(session_maker.kw["bind"], "before_cursor_execute", record_statement)

    entry_statements = [
        " ".join(statement.lower().split())
        for statement in statements
        if "from human_input_platform_contact_workspace_entries" in statement.lower()
    ]
    assert len(entry_statements) == 1
    assert "human_input_platform_contact_workspace_entries.tenant_id = ?" in entry_statements[0]
    assert snapshot.platform_contact_ids == frozenset({organization.id})


def test_disabled_account_is_unavailable_without_deleting_contact(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("disabled"))
        session.add(
            TenantAccountJoin(
                tenant_id=str(_TENANT_ID),
                account_id="disabled",
                role=TenantAccountRole.NORMAL,
            )
        )
    contact = _save_organization_contact(
        repository, _organization_contact("contact-1", "disabled", "disabled@example.com")
    )
    with session_maker.begin() as session:
        account = session.get_one(Account, "disabled")
        account.status = AccountStatus.BANNED

    snapshot = repository.load_snapshot(_TENANT_ID)

    assert contact.id in {item.id for item in snapshot.contacts}
    assert snapshot.unavailable_account_ids == frozenset({AccountId("disabled")})
    assert ContactDirectoryPolicy.resolve_for_workspace(snapshot, contact.id) is ContactResolution.ABSENT


def test_external_admission_rolls_back_normalized_email_collision(repository_context) -> None:
    repository, session_maker = repository_context
    first = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")

    with pytest.raises(ContactDirectoryError) as error:
        repository.admit_external(_TENANT_ID, name="Duplicate", email=" REVIEWER@EXAMPLE.COM ")

    assert error.value.code is ContactRejectionCode.CONFLICTING_IDENTITY
    with session_maker() as session:
        records = session.scalars(select(HumanInputContact).where(HumanInputContact.tenant_id == str(_TENANT_ID))).all()
    assert [record.id for record in records] == [str(first.id)]


def test_external_admission_preserves_cross_workspace_email_isolation(repository_context) -> None:
    repository, _ = repository_context

    first = repository.admit_external(_TENANT_ID, name="First Reviewer", email="reviewer@example.com")
    second = repository.admit_external(_OTHER_TENANT_ID, name="Second Reviewer", email=" REVIEWER@EXAMPLE.COM ")

    assert first.id != second.id


def test_external_admission_succeeds_without_deployment_setup_row(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.execute(sa.delete(DifySetup))

    contact = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")

    assert isinstance(contact.owner, ExternalContactOwner)
    assert contact.owner.tenant_id == _TENANT_ID
    with session_maker() as session:
        stored_contact = session.get_one(HumanInputContact, str(contact.id))
    assert stored_contact.tenant_id == str(_TENANT_ID)


def test_external_admission_without_setup_still_rejects_existing_organization_email(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("account-1"))
    _save_organization_contact(repository, _organization_contact("organization", "account-1", "reviewer@example.com"))
    with session_maker.begin() as session:
        session.execute(sa.delete(DifySetup))

    with pytest.raises(ContactDirectoryError) as error:
        repository.admit_external(_TENANT_ID, name="Reviewer", email=" REVIEWER@EXAMPLE.COM ")

    assert error.value.code is ContactRejectionCode.CONFLICTING_IDENTITY


def test_external_admission_rejects_visible_organization_contact_email(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add_all([_account("account-1"), _account("admin")])
    organization = _save_organization_contact(
        repository, _organization_contact("organization", "account-1", "reviewer@example.com")
    )
    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("admin"),
        enabled=True,
    )

    with pytest.raises(ContactDirectoryError) as error:
        repository.admit_external(_TENANT_ID, name="Duplicate", email=" REVIEWER@EXAMPLE.COM ")

    assert error.value.code is ContactRejectionCode.CONFLICTING_IDENTITY


def test_organization_contact_write_rejects_existing_external_email(repository_context) -> None:
    repository, session_maker = repository_context
    repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")
    with session_maker.begin() as session:
        session.add(_account("account-1"))

    with pytest.raises(ContactDirectoryError) as error:
        _save_organization_contact(
            repository, _organization_contact("organization", "account-1", " REVIEWER@EXAMPLE.COM ")
        )

    assert error.value.code is ContactRejectionCode.CONFLICTING_IDENTITY


def test_source_specific_contact_writes_reject_external_bypass(repository_context) -> None:
    repository, _ = repository_context
    external = Contact.external(
        contact_id=ContactId("external-contact"),
        tenant_id=_TENANT_ID,
        name="Reviewer",
        email="reviewer@example.com",
        now=_NOW,
    )

    with pytest.raises(ContactDirectoryError) as organization_error:
        _save_organization_contact(repository, external)
    assert organization_error.value.code is ContactRejectionCode.INVALID_OWNER

    with pytest.raises(ContactDirectoryError) as workspace_error:
        _save_workspace_member_contact(repository, external)
    assert workspace_error.value.code is ContactRejectionCode.INVALID_OWNER


def test_external_hard_delete_allows_same_email_recreation_with_new_id(repository_context) -> None:
    repository, _ = repository_context
    original = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")

    repository.hard_delete_external(_TENANT_ID, original.id)
    recreated = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")

    assert recreated.id != original.id


def test_external_hard_delete_removes_every_referencing_im_binding(repository_context) -> None:
    repository, session_maker = repository_context
    external = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")
    with session_maker.begin() as session:
        session.add_all(
            (
                _im_binding(
                    binding_id="binding-organization",
                    contact_id=external.id,
                    scope=IMBindingScope.ORGANIZATION,
                    scope_id="integration-1",
                    identity_id="identity-organization",
                ),
                _im_binding(
                    binding_id="binding-workspace",
                    contact_id=external.id,
                    scope=IMBindingScope.WORKSPACE,
                    scope_id=str(_TENANT_ID),
                    identity_id="identity-workspace",
                ),
            )
        )

    repository.hard_delete_external(_TENANT_ID, external.id)

    with session_maker() as session:
        assert session.get(HumanInputContact, str(external.id)) is None
        assert session.scalar(select(sa.func.count(HumanInputIMBinding.id))) == 0


def test_external_hard_delete_acquires_workspace_guard_before_related_sql(sqlite_engine: Engine) -> None:
    repository, session_maker, write_unit_of_work_factory = _guarded_external_repository(sqlite_engine)
    external = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")
    with session_maker.begin() as session:
        session.add(
            _im_binding(
                binding_id="binding-workspace",
                contact_id=external.id,
                scope=IMBindingScope.WORKSPACE,
                scope_id=str(_TENANT_ID),
                identity_id="identity-workspace",
            )
        )

    def assert_guarded(_connection, _cursor, _statement, _parameters, _context, _executemany) -> None:
        assert write_unit_of_work_factory.active is True

    event.listen(sqlite_engine, "before_cursor_execute", assert_guarded)
    try:
        repository.hard_delete_external(_TENANT_ID, external.id)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", assert_guarded)

    assert write_unit_of_work_factory.scopes == [WorkspaceScope(id=_TENANT_ID)]


def test_external_hard_delete_rolls_back_binding_cleanup_when_contact_delete_fails(sqlite_engine: Engine) -> None:
    repository, session_maker, _write_unit_of_work_factory = _guarded_external_repository(sqlite_engine)
    external = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")
    with session_maker.begin() as session:
        session.add(
            _im_binding(
                binding_id="binding-workspace",
                contact_id=external.id,
                scope=IMBindingScope.WORKSPACE,
                scope_id=str(_TENANT_ID),
                identity_id="identity-workspace",
            )
        )
    binding_delete_seen = False

    def fail_contact_delete(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        nonlocal binding_delete_seen
        normalized_statement = " ".join(statement.lower().split())
        if normalized_statement.startswith("delete from human_input_im_bindings"):
            binding_delete_seen = True
        if normalized_statement.startswith("delete from human_input_contacts"):
            raise RuntimeError("injected contact delete failure")

    event.listen(sqlite_engine, "before_cursor_execute", fail_contact_delete)
    try:
        with pytest.raises(RuntimeError, match="injected contact delete failure"):
            repository.hard_delete_external(_TENANT_ID, external.id)
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", fail_contact_delete)

    assert binding_delete_seen is True
    with session_maker() as session:
        assert session.get(HumanInputContact, str(external.id)) is not None
        assert session.scalar(select(sa.func.count(HumanInputIMBinding.id))) == 1


def test_external_hard_delete_rejects_cross_workspace_owner(repository_context) -> None:
    repository, _ = repository_context
    contact = repository.admit_external(_OTHER_TENANT_ID, name="Reviewer", email="reviewer@example.com")

    with pytest.raises(ContactDirectoryError) as error:
        repository.hard_delete_external(_TENANT_ID, contact.id)
    assert error.value.code is ContactRejectionCode.CONTACT_NOT_FOUND


def test_platform_mutation_is_idempotent_and_restricted_to_organization_contacts(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add_all([_account("account-1"), _account("admin")])
    organization = _save_organization_contact(
        repository, _organization_contact("organization", "account-1", "ada@example.com")
    )
    external = repository.admit_external(_TENANT_ID, name="Reviewer", email="reviewer@example.com")

    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("admin"),
        enabled=True,
    )
    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("admin"),
        enabled=True,
    )
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputPlatformContactWorkspaceEntry.id))) == 1

    with pytest.raises(ContactDirectoryError) as error:
        repository.set_platform_availability(
            _TENANT_ID,
            external.id,
            added_by_account_id=AccountId("admin"),
            enabled=True,
        )
    assert error.value.code is ContactRejectionCode.INVALID_OWNER

    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("admin"),
        enabled=False,
    )
    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("admin"),
        enabled=False,
    )
    with session_maker() as session:
        assert session.scalar(sa.select(sa.func.count(HumanInputPlatformContactWorkspaceEntry.id))) == 0


def test_snapshot_uses_explicit_bounded_queries_and_returns_only_domain_values(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("account-1"))
    organization = _save_organization_contact(
        repository, _organization_contact("organization", "account-1", "ada@example.com")
    )
    repository.set_platform_availability(
        _TENANT_ID,
        organization.id,
        added_by_account_id=AccountId("account-1"),
        enabled=True,
    )
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(session_maker.kw["bind"], "before_cursor_execute", record_statement)
    try:
        snapshot = repository.load_snapshot(_TENANT_ID)
    finally:
        event.remove(session_maker.kw["bind"], "before_cursor_execute", record_statement)

    assert len(statements) == 4
    assert all(isinstance(contact, Contact) for contact in snapshot.contacts)
    assert snapshot.platform_contact_ids == frozenset({organization.id})


def test_organization_write_requires_and_queries_stable_setup_row(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("account-1"))
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(session_maker.kw["bind"], "before_cursor_execute", record_statement)
    try:
        _save_organization_contact(repository, _organization_contact("organization", "account-1", "ada@example.com"))
    finally:
        event.remove(session_maker.kw["bind"], "before_cursor_execute", record_statement)

    assert any("dify_setups" in statement.lower() for statement in statements)


def test_organization_write_fails_closed_when_setup_row_is_missing(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.execute(sa.delete(DifySetup))

    with pytest.raises(ContactDirectoryError) as error:
        _save_organization_contact(repository, _organization_contact("organization", "account-1", "ada@example.com"))
    assert error.value.code is ContactRejectionCode.SETUP_ROW_MISSING


def test_contact_update_preserves_identity_source_and_owner(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("account-1"))
    original = _save_organization_contact(
        repository, _organization_contact("organization", "account-1", "ada@example.com")
    )
    updated = Contact.create(
        contact_id=original.id,
        identity_source=ContactIdentitySource.ORGANIZATION_ACCOUNT,
        owner=original.owner,
        name="Ada Lovelace",
        email="lovelace@example.com",
        created_at=original.created_at,
        now=datetime(2026, 7, 26),
    )

    restored = _save_organization_contact(repository, updated)

    assert restored.name == "Ada Lovelace"
    assert restored.identity_source is ContactIdentitySource.ORGANIZATION_ACCOUNT
    assert restored.owner == original.owner


def test_contact_update_rejects_account_owner_takeover(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add_all([_account("account-1"), _account("account-2")])
    original = _save_organization_contact(
        repository, _organization_contact("organization", "account-1", "ada@example.com")
    )

    with pytest.raises(ContactDirectoryError) as error:
        _save_organization_contact(repository, _organization_contact("organization", "account-2", "grace@example.com"))

    assert error.value.code is ContactRejectionCode.INVALID_OWNER
    with session_maker() as session:
        stored_contact = session.get_one(HumanInputContact, str(original.id))
    assert stored_contact.account_id == "account-1"
    assert stored_contact.normalized_email == "ada@example.com"


def test_organization_contact_without_email_still_reserves_account_identity(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("account-1"))
    original = _save_organization_contact(repository, _organization_contact("organization", "account-1", None))

    with pytest.raises(ContactDirectoryError) as error:
        _save_organization_contact(repository, _organization_contact("duplicate", "account-1", None))

    assert error.value.code is ContactRejectionCode.CONFLICTING_IDENTITY
    with session_maker() as session:
        stored_contacts = session.scalars(
            select(HumanInputContact).where(HumanInputContact.account_id == "account-1")
        ).all()
    assert [stored_contact.id for stored_contact in stored_contacts] == [str(original.id)]


def test_account_backed_admission_rejects_unavailable_account(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("disabled", status=AccountStatus.BANNED))

    with pytest.raises(ContactDirectoryError) as error:
        _save_organization_contact(
            repository, _organization_contact("organization", "disabled", "disabled@example.com")
        )
    assert error.value.code is ContactRejectionCode.ACCOUNT_UNAVAILABLE


def test_workspace_member_write_requires_current_membership(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add(_account("account-1"))

    with pytest.raises(ContactDirectoryError) as error:
        _save_workspace_member_contact(
            repository, _workspace_member_contact("workspace-contact", _TENANT_ID, "account-1")
        )

    assert error.value.code is ContactRejectionCode.INVALID_OWNER


def test_organization_contact_write_rejects_owner_scoped_identity_collision(repository_context) -> None:
    repository, session_maker = repository_context
    with session_maker.begin() as session:
        session.add_all([_account("account-1"), _account("account-2")])
    _save_organization_contact(repository, _organization_contact("first", "account-1", "ada@example.com"))

    with pytest.raises(ContactDirectoryError) as error:
        _save_organization_contact(repository, _organization_contact("second", "account-2", "ADA@example.com"))
    assert error.value.code is ContactRejectionCode.CONFLICTING_IDENTITY


def test_platform_mutation_rejects_unknown_contact(repository_context) -> None:
    repository, _ = repository_context

    with pytest.raises(ContactDirectoryError) as error:
        repository.set_platform_availability(
            _TENANT_ID,
            ContactId("missing"),
            added_by_account_id=AccountId("admin"),
            enabled=True,
        )
    assert error.value.code is ContactRejectionCode.CONTACT_NOT_FOUND


def test_mysql_platform_enable_statement_uses_idempotent_duplicate_key_update() -> None:
    session = MagicMock(spec=Session)
    session.get_bind.return_value.dialect.name = "mysql"

    SQLAlchemyContactDirectoryRepository._insert_platform_entry_idempotently(
        session,
        PlatformWorkspaceEntry(
            id=PlatformEntryId("entry-1"),
            tenant_id=_TENANT_ID,
            contact_id=ContactId("contact-1"),
            added_by_account_id=AccountId("account-1"),
            created_at=_NOW,
            updated_at=_NOW,
        ),
    )

    statement = session.execute.call_args.args[0]
    compiled_statement = str(statement.compile(dialect=mysql.dialect()))
    assert "ON DUPLICATE KEY UPDATE contact_id = VALUES(contact_id)" in compiled_statement


def test_postgresql_platform_enable_statement_uses_named_idempotency_constraint() -> None:
    session = MagicMock(spec=Session)
    session.get_bind.return_value.dialect.name = "postgresql"

    SQLAlchemyContactDirectoryRepository._insert_platform_entry_idempotently(
        session,
        PlatformWorkspaceEntry(
            id=PlatformEntryId("entry-1"),
            tenant_id=_TENANT_ID,
            contact_id=ContactId("contact-1"),
            added_by_account_id=AccountId("account-1"),
            created_at=_NOW,
            updated_at=_NOW,
        ),
    )

    statement = session.execute.call_args.args[0]
    compiled_statement = str(statement.compile(dialect=postgresql.dialect()))
    assert "ON CONFLICT ON CONSTRAINT hipcwe_tenant_contact_uq DO NOTHING" in compiled_statement


def test_platform_enable_rejects_unsupported_database_dialect() -> None:
    session = MagicMock(spec=Session)
    session.get_bind.return_value.dialect.name = "oracle"

    with pytest.raises(ContactDirectoryError) as error:
        SQLAlchemyContactDirectoryRepository._insert_platform_entry_idempotently(
            session,
            PlatformWorkspaceEntry(
                id=PlatformEntryId("entry-1"),
                tenant_id=_TENANT_ID,
                contact_id=ContactId("contact-1"),
                added_by_account_id=AccountId("account-1"),
                created_at=_NOW,
                updated_at=_NOW,
            ),
        )

    assert error.value.code is ContactRejectionCode.PERSISTENCE_FAILURE
    session.execute.assert_not_called()


def test_postgresql_snapshot_configures_repeatable_read_transaction() -> None:
    session = MagicMock(spec=Session)
    session.get_bind.return_value.dialect.name = "postgresql"

    SQLAlchemyContactDirectoryRepository._configure_snapshot_transaction(session)

    session.connection.assert_called_once_with(execution_options={"isolation_level": "REPEATABLE READ"})


def _im_binding(
    *,
    binding_id: str,
    contact_id: ContactId,
    scope: IMBindingScope,
    scope_id: str,
    identity_id: str,
) -> HumanInputIMBinding:
    record = HumanInputIMBinding(
        integration_id="integration-1",
        scope=scope,
        scope_id=scope_id,
        contact_id=str(contact_id),
        im_identity_id=identity_id,
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
    )
    record.id = binding_id
    return record


def _guarded_external_repository(
    sqlite_engine: Engine,
) -> tuple[
    SQLAlchemyContactDirectoryRepository,
    sessionmaker[Session],
    _RecordingWriteUnitOfWorkFactory,
]:
    tables = [
        DifySetup.__table__,
        HumanInputContact.__table__,
        HumanInputIMBinding.__table__,
    ]
    DifySetup.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with session_maker.begin() as session:
        session.add(DifySetup(version="test-version"))
    write_unit_of_work_factory = _RecordingWriteUnitOfWorkFactory(session_maker)
    return (
        SQLAlchemyContactDirectoryRepository(session_maker, write_unit_of_work_factory),
        session_maker,
        write_unit_of_work_factory,
    )

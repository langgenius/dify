"""PostgreSQL-only transaction and concurrency coverage for Contact Directory."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, get_ident

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.contact_directory import (
    Contact,
    ContactDirectoryError,
    ContactDirectorySnapshot,
    ContactRejectionCode,
)
from core.human_input_v2.shared import AccountId, ContactId, UtcTimestamp, WorkspaceId
from extensions.ext_database import db
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus, TenantAccountJoin
from models.human_input_v2 import HumanInputContact, HumanInputPlatformContactWorkspaceEntry
from repositories.human_input_v2.contact_directory.repository import SQLAlchemyContactDirectoryRepository


def test_concurrent_organization_writes_serialize_on_dify_setup(flask_req_ctx, setup_account) -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")

    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_maker.begin() as session:
        session.execute(
            sa.delete(HumanInputContact).where(
                HumanInputContact.tenant_id.is_(None),
                HumanInputContact.account_id == setup_account.id,
            )
        )
    barrier = Barrier(2)

    def write_contact(contact_id: str) -> Contact | ContactRejectionCode:
        repository = SQLAlchemyContactDirectoryRepository(session_maker)
        contact = Contact.organization_account(
            contact_id=ContactId(contact_id),
            account_id=AccountId(setup_account.id),
            name="Concurrent Account",
            email="concurrent@example.com",
            now=UtcTimestamp.now(),
        )
        barrier.wait()
        try:
            return repository.save_organization_contact(contact)
        except ContactDirectoryError as error:
            return error.code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(write_contact, (str(uuidv7()), str(uuidv7()))))

        assert sum(isinstance(result, Contact) for result in results) == 1
        assert results.count(ContactRejectionCode.CONFLICTING_IDENTITY) == 1
        with session_maker() as session:
            count = session.scalar(
                sa.select(sa.func.count(HumanInputContact.id)).where(
                    HumanInputContact.tenant_id.is_(None),
                    HumanInputContact.account_id == setup_account.id,
                )
            )
        assert count == 1
    finally:
        with session_maker.begin() as session:
            session.execute(
                sa.delete(HumanInputContact).where(
                    HumanInputContact.tenant_id.is_(None),
                    HumanInputContact.account_id == setup_account.id,
                )
            )


def test_concurrent_organization_and_external_admission_share_identity_claim(flask_req_ctx, setup_account) -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")

    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_maker() as session:
        workspace_id = session.scalar(
            sa.select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == setup_account.id)
        )
    assert workspace_id is not None
    normalized_email = f"concurrent-org-external-{uuidv7()}@example.com"
    organization_account_id = str(uuidv7())
    organization_contact_id = ContactId(str(uuidv7()))
    with session_maker.begin() as session:
        organization_account = Account(
            name="Concurrent Organization Account",
            email=normalized_email,
            status=AccountStatus.ACTIVE,
        )
        organization_account.id = organization_account_id
        session.add(organization_account)
    barrier = Barrier(2)

    def save_organization_contact() -> Contact | ContactRejectionCode:
        repository = SQLAlchemyContactDirectoryRepository(session_maker)
        barrier.wait()
        try:
            return repository.save_organization_contact(
                Contact.organization_account(
                    contact_id=organization_contact_id,
                    account_id=AccountId(organization_account_id),
                    name="Concurrent Organization Account",
                    email=normalized_email,
                    now=UtcTimestamp.now(),
                )
            )
        except ContactDirectoryError as error:
            return error.code

    def admit_external() -> Contact | ContactRejectionCode:
        repository = SQLAlchemyContactDirectoryRepository(session_maker)
        barrier.wait()
        try:
            return repository.admit_external(
                WorkspaceId(workspace_id),
                name="Concurrent External",
                email=normalized_email,
            )
        except ContactDirectoryError as error:
            return error.code

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            organization_future = executor.submit(save_organization_contact)
            external_future = executor.submit(admit_external)
            results = [organization_future.result(timeout=10), external_future.result(timeout=10)]

        assert sum(isinstance(result, Contact) for result in results) == 1
        assert results.count(ContactRejectionCode.CONFLICTING_IDENTITY) == 1
        with session_maker() as session:
            contact_count = session.scalar(
                sa.select(sa.func.count(HumanInputContact.id)).where(
                    HumanInputContact.normalized_email == normalized_email
                )
            )
        assert contact_count == 1
    finally:
        with session_maker.begin() as session:
            session.execute(sa.delete(HumanInputContact).where(HumanInputContact.normalized_email == normalized_email))
            session.execute(sa.delete(Account).where(Account.id == organization_account_id))


def test_concurrent_platform_enable_is_idempotent(flask_req_ctx, setup_account) -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")

    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_maker() as session:
        workspace_id = session.scalar(
            sa.select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == setup_account.id)
        )
    assert workspace_id is not None
    repository = SQLAlchemyContactDirectoryRepository(session_maker)
    contact = repository.save_organization_contact(
        Contact.organization_account(
            contact_id=ContactId(str(uuidv7())),
            account_id=AccountId(setup_account.id),
            name="Concurrent Platform Account",
            email="concurrent-platform@example.com",
            now=UtcTimestamp.now(),
        )
    )
    barrier = Barrier(2)

    def enable_platform_contact() -> ContactRejectionCode | None:
        concurrent_repository = SQLAlchemyContactDirectoryRepository(session_maker)
        barrier.wait()
        try:
            concurrent_repository.set_platform_availability(
                WorkspaceId(workspace_id),
                contact.id,
                added_by_account_id=AccountId(setup_account.id),
                enabled=True,
            )
        except ContactDirectoryError as error:
            return error.code
        return None

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _index: enable_platform_contact(), range(2)))

        assert results == [None, None]
        with session_maker() as session:
            entry_count = session.scalar(
                sa.select(sa.func.count(HumanInputPlatformContactWorkspaceEntry.id)).where(
                    HumanInputPlatformContactWorkspaceEntry.tenant_id == workspace_id,
                    HumanInputPlatformContactWorkspaceEntry.contact_id == str(contact.id),
                )
            )
        assert entry_count == 1
    finally:
        with session_maker.begin() as session:
            session.execute(
                sa.delete(HumanInputPlatformContactWorkspaceEntry).where(
                    HumanInputPlatformContactWorkspaceEntry.contact_id == str(contact.id)
                )
            )
            session.execute(sa.delete(HumanInputContact).where(HumanInputContact.id == str(contact.id)))


def test_snapshot_uses_one_repeatable_read_view_across_statements(flask_req_ctx, setup_account) -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")

    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_maker() as session:
        membership = session.scalar(
            sa.select(TenantAccountJoin).where(TenantAccountJoin.account_id == setup_account.id)
        )
    assert membership is not None
    workspace_id = WorkspaceId(membership.tenant_id)
    repository = SQLAlchemyContactDirectoryRepository(session_maker)
    contact = repository.save_organization_contact(
        Contact.organization_account(
            contact_id=ContactId(str(uuidv7())),
            account_id=AccountId(setup_account.id),
            name="Snapshot Account",
            email="snapshot-account@example.com",
            now=UtcTimestamp.now(),
        )
    )
    contact_query_finished = Event()
    mutation_committed = Event()
    loader_thread_id: list[int] = []

    def pause_after_contact_query(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        normalized_statement = " ".join(statement.lower().split())
        if (
            loader_thread_id
            and get_ident() == loader_thread_id[0]
            and normalized_statement.startswith("select")
            and "from human_input_contacts" in normalized_statement
        ):
            contact_query_finished.set()
            assert mutation_committed.wait(timeout=10)

    def load_snapshot() -> ContactDirectorySnapshot:
        loader_thread_id.append(get_ident())
        return repository.load_snapshot(workspace_id)

    event.listen(db.engine, "after_cursor_execute", pause_after_contact_query)
    future = None
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(load_snapshot)
            assert contact_query_finished.wait(timeout=10)
            with session_maker.begin() as session:
                session.execute(
                    sa.delete(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == str(workspace_id),
                        TenantAccountJoin.account_id == setup_account.id,
                    )
                )
                account = session.get_one(Account, setup_account.id)
                account.status = AccountStatus.BANNED
                entry = HumanInputPlatformContactWorkspaceEntry(
                    tenant_id=str(workspace_id),
                    contact_id=str(contact.id),
                    added_by_account_id=setup_account.id,
                )
                entry.id = str(uuidv7())
                session.add(entry)
            mutation_committed.set()
            snapshot = future.result(timeout=10)

        assert snapshot.member_account_ids == frozenset({AccountId(setup_account.id)})
        assert snapshot.platform_contact_ids == frozenset()
        assert snapshot.unavailable_account_ids == frozenset()
    finally:
        mutation_committed.set()
        event.remove(db.engine, "after_cursor_execute", pause_after_contact_query)
        if future is not None and not future.done():
            future.result(timeout=10)
        with session_maker.begin() as session:
            session.execute(
                sa.delete(HumanInputPlatformContactWorkspaceEntry).where(
                    HumanInputPlatformContactWorkspaceEntry.contact_id == str(contact.id)
                )
            )
            session.execute(sa.delete(HumanInputContact).where(HumanInputContact.id == str(contact.id)))
            account = session.get_one(Account, setup_account.id)
            account.status = AccountStatus.ACTIVE
            existing_membership = session.scalar(
                sa.select(TenantAccountJoin.id).where(
                    TenantAccountJoin.tenant_id == str(workspace_id),
                    TenantAccountJoin.account_id == setup_account.id,
                )
            )
            if existing_membership is None:
                restored_membership = TenantAccountJoin(
                    tenant_id=str(workspace_id),
                    account_id=setup_account.id,
                    role=membership.role,
                    current=membership.current,
                    invited_by=membership.invited_by,
                )
                restored_membership.id = membership.id
                session.add(restored_membership)

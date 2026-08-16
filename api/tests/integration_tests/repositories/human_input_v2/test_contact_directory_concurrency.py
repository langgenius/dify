"""PostgreSQL-only transaction and concurrency coverage for Contact Directory."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, get_ident
from time import monotonic, sleep

import pytest
import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact_directory import (
    Contact,
    ContactDirectoryError,
    ContactDirectorySnapshot,
    ContactRejectionCode,
)
from core.human_input_v2.shared import AccountId, ContactId, DeploymentScope, DirectoryScope, TenantId
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.account import Account, AccountStatus, TenantAccountJoin
from models.human_input_v2 import HumanInputContact, HumanInputPlatformContactWorkspaceEntry
from repositories.human_input_v2.contact_directory.repository import SQLAlchemyContactDirectoryRepository
from repositories.human_input_v2.organization_write_unit_of_work import SQLAlchemyOrganizationWriteUnitOfWork


class _OwnedWriteLock:
    def __enter__(self) -> _OwnedWriteLock:
        return self

    def __exit__(self, *_unused: object) -> None:
        pass

    def ensure_owned(self) -> None:
        pass

    def extend(self) -> None:
        pass


def _repository(session_maker: sessionmaker[Session]) -> SQLAlchemyContactDirectoryRepository:
    def create_write_unit_of_work(scope: DirectoryScope) -> SQLAlchemyOrganizationWriteUnitOfWork:
        del scope
        return SQLAlchemyOrganizationWriteUnitOfWork(session_maker, _OwnedWriteLock())

    return SQLAlchemyContactDirectoryRepository(session_maker, create_write_unit_of_work)


def _save_organization_contact(repository: SQLAlchemyContactDirectoryRepository, contact: Contact) -> Contact:
    return repository.save_organization_contact(contact, organization_scope=DeploymentScope())


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
        repository = _repository(session_maker)
        contact = Contact.organization_account(
            contact_id=ContactId(contact_id),
            account_id=AccountId(setup_account.id),
            name="Concurrent Account",
            email="concurrent@example.com",
            now=naive_utc_now(),
        )
        barrier.wait()
        try:
            return _save_organization_contact(repository, contact)
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
        tenant_id = session.scalar(
            sa.select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == setup_account.id)
        )
    assert tenant_id is not None
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
    first_lock_acquired = Event()
    external_connection_ready = Event()
    release_first_lock = Event()
    organization_thread_id: list[int] = []
    organization_backend_pid: list[int] = []
    external_backend_pid: list[int] = []

    def is_deployment_lock_statement(statement: str) -> bool:
        normalized_statement = " ".join(statement.lower().split())
        return (
            normalized_statement.startswith("select")
            and "from dify_setups" in normalized_statement
            and "for update" in normalized_statement
        )

    def pause_after_first_lock(
        _connection,
        _cursor,
        statement,
        _parameters,
        _context,
        _executemany,
    ) -> None:
        if (
            organization_thread_id
            and get_ident() == organization_thread_id[0]
            and is_deployment_lock_statement(statement)
        ):
            first_lock_acquired.set()
            assert release_first_lock.wait(timeout=10)

    def save_organization_contact() -> Contact | ContactRejectionCode:
        with db.engine.connect() as connection:
            backend_pid = connection.scalar(sa.select(sa.func.pg_backend_pid()))
            assert backend_pid is not None
            organization_backend_pid.append(backend_pid)
            connection.commit()
            repository = _repository(sessionmaker(bind=connection, expire_on_commit=False))
            organization_thread_id.append(get_ident())
            try:
                return _save_organization_contact(
                    repository,
                    Contact.organization_account(
                        contact_id=organization_contact_id,
                        account_id=AccountId(organization_account_id),
                        name="Concurrent Organization Account",
                        email=normalized_email,
                        now=naive_utc_now(),
                    ),
                )
            except ContactDirectoryError as error:
                return error.code

    def admit_external() -> Contact | ContactRejectionCode:
        with db.engine.connect() as connection:
            backend_pid = connection.scalar(sa.select(sa.func.pg_backend_pid()))
            assert backend_pid is not None
            external_backend_pid.append(backend_pid)
            connection.commit()
            external_connection_ready.set()
            repository = _repository(sessionmaker(bind=connection, expire_on_commit=False))
            try:
                return repository.admit_external(
                    TenantId(tenant_id),
                    name="Concurrent External",
                    email=normalized_email,
                )
            except ContactDirectoryError as error:
                return error.code

    def wait_until_external_is_blocked() -> None:
        deadline = monotonic() + 10
        with session_maker() as observer:
            while monotonic() < deadline:
                blocking_pids = observer.scalar(sa.select(sa.func.pg_blocking_pids(external_backend_pid[0])))
                if blocking_pids is not None and organization_backend_pid[0] in blocking_pids:
                    return
                sleep(0.01)
        raise AssertionError("External admission did not block on the Organization deployment lock")

    executor = ThreadPoolExecutor(max_workers=2)
    event.listen(db.engine, "after_cursor_execute", pause_after_first_lock)
    try:
        organization_future = executor.submit(save_organization_contact)
        assert first_lock_acquired.wait(timeout=10)
        external_future = executor.submit(admit_external)
        assert external_connection_ready.wait(timeout=10)
        wait_until_external_is_blocked()
        assert not external_future.done()

        release_first_lock.set()
        results = [organization_future.result(timeout=10), external_future.result(timeout=10)]

        assert sum(isinstance(result, Contact) for result in results) == 1
        assert results.count(ContactRejectionCode.CONFLICTING_IDENTITY) == 1
        assert isinstance(results[0], Contact)
        assert results[1] is ContactRejectionCode.CONFLICTING_IDENTITY
        with session_maker() as session:
            contact_count = session.scalar(
                sa.select(sa.func.count(HumanInputContact.id)).where(
                    HumanInputContact.normalized_email == normalized_email
                )
            )
        assert contact_count == 1
    finally:
        release_first_lock.set()
        event.remove(db.engine, "after_cursor_execute", pause_after_first_lock)
        executor.shutdown(wait=True, cancel_futures=True)
        with session_maker.begin() as session:
            session.execute(sa.delete(HumanInputContact).where(HumanInputContact.normalized_email == normalized_email))
            session.execute(sa.delete(Account).where(Account.id == organization_account_id))


def test_concurrent_platform_enable_is_idempotent(flask_req_ctx, setup_account) -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")

    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_maker() as session:
        tenant_id = session.scalar(
            sa.select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == setup_account.id)
        )
    assert tenant_id is not None
    repository = _repository(session_maker)
    contact = _save_organization_contact(
        repository,
        Contact.organization_account(
            contact_id=ContactId(str(uuidv7())),
            account_id=AccountId(setup_account.id),
            name="Concurrent Platform Account",
            email="concurrent-platform@example.com",
            now=naive_utc_now(),
        ),
    )
    barrier = Barrier(2)

    def enable_platform_contact() -> ContactRejectionCode | None:
        concurrent_repository = _repository(session_maker)
        barrier.wait()
        try:
            concurrent_repository.set_platform_availability(
                TenantId(tenant_id),
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
                    HumanInputPlatformContactWorkspaceEntry.tenant_id == tenant_id,
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
    tenant_id = TenantId(membership.tenant_id)
    repository = _repository(session_maker)
    contact = _save_organization_contact(
        repository,
        Contact.organization_account(
            contact_id=ContactId(str(uuidv7())),
            account_id=AccountId(setup_account.id),
            name="Snapshot Account",
            email="snapshot-account@example.com",
            now=naive_utc_now(),
        ),
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
        return repository.load_snapshot(tenant_id)

    event.listen(db.engine, "after_cursor_execute", pause_after_contact_query)
    future = None
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(load_snapshot)
            assert contact_query_finished.wait(timeout=10)
            with session_maker.begin() as session:
                session.execute(
                    sa.delete(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == str(tenant_id),
                        TenantAccountJoin.account_id == setup_account.id,
                    )
                )
                account = session.get_one(Account, setup_account.id)
                account.status = AccountStatus.BANNED
                entry = HumanInputPlatformContactWorkspaceEntry(
                    tenant_id=str(tenant_id),
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
                    TenantAccountJoin.tenant_id == str(tenant_id),
                    TenantAccountJoin.account_id == setup_account.id,
                )
            )
            if existing_membership is None:
                restored_membership = TenantAccountJoin(
                    tenant_id=str(tenant_id),
                    account_id=setup_account.id,
                    role=membership.role,
                    current=membership.current,
                    invited_by=membership.invited_by,
                )
                restored_membership.id = membership.id
                session.add(restored_membership)

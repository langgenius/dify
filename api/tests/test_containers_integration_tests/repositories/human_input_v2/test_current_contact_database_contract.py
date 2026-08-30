"""Cross-dialect database contracts for current Contact and IM persistence."""

from __future__ import annotations

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from testcontainers.mysql import MySqlContainer
from testcontainers.postgres import PostgresContainer

from core.human_input_v2.entities import IMIntegrationStatus, IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration import (
    ApplyReconciliationStatus,
    IMSyncRun,
    IntegrationRevisionToken,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationRunRef,
    SyncReconciler,
)
from core.human_input_v2.im_integration.adapters import DirectoryEntry, ProviderUserId
from core.human_input_v2.shared import AccountId, ContactId, IMSyncRunId, IntegrationId, TenantId
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputExternalContactProfile,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
    HumanInputPlatformContactWorkspaceEntry,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.contact import (
    ContactError,
    ContactErrorCode,
    ContactQuery,
    ContactType,
    ExternalContact,
)
from repositories.human_input_v2.im_integration.mappers import sync_run_to_record
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemySessionBoundIMRepository
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository

_NOW = datetime(2026, 8, 30, 8)
_TENANT_A = TenantId("00000000-0000-0000-0000-000000000101")
_TENANT_B = TenantId("00000000-0000-0000-0000-000000000102")
_ACCOUNT_A = AccountId("00000000-0000-0000-0000-000000000201")
_ACCOUNT_B = AccountId("00000000-0000-0000-0000-000000000202")
_ADMIN_ACCOUNT = AccountId("00000000-0000-0000-0000-000000000203")
_EXTERNAL_A = ContactId("00000000-0000-0000-0000-000000000301")
_EXTERNAL_B = ContactId("00000000-0000-0000-0000-000000000302")
_ROLLBACK_EXTERNAL = ContactId("00000000-0000-0000-0000-000000000303")
_INTEGRATION_ID = IntegrationId("00000000-0000-0000-0000-000000000401")
_SYNC_RUN_ID = IMSyncRunId("00000000-0000-0000-0000-000000000501")

_TABLES = (
    Tenant.__table__,
    Account.__table__,
    TenantAccountJoin.__table__,
    HumanInputContactIdentity.__table__,
    HumanInputExternalContactProfile.__table__,
    HumanInputPlatformContactWorkspaceEntry.__table__,
    HumanInputIMIntegration.__table__,
    HumanInputIMIdentity.__table__,
    HumanInputIMBinding.__table__,
    HumanInputIMSyncRun.__table__,
    HumanInputIMSyncResult.__table__,
    HumanInputIMReconciliationChange.__table__,
)


@dataclass(frozen=True, slots=True)
class _DatabaseContext:
    dialect: str
    engine: Engine
    sessions: sessionmaker[Session]


class _InjectedFailureError(RuntimeError):
    pass


@pytest.fixture(scope="module", params=("postgresql", "mysql"), ids=("postgresql", "mysql"))
def dialect_engine(request: pytest.FixtureRequest) -> Generator[tuple[str, Engine], None, None]:
    dialect = str(request.param)
    if dialect == "postgresql":
        container = PostgresContainer("postgres:16-alpine")
    else:
        container = MySqlContainer("mysql:8.0", dialect="pymysql")

    with container:
        engine = sa.create_engine(container.get_connection_url(), pool_pre_ping=True)
        try:
            yield dialect, engine
        finally:
            engine.dispose()


@pytest.fixture
def database_context(dialect_engine: tuple[str, Engine]) -> Generator[_DatabaseContext, None, None]:
    dialect, engine = dialect_engine
    _drop_schema(engine)
    sa.MetaData().create_all(engine)
    HumanInputContactIdentity.metadata.create_all(engine, tables=list(_TABLES))
    context = _DatabaseContext(
        dialect=dialect,
        engine=engine,
        sessions=sessionmaker(bind=engine, expire_on_commit=False),
    )
    try:
        yield context
    finally:
        _drop_schema(engine)


def _drop_schema(engine: Engine) -> None:
    HumanInputContactIdentity.metadata.drop_all(engine, tables=list(reversed(_TABLES)), checkfirst=True)


def _tenant(tenant_id: TenantId, name: str) -> Tenant:
    tenant = Tenant(name=name)
    tenant.id = str(tenant_id)
    return tenant


def _account(account_id: AccountId, name: str, email: str) -> Account:
    account = Account(name=name, email=email, status=AccountStatus.ACTIVE)
    account.id = str(account_id)
    return account


def _membership(tenant_id: TenantId, account_id: AccountId) -> TenantAccountJoin:
    membership = TenantAccountJoin(
        tenant_id=str(tenant_id),
        account_id=str(account_id),
        role=TenantAccountRole.NORMAL,
    )
    return membership


def _external(contact_id: ContactId, name: str, email: str) -> ExternalContact:
    return ExternalContact(
        id=contact_id,
        name=name,
        email=email,
        avatar_file_id=None,
        created_at=_NOW,
    )


def test_concurrent_account_contact_provisioning_converges_to_one_stable_id(
    database_context: _DatabaseContext,
) -> None:
    with database_context.sessions.begin() as session:
        session.add(_account(_ACCOUNT_A, "Concurrent Account", "concurrent-account@example.com"))

    barrier = Barrier(2)

    def provision() -> ContactId:
        with database_context.sessions.begin() as session:
            barrier.wait(timeout=10)
            return SQLAlchemyContactRepository(session).provision_account_backed_contact(_ACCOUNT_A)

    with ThreadPoolExecutor(max_workers=2) as executor:
        contact_ids = tuple(executor.map(lambda _index: provision(), range(2)))

    assert contact_ids[0] == contact_ids[1]
    with database_context.sessions() as session:
        records = tuple(
            session.scalars(
                select(HumanInputContactIdentity).where(
                    HumanInputContactIdentity.subject_type == ContactSubjectType.ACCOUNT,
                    HumanInputContactIdentity.account_id == str(_ACCOUNT_A),
                )
            )
        )
    assert len(records) == 1
    assert ContactId(records[0].id) == contact_ids[0]


def test_concurrent_external_email_claim_has_one_durable_winner_and_one_conflict(
    database_context: _DatabaseContext,
) -> None:
    with database_context.sessions.begin() as session:
        session.add(_tenant(_TENANT_A, "External concurrency"))

    barrier = Barrier(2)
    candidates = (
        _external(_EXTERNAL_A, "First External", "Shared.External@Example.com"),
        _external(_EXTERNAL_B, "Second External", "shared.external@example.com"),
    )

    def save(candidate: ExternalContact) -> tuple[str, str]:
        try:
            with database_context.sessions.begin() as session:
                barrier.wait(timeout=10)
                stored = SQLAlchemyContactRepository(session).save_external_contact(_TENANT_A, candidate)
                return "winner", str(stored.id)
        except ContactError as error:
            return "conflict", error.code.value

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = tuple(executor.map(save, candidates))

    assert sorted(outcome for outcome, _value in outcomes) == ["conflict", "winner"]
    assert [value for outcome, value in outcomes if outcome == "conflict"] == [ContactErrorCode.CONFLICT.value]
    winner_id = next(value for outcome, value in outcomes if outcome == "winner")
    with database_context.sessions() as session:
        profiles = tuple(session.scalars(select(HumanInputExternalContactProfile)))
        identities = tuple(
            session.scalars(
                select(HumanInputContactIdentity).where(
                    HumanInputContactIdentity.id.in_((str(_EXTERNAL_A), str(_EXTERNAL_B)))
                )
            )
        )
    assert len(profiles) == len(identities) == 1
    assert profiles[0].normalized_email == "shared.external@example.com"
    assert profiles[0].contact_id == winner_id
    assert identities[0].id == winner_id


def test_count_and_list_share_keyword_and_type_predicates(database_context: _DatabaseContext) -> None:
    with database_context.sessions.begin() as session:
        session.add_all(
            (
                _tenant(_TENANT_A, "Predicate parity"),
                _account(_ACCOUNT_A, "Workspace Alice", "workspace.alice@example.com"),
                _account(_ACCOUNT_B, "Platform Bob", "platform.bob@example.com"),
                _account(_ADMIN_ACCOUNT, "Admin", "admin@example.com"),
                _membership(_TENANT_A, _ACCOUNT_A),
            )
        )
    with database_context.sessions.begin() as session:
        repository = SQLAlchemyContactRepository(session)
        workspace_id = repository.provision_account_backed_contact(_ACCOUNT_A)
        platform_id = repository.provision_account_backed_contact(_ACCOUNT_B)
        repository.create_platform_entry(_TENANT_A, platform_id, _ADMIN_ACCOUNT)
        external = repository.save_external_contact(
            _TENANT_A,
            _external(_EXTERNAL_A, "External Carol", "external.carol@example.com"),
        )

    expected_by_query = (
        (ContactQuery(), {workspace_id, platform_id, external.id}),
        (ContactQuery(contact_type=ContactType.WORKSPACE), {workspace_id}),
        (ContactQuery(contact_type=ContactType.PLATFORM), {platform_id}),
        (ContactQuery(contact_type=ContactType.EXTERNAL), {external.id}),
        (ContactQuery(keyword="ALICE"), {workspace_id}),
        (ContactQuery(keyword="platform.bob@"), {platform_id}),
        (ContactQuery(keyword="carol", contact_type=ContactType.EXTERNAL), {external.id}),
        (ContactQuery(keyword="missing"), set()),
    )
    with database_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        for query, expected_ids in expected_by_query:
            page = repository.list_contact(_TENANT_A, page=1, limit=100, query=query)
            assert repository.count_contact(_TENANT_A, query) == len(page.items)
            assert {contact.id for contact in page.items} == expected_ids


def test_tenant_scoped_reads_and_external_ownership_are_isolated(database_context: _DatabaseContext) -> None:
    shared_email = "tenant.shared@example.com"
    with database_context.sessions.begin() as session:
        session.add_all((_tenant(_TENANT_A, "Tenant A"), _tenant(_TENANT_B, "Tenant B")))
    with database_context.sessions.begin() as session:
        repository = SQLAlchemyContactRepository(session)
        contact_a = repository.save_external_contact(
            _TENANT_A,
            _external(_EXTERNAL_A, "Tenant A External", shared_email),
        )
        contact_b = repository.save_external_contact(
            _TENANT_B,
            _external(_EXTERNAL_B, "Tenant B External", shared_email),
        )

    with database_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        assert repository.get_contacts_by_id(_TENANT_A, contact_a.id) == contact_a
        assert repository.get_contacts_by_id(_TENANT_A, contact_b.id) is None
        assert repository.get_contacts_by_ids(_TENANT_A, (contact_a.id, contact_b.id)) == (contact_a,)
        assert repository.available(_TENANT_A, (contact_a.id, contact_b.id)) == {
            contact_a.id: True,
            contact_b.id: False,
        }
        assert repository.query_contacts_by_email(_TENANT_A, (shared_email,)) == (contact_a,)
        assert repository.query_contacts_by_email(_TENANT_B, (shared_email,)) == (contact_b,)

    with pytest.raises(ContactError) as wrong_save:
        with database_context.sessions.begin() as session:
            SQLAlchemyContactRepository(session).save_external_contact(
                _TENANT_B,
                _external(contact_a.id, "Ownership Violation", shared_email),
            )
    assert wrong_save.value.code is ContactErrorCode.INVALID_OWNER

    with pytest.raises(ContactError) as wrong_delete:
        with database_context.sessions.begin() as session:
            SQLAlchemyContactRepository(session).delete_external_contact(
                _TENANT_B,
                _external(contact_a.id, contact_a.name, contact_a.email or shared_email),
            )
    assert wrong_delete.value.code is ContactErrorCode.NOT_FOUND

    with database_context.sessions() as session:
        assert session.get(HumanInputContactIdentity, str(contact_a.id)) is not None
        assert session.get(HumanInputContactIdentity, str(contact_b.id)) is not None


def test_caller_rollback_removes_partial_external_identity_and_profile(database_context: _DatabaseContext) -> None:
    with database_context.sessions.begin() as session:
        session.add(_tenant(_TENANT_A, "External rollback"))

    def save_external_then_fail() -> None:
        with database_context.sessions.begin() as session:
            SQLAlchemyContactRepository(session).save_external_contact(
                _TENANT_A,
                _external(_ROLLBACK_EXTERNAL, "Rollback External", "rollback-external@example.com"),
            )
            raise _InjectedFailureError

    with pytest.raises(_InjectedFailureError):
        save_external_then_fail()

    with database_context.sessions() as session:
        assert session.get(HumanInputContactIdentity, str(_ROLLBACK_EXTERNAL)) is None
        assert session.get(HumanInputExternalContactProfile, str(_ROLLBACK_EXTERNAL)) is None


def test_caller_rollback_removes_partial_account_identity_and_platform_entry(
    database_context: _DatabaseContext,
) -> None:
    with database_context.sessions.begin() as session:
        session.add_all(
            (
                _tenant(_TENANT_A, "Platform rollback"),
                _account(_ACCOUNT_A, "Rollback Account", "rollback-account@example.com"),
                _account(_ADMIN_ACCOUNT, "Admin", "rollback-admin@example.com"),
            )
        )

    provisioned_ids: list[ContactId] = []

    def provision_and_publish_then_fail() -> None:
        with database_context.sessions.begin() as session:
            repository = SQLAlchemyContactRepository(session)
            provisioned_id = repository.provision_account_backed_contact(_ACCOUNT_A)
            provisioned_ids.append(provisioned_id)
            repository.create_platform_entry(_TENANT_A, provisioned_id, _ADMIN_ACCOUNT)
            raise _InjectedFailureError

    with pytest.raises(_InjectedFailureError):
        provision_and_publish_then_fail()

    assert len(provisioned_ids) == 1
    with database_context.sessions() as session:
        assert session.get(HumanInputContactIdentity, str(provisioned_ids[0])) is None
        assert session.scalar(select(func.count(HumanInputPlatformContactWorkspaceEntry.id))) == 0


class _OwnedWriteLock:
    def ensure_owned(self) -> None:
        pass

    def extend(self) -> None:
        pass


def test_caller_rollback_is_atomic_for_session_bound_im_reconciliation(database_context: _DatabaseContext) -> None:
    with database_context.sessions.begin() as session:
        session.add(_tenant(_TENANT_A, "IM rollback"))
        integration = HumanInputIMIntegration(
            provider=IMProvider.FEISHU,
            encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
            tenant_id=str(_TENANT_A),
            provider_tenant_id="provider-tenant-1",
            app_identifier="app-1",
            status=IMIntegrationStatus.CONFIGURED,
            config_version=1,
        )
        integration.id = str(_INTEGRATION_ID)
        session.add(integration)
        run_ref = ReconciliationRunRef(
            _SYNC_RUN_ID,
            IntegrationRevisionToken(_INTEGRATION_ID, 1),
            IMProvider.FEISHU,
        )
        run = IMSyncRun.create(
            sync_run_id=run_ref.sync_run_id,
            integration_revision=run_ref.integration_revision,
            provider=run_ref.provider,
            started_by_account_id=None,
            now=_NOW,
        )
        session.add(sync_run_to_record(run))

    generated = SyncReconciler.generate_plan(
        ReconciliationInput(
            run_ref,
            (DirectoryEntry(ProviderUserId("provider-user-1"), "Unmatched User", None),),
            (),
            (),
            frozenset(),
            (),
        )
    )
    assert isinstance(generated, ReconciliationPlan)

    def apply_then_fail() -> None:
        with database_context.sessions.begin() as session:
            repository = SQLAlchemySessionBoundIMRepository(session, _OwnedWriteLock())
            result = repository.apply_plan(generated, now=_NOW)
            assert result.status is ApplyReconciliationStatus.APPLIED
            session.flush()
            assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 1
            assert session.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 1
            assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 1
            raise _InjectedFailureError

    with pytest.raises(_InjectedFailureError):
        apply_then_fail()

    with database_context.sessions() as session:
        stored_run = session.get_one(HumanInputIMSyncRun, str(_SYNC_RUN_ID))
        assert stored_run.status is IMSyncRunStatus.QUEUED
        assert session.scalar(select(func.count(HumanInputIMIdentity.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMBinding.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMReconciliationChange.id))) == 0
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 0

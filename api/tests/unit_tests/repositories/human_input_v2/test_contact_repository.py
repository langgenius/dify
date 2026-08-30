"""SQLite contracts for the current Contact repository."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.contact import ContactQuery, ContactType
from core.human_input_v2.shared import AccountId, ContactId, TenantId
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputExternalContactProfile,
    HumanInputPlatformContactWorkspaceEntry,
)
from repositories.human_input_v2.contact import SQLAlchemyContactRepository

_NOW = datetime(2026, 8, 30, 8)
_TENANT_A = TenantId("00000000-0000-0000-0000-000000000101")
_TENANT_B = TenantId("00000000-0000-0000-0000-000000000102")
_ADMIN_ACCOUNT = AccountId("00000000-0000-0000-0000-000000000199")
_MISSING_CONTACT = ContactId("00000000-0000-0000-0000-000000000999")


@dataclass(frozen=True, slots=True)
class _ContactIds:
    workspace_shared: ContactId
    platform_beta: ContactId
    external_shared: ContactId
    workspace_delta: ContactId
    platform_echo: ContactId
    external_foxtrot: ContactId
    inactive: ContactId
    unavailable: ContactId
    foreign_platform: ContactId
    foreign_external: ContactId

    @property
    def visible(self) -> tuple[ContactId, ...]:
        return (
            self.workspace_shared,
            self.platform_beta,
            self.external_shared,
            self.workspace_delta,
            self.platform_echo,
            self.external_foxtrot,
        )


@dataclass(frozen=True, slots=True)
class _RepositoryContext:
    engine: Engine
    sessions: sessionmaker[Session]
    contact_ids: _ContactIds
    candidate_ids: tuple[ContactId, ...]


def _tenant(tenant_id: TenantId, name: str) -> Tenant:
    tenant = Tenant(name=name)
    tenant.id = str(tenant_id)
    return tenant


def _account(
    account_id: AccountId,
    *,
    name: str,
    email: str,
    created_at: datetime,
    status: AccountStatus = AccountStatus.ACTIVE,
) -> Account:
    account = Account(name=name, email=email, status=status)
    account.id = str(account_id)
    account.created_at = created_at
    account.updated_at = created_at
    return account


def _account_identity(account_id: AccountId, contact_id: ContactId, created_at: datetime) -> HumanInputContactIdentity:
    identity = HumanInputContactIdentity(
        subject_type=ContactSubjectType.ACCOUNT,
        account_id=str(account_id),
    )
    identity.id = str(contact_id)
    identity.created_at = created_at
    identity.updated_at = created_at
    return identity


def _membership(tenant_id: TenantId, account_id: AccountId) -> TenantAccountJoin:
    return TenantAccountJoin(
        tenant_id=str(tenant_id),
        account_id=str(account_id),
        role=TenantAccountRole.NORMAL,
    )


def _platform_entry(
    tenant_id: TenantId,
    contact_id: ContactId,
    *,
    created_at: datetime,
) -> HumanInputPlatformContactWorkspaceEntry:
    entry = HumanInputPlatformContactWorkspaceEntry(
        tenant_id=str(tenant_id),
        contact_id=str(contact_id),
        added_by_account_id=str(_ADMIN_ACCOUNT),
    )
    entry.created_at = created_at
    entry.updated_at = created_at
    return entry


def _external_records(
    tenant_id: TenantId,
    contact_id: ContactId,
    *,
    name: str,
    email: str,
    created_at: datetime,
) -> tuple[HumanInputContactIdentity, HumanInputExternalContactProfile]:
    identity = HumanInputContactIdentity(subject_type=ContactSubjectType.EXTERNAL)
    identity.id = str(contact_id)
    identity.created_at = created_at
    identity.updated_at = created_at
    profile = HumanInputExternalContactProfile(
        contact_id=str(contact_id),
        tenant_id=str(tenant_id),
        name=name,
        normalized_name=name.casefold(),
        email=email,
        normalized_email=email.strip().casefold(),
        avatar_file_id=None,
    )
    profile.created_at = created_at
    profile.updated_at = created_at
    return identity, profile


@pytest.fixture
def contact_repository_context(sqlite_engine: Engine) -> _RepositoryContext:
    ids = _ContactIds(
        workspace_shared=ContactId("00000000-0000-0000-0000-000000000301"),
        platform_beta=ContactId("00000000-0000-0000-0000-000000000302"),
        external_shared=ContactId("00000000-0000-0000-0000-000000000303"),
        workspace_delta=ContactId("00000000-0000-0000-0000-000000000304"),
        platform_echo=ContactId("00000000-0000-0000-0000-000000000305"),
        external_foxtrot=ContactId("00000000-0000-0000-0000-000000000306"),
        inactive=ContactId("00000000-0000-0000-0000-000000000307"),
        unavailable=ContactId("00000000-0000-0000-0000-000000000308"),
        foreign_platform=ContactId("00000000-0000-0000-0000-000000000309"),
        foreign_external=ContactId("00000000-0000-0000-0000-000000000310"),
    )
    account_specs = (
        (
            AccountId("00000000-0000-0000-0000-000000000201"),
            ids.workspace_shared,
            "Alpha Shared",
            "Shared@Example.com",
            AccountStatus.ACTIVE,
        ),
        (
            AccountId("00000000-0000-0000-0000-000000000202"),
            ids.platform_beta,
            "Beta Platform",
            "beta@example.com",
            AccountStatus.ACTIVE,
        ),
        (
            AccountId("00000000-0000-0000-0000-000000000204"),
            ids.workspace_delta,
            "Delta Workspace",
            "delta@example.com",
            AccountStatus.ACTIVE,
        ),
        (
            AccountId("00000000-0000-0000-0000-000000000205"),
            ids.platform_echo,
            "Echo Shared",
            "echo@example.com",
            AccountStatus.ACTIVE,
        ),
        (
            AccountId("00000000-0000-0000-0000-000000000207"),
            ids.inactive,
            "Inactive Account",
            "inactive@example.com",
            AccountStatus.BANNED,
        ),
        (
            AccountId("00000000-0000-0000-0000-000000000208"),
            ids.unavailable,
            "Unavailable Candidate",
            "unavailable@example.com",
            AccountStatus.ACTIVE,
        ),
        (
            AccountId("00000000-0000-0000-0000-000000000209"),
            ids.foreign_platform,
            "Foreign Platform",
            "foreign-platform@example.com",
            AccountStatus.ACTIVE,
        ),
    )
    account_rows: list[object] = [
        _tenant(_TENANT_A, "Tenant A"),
        _tenant(_TENANT_B, "Tenant B"),
        _account(
            _ADMIN_ACCOUNT,
            name="Admin",
            email="admin@example.com",
            created_at=_NOW - timedelta(minutes=1),
        ),
    ]
    candidate_ids: list[ContactId] = []
    for position, (account_id, contact_id, name, email, status) in enumerate(account_specs, start=1):
        created_at = _NOW + timedelta(minutes=position)
        account_rows.extend(
            (
                _account(account_id, name=name, email=email, status=status, created_at=created_at),
                _account_identity(account_id, contact_id, created_at),
            )
        )
        if status is AccountStatus.ACTIVE:
            candidate_ids.append(contact_id)

    external_shared = _external_records(
        _TENANT_A,
        ids.external_shared,
        name="Charlie Shared",
        email="shared@example.com",
        created_at=_NOW + timedelta(minutes=3),
    )
    external_foxtrot = _external_records(
        _TENANT_A,
        ids.external_foxtrot,
        name="Foxtrot External",
        email="foxtrot@example.com",
        created_at=_NOW + timedelta(minutes=6),
    )
    foreign_external = _external_records(
        _TENANT_B,
        ids.foreign_external,
        name="Foreign Shared",
        email="shared@example.com",
        created_at=_NOW + timedelta(minutes=10),
    )
    account_rows.extend(
        (
            _membership(_TENANT_A, AccountId("00000000-0000-0000-0000-000000000201")),
            _platform_entry(_TENANT_A, ids.workspace_shared, created_at=_NOW + timedelta(minutes=1)),
            _platform_entry(_TENANT_A, ids.platform_beta, created_at=_NOW + timedelta(minutes=2)),
            _membership(_TENANT_A, AccountId("00000000-0000-0000-0000-000000000204")),
            _platform_entry(_TENANT_A, ids.platform_echo, created_at=_NOW + timedelta(minutes=5)),
            _membership(_TENANT_A, AccountId("00000000-0000-0000-0000-000000000207")),
            _platform_entry(_TENANT_B, ids.foreign_platform, created_at=_NOW + timedelta(minutes=9)),
            *external_shared,
            *external_foxtrot,
            *foreign_external,
        )
    )
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        session.add_all(account_rows)

    return _RepositoryContext(sqlite_engine, sessions, ids, tuple(candidate_ids))


@pytest.mark.parametrize(
    ("query", "expected_attribute"),
    [
        (ContactQuery(), "visible"),
        (ContactQuery(keyword="  SHARED  "), "shared"),
        (ContactQuery(contact_type=ContactType.WORKSPACE), "workspace"),
        (ContactQuery(contact_type=ContactType.PLATFORM), "platform"),
        (ContactQuery(contact_type=ContactType.EXTERNAL), "external"),
    ],
)
def test_count_and_list_apply_identical_filters(
    contact_repository_context: _RepositoryContext,
    query: ContactQuery,
    expected_attribute: str,
) -> None:
    ids = contact_repository_context.contact_ids
    expected_by_attribute = {
        "visible": set(ids.visible),
        "shared": {ids.workspace_shared, ids.external_shared, ids.platform_echo},
        "workspace": {ids.workspace_shared, ids.workspace_delta},
        "platform": {ids.platform_beta, ids.platform_echo},
        "external": {ids.external_shared, ids.external_foxtrot},
    }
    with contact_repository_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        contact_page = repository.list_contact(_TENANT_A, page=1, limit=100, query=query)
        count = repository.count_contact(_TENANT_A, query)

    expected_ids = expected_by_attribute[expected_attribute]
    assert count == len(expected_ids)
    assert {contact.id for contact in contact_page.items} == expected_ids


def test_filtering_precedes_pagination(contact_repository_context: _RepositoryContext) -> None:
    ids = contact_repository_context.contact_ids
    query = ContactQuery(keyword="shared")

    with contact_repository_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        second_match = repository.list_contact(_TENANT_A, page=2, limit=1, query=query)

    assert tuple(contact.id for contact in second_match.items) == (ids.external_shared,)


@pytest.mark.parametrize(
    ("page", "expected_slice"),
    [
        (1, slice(0, 2)),
        (2, slice(2, 4)),
        (3, slice(4, 6)),
        (4, slice(6, 8)),
    ],
    ids=("first", "middle", "final", "out-of-range"),
)
def test_list_contact_page_boundaries(
    contact_repository_context: _RepositoryContext,
    page: int,
    expected_slice: slice,
) -> None:
    expected_ids = contact_repository_context.contact_ids.visible[expected_slice]

    with contact_repository_context.sessions() as session:
        contact_page = SQLAlchemyContactRepository(session).list_contact(_TENANT_A, page=page, limit=2)

    assert tuple(contact.id for contact in contact_page.items) == expected_ids
    assert contact_page.page == page
    assert contact_page.limit == 2


@pytest.mark.parametrize(("page", "limit"), [(0, 1), (-1, 1), (1, 0), (1, -1)])
def test_list_contact_rejects_non_positive_page_boundaries(
    contact_repository_context: _RepositoryContext,
    page: int,
    limit: int,
) -> None:
    with contact_repository_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        with pytest.raises(ValueError, match="must be positive"):
            repository.list_contact(_TENANT_A, page=page, limit=limit)


def test_public_count_and_list_calls_use_bounded_database_queries_and_indexed_owner_lookups(
    contact_repository_context: _RepositoryContext,
) -> None:
    captured: list[tuple[str, tuple[object, ...]]] = []

    def capture_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        parameters: tuple[object, ...],
        _context: object,
        _executemany: bool,
    ) -> None:
        captured.append((statement, parameters))

    event.listen(contact_repository_context.engine, "before_cursor_execute", capture_statement)
    try:
        with contact_repository_context.sessions() as session:
            repository = SQLAlchemyContactRepository(session)
            repository.count_contact(_TENANT_A, ContactQuery(keyword="shared"))
            repository.list_contact(_TENANT_A, page=2, limit=1, query=ContactQuery(keyword="shared"))
    finally:
        event.remove(contact_repository_context.engine, "before_cursor_execute", capture_statement)

    assert len(captured) == 2
    list_statement, list_parameters = captured[1]
    assert "LIMIT" in list_statement.upper()
    assert "OFFSET" in list_statement.upper()
    with contact_repository_context.engine.connect() as connection:
        plan_rows = connection.exec_driver_sql(
            f"EXPLAIN QUERY PLAN {list_statement}",
            list_parameters,
        ).all()

    plan = "\n".join(str(row[-1]) for row in plan_rows)
    assert "tenant_account_joins" in plan
    assert "human_input_platform_contact_workspace_entries" in plan
    assert "human_input_external_contact_profiles" in plan
    assert "USING" in plan


def test_detail_batch_and_availability_are_tenant_scoped_and_order_agnostic(
    contact_repository_context: _RepositoryContext,
) -> None:
    ids = contact_repository_context.contact_ids
    requested_ids = (
        ids.workspace_shared,
        ids.platform_beta,
        ids.workspace_shared,
        ids.inactive,
        ids.unavailable,
        ids.foreign_platform,
        ids.foreign_external,
        _MISSING_CONTACT,
    )

    with contact_repository_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        assert repository.get_contacts_by_id(_TENANT_A, ids.workspace_shared) is not None
        for unavailable_id in (
            ids.inactive,
            ids.unavailable,
            ids.foreign_platform,
            ids.foreign_external,
            _MISSING_CONTACT,
        ):
            assert repository.get_contacts_by_id(_TENANT_A, unavailable_id) is None
        contacts = repository.get_contacts_by_ids(_TENANT_A, requested_ids)
        availability = repository.available(_TENANT_A, requested_ids)
        foreign_contacts = repository.get_contacts_by_ids(
            _TENANT_B,
            (ids.foreign_platform, ids.foreign_external),
        )
        foreign_availability = repository.available(
            _TENANT_B,
            (ids.foreign_platform, ids.foreign_external),
        )

    returned_ids = {contact.id for contact in contacts}
    assert returned_ids == {ids.workspace_shared, ids.platform_beta}
    assert len(contacts) == len(returned_ids)
    assert availability == {
        ids.workspace_shared: True,
        ids.platform_beta: True,
        ids.inactive: False,
        ids.unavailable: False,
        ids.foreign_platform: False,
        ids.foreign_external: False,
        _MISSING_CONTACT: False,
    }
    assert {contact.id for contact in foreign_contacts} == {ids.foreign_platform, ids.foreign_external}
    assert foreign_availability == {ids.foreign_platform: True, ids.foreign_external: True}


def test_account_and_external_contacts_with_one_normalized_email_both_match(
    contact_repository_context: _RepositoryContext,
) -> None:
    ids = contact_repository_context.contact_ids

    with contact_repository_context.sessions() as session:
        contacts = SQLAlchemyContactRepository(session).query_contacts_by_email(
            _TENANT_A,
            ("  SHARED@example.COM  ", "shared@example.com"),
        )

    assert {contact.id for contact in contacts} == {ids.workspace_shared, ids.external_shared}
    assert len(contacts) == 2


def test_membership_takes_precedence_over_platform_visibility(
    contact_repository_context: _RepositoryContext,
) -> None:
    contact_id = contact_repository_context.contact_ids.workspace_shared

    with contact_repository_context.sessions() as session:
        contact = SQLAlchemyContactRepository(session).get_contacts_by_id(_TENANT_A, contact_id)

    assert contact is not None
    assert contact.id == contact_id
    assert contact.type is ContactType.WORKSPACE


def test_organization_candidate_count_list_keyword_and_pagination_share_one_candidate_set(
    contact_repository_context: _RepositoryContext,
) -> None:
    expected_ids = set(contact_repository_context.candidate_ids)

    with contact_repository_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        first_page = repository.list_organization_candidates(page=1, limit=2)
        middle_page = repository.list_organization_candidates(page=2, limit=2)
        final_page = repository.list_organization_candidates(page=3, limit=2)
        out_of_range = repository.list_organization_candidates(page=4, limit=2)
        count = repository.count_organization_candidates()
        keyword_page = repository.list_organization_candidates(page=1, limit=10, keyword="UNAVAILABLE")
        keyword_count = repository.count_organization_candidates(keyword="  unavailable  ")

    paged_ids = {candidate.id for candidate in (*first_page, *middle_page, *final_page)}
    assert count == len(expected_ids)
    assert paged_ids == expected_ids
    assert out_of_range == ()
    assert keyword_count == len(keyword_page) == 1
    assert {candidate.id for candidate in keyword_page} == {contact_repository_context.contact_ids.unavailable}


def test_candidate_contact_id_round_trips_through_platform_entry_creation(
    contact_repository_context: _RepositoryContext,
) -> None:
    expected_id = contact_repository_context.contact_ids.unavailable

    with contact_repository_context.sessions.begin() as session:
        repository = SQLAlchemyContactRepository(session)
        candidates = repository.list_organization_candidates(page=1, limit=10, keyword="unavailable")
        assert len(candidates) == 1
        candidate = candidates[0]
        repository.create_platform_entry(_TENANT_A, candidate.id, _ADMIN_ACCOUNT)
        created_contact = repository.get_contacts_by_id(_TENANT_A, candidate.id)

    assert candidate.id == expected_id
    assert created_contact is not None
    assert created_contact.id == candidate.id
    assert created_contact.type is ContactType.PLATFORM


@pytest.mark.parametrize(("page", "limit"), [(0, 1), (-1, 1), (1, 0), (1, -1)])
def test_organization_candidate_list_rejects_non_positive_page_boundaries(
    contact_repository_context: _RepositoryContext,
    page: int,
    limit: int,
) -> None:
    with contact_repository_context.sessions() as session:
        repository = SQLAlchemyContactRepository(session)
        with pytest.raises(ValueError, match="must be positive"):
            repository.list_organization_candidates(page=page, limit=limit)

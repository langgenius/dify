from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import EndUserType
from models.model import EndUser
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.entities.app_scoped_end_user_entities import AppScopedEndUserRecord, NewAppScopedEndUser

_END_USER_ID = "11111111-1111-1111-1111-111111111111"
_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_APP_ID = "33333333-3333-3333-3333-333333333333"


def _persist_end_user(session: Session) -> None:
    timestamp = datetime(2026, 1, 1)
    end_user = EndUser(
        id=_END_USER_ID,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        type=EndUserType.SERVICE_API,
        external_user_id="external-1",
        name="Alice",
        _is_anonymous=True,
        session_id="session-1",
    )
    end_user.created_at = timestamp
    end_user.updated_at = timestamp
    session.add(end_user)
    session.commit()


def test_find_by_id_returns_detached_read_contract(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_end_user(sqlite_session)

    result = AppScopedEndUserRepo(session_factory=sqlite_session_factory).find_by_id(
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        end_user_id=_END_USER_ID,
    )

    assert result == AppScopedEndUserRecord(
        id=_END_USER_ID,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        type=EndUserType.SERVICE_API.value,
        external_user_id="external-1",
        name="Alice",
        is_anonymous=True,
        session_id="session-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
    )


def test_find_by_id_scopes_reads_to_tenant_and_app(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_end_user(sqlite_session)
    repository = AppScopedEndUserRepo(session_factory=sqlite_session_factory)

    assert (
        repository.find_by_id(
            tenant_id="44444444-4444-4444-4444-444444444444",
            app_id=_APP_ID,
            end_user_id=_END_USER_ID,
        )
        is None
    )
    assert (
        repository.find_by_id(
            tenant_id=_TENANT_ID,
            app_id="55555555-5555-5555-5555-555555555555",
            end_user_id=_END_USER_ID,
        )
        is None
    )


def test_create_flushes_before_returning_stored_metadata(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = AppScopedEndUserRepo(session_factory=sqlite_session_factory)

    stored = repository.create(
        NewAppScopedEndUser(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            type=EndUserType.SERVICE_API.value,
            is_anonymous=False,
            session_id="session-1",
            external_user_id="session-1",
        )
    )

    assert stored.id
    assert stored.value.id == stored.id


def test_get_or_create_reuses_and_upgrades_an_existing_end_user(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_end_user(sqlite_session)
    repository = AppScopedEndUserRepo(session_factory=sqlite_session_factory)

    result = AppScopedEndUserService(end_users=repository).get_or_create_end_user_by_type(
        EndUserType.OPENAPI,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        user_id="session-1",
    )

    assert result.id == _END_USER_ID
    assert result.type == EndUserType.OPENAPI
    with sqlite_session_factory() as observer:
        persisted = observer.get(EndUser, _END_USER_ID)
        assert persisted is not None
        assert persisted.type == EndUserType.OPENAPI


def test_get_or_create_batch_reuses_existing_users_and_creates_missing_ones(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_end_user(sqlite_session)
    repository = AppScopedEndUserRepo(session_factory=sqlite_session_factory)
    second_app_id = "66666666-6666-6666-6666-666666666666"

    result = AppScopedEndUserService(end_users=repository).create_end_user_batch(
        EndUserType.SERVICE_API,
        tenant_id=_TENANT_ID,
        app_ids=[_APP_ID, second_app_id],
        user_id="session-1",
    )

    assert result[_APP_ID].id == _END_USER_ID
    assert result[second_app_id].id
    assert result[second_app_id].app_id == second_app_id
    assert result[second_app_id].external_user_id == "session-1"
    assert result[second_app_id]._is_anonymous is False


def _persist_end_user_with_type(
    session: Session,
    *,
    end_user_id: str,
    type: EndUserType,
    created_at: datetime,
    session_id: str = "session-1",
) -> None:
    end_user = EndUser(
        id=end_user_id,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        type=type,
        external_user_id="external-1",
        name="Alice",
        _is_anonymous=True,
        session_id=session_id,
    )
    end_user.created_at = created_at
    end_user.updated_at = created_at
    session.add(end_user)
    session.commit()


def _count_end_users(
    session_factory: sessionmaker[Session],
    *,
    tenant_id: str,
    app_id: str,
    session_id: str,
) -> int:
    statement = select(func.count(EndUser.id)).where(
        EndUser.tenant_id == tenant_id,
        EndUser.app_id == app_id,
        EndUser.session_id == session_id,
    )
    with session_factory() as session:
        return session.scalar(statement) or 0


def test_create_returns_existing_row_instead_of_creating_a_duplicate(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Concurrent first requests must not create duplicate end_users rows (#46267)."""
    _persist_end_user(sqlite_session)
    repository = AppScopedEndUserRepo(session_factory=sqlite_session_factory)

    stored = repository.create(
        NewAppScopedEndUser(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            type=EndUserType.SERVICE_API.value,
            is_anonymous=False,
            session_id="session-1",
            external_user_id="session-1",
        )
    )

    assert stored.id == _END_USER_ID
    assert _count_end_users(sqlite_session_factory, tenant_id=_TENANT_ID, app_id=_APP_ID, session_id="session-1") == 1


def test_find_by_session_returns_oldest_row_first(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Once duplicates exist, the row a request resolves to must be stable (#46267).

    The two rows are inserted newest-first by type order so that only an
    explicit ORDER BY can return them oldest-first.
    """
    _persist_end_user_with_type(
        sqlite_session,
        end_user_id="44444444-4444-4444-4444-444444444444",
        type=EndUserType.SERVICE_API,
        created_at=datetime(2026, 1, 1),
    )
    _persist_end_user_with_type(
        sqlite_session,
        end_user_id="55555555-5555-5555-5555-555555555555",
        type=EndUserType.BROWSER,
        created_at=datetime(2026, 1, 2),
    )
    repository = AppScopedEndUserRepo(session_factory=sqlite_session_factory)

    found = repository.find_by_session(tenant_id=_TENANT_ID, app_id=_APP_ID, user_id="session-1")

    assert [row.id for row in found] == [
        "44444444-4444-4444-4444-444444444444",
        "55555555-5555-5555-5555-555555555555",
    ]


def test_create_batch_returns_existing_row_on_conflict(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """A batch racing another first request must reuse the existing row (#46267)."""
    _persist_end_user(sqlite_session)
    repository = AppScopedEndUserRepo(session_factory=sqlite_session_factory)
    second_app_id = "66666666-6666-6666-6666-666666666666"

    created = repository.create_batch(
        [
            NewAppScopedEndUser(
                tenant_id=_TENANT_ID,
                app_id=_APP_ID,
                type=EndUserType.SERVICE_API.value,
                is_anonymous=False,
                session_id="session-1",
                external_user_id="session-1",
            ),
            NewAppScopedEndUser(
                tenant_id=_TENANT_ID,
                app_id=second_app_id,
                type=EndUserType.SERVICE_API.value,
                is_anonymous=False,
                session_id="session-1",
                external_user_id="session-1",
            ),
        ]
    )

    assert created[0].id == _END_USER_ID
    assert created[1].app_id == second_app_id
    assert _count_end_users(sqlite_session_factory, tenant_id=_TENANT_ID, app_id=_APP_ID, session_id="session-1") == 1

import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.model import AccountTrialAppRecord, App, AppMode, TrialApp
from repositories.trial_app_repository import TrialAppRepository
from services.trial_app_access_service import (
    TrialAppAccessService,
    TrialAppAccessSnapshot,
    TrialAppRef,
    TrialAppUnavailableError,
    TrialAppUsageLimitExceededError,
)

_APP_ID = "11111111-1111-1111-1111-111111111111"
_OWNER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_ACCOUNT_ID = "33333333-3333-3333-3333-333333333333"
_OTHER_APP_ID = "44444444-4444-4444-4444-444444444444"
_OTHER_ACCOUNT_ID = "55555555-5555-5555-5555-555555555555"
_OTHER_TENANT_ID = "66666666-6666-6666-6666-666666666666"


def _add_app(session: Session) -> None:
    session.add(
        App(
            id=_APP_ID,
            tenant_id=_OWNER_TENANT_ID,
            name="Trial App",
            mode=AppMode.CHAT,
            enable_site=True,
            enable_api=False,
        )
    )


def _add_trial(session: Session, *, trial_limit: int = 3) -> None:
    # The actual app owner can differ from the tenant stored on the trial listing.
    session.add(TrialApp(app_id=_APP_ID, tenant_id=_OTHER_TENANT_ID, trial_limit=trial_limit))


def test_existing_ids_returns_only_trial_apps(sqlite_session_factory: sessionmaker[Session]) -> None:
    eligible_id = str(uuid.uuid4())
    other_id = str(uuid.uuid4())
    with sqlite_session_factory() as session:
        session.add(TrialApp(app_id=eligible_id, tenant_id=str(uuid.uuid4())))
        session.commit()

    result = TrialAppRepository(sqlite_session_factory).existing_ids([eligible_id, other_id])

    assert result == frozenset({eligible_id})


def test_existing_ids_skips_session_for_empty_input() -> None:
    session_factory = MagicMock(spec=sessionmaker)

    result = TrialAppRepository(session_factory).existing_ids([])

    assert result == frozenset()
    session_factory.assert_not_called()


def test_resolve_returns_actual_app_owner_and_account_usage(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        _add_app(session)
        _add_trial(session)
        session.add(AccountTrialAppRecord(app_id=_APP_ID, account_id=_ACCOUNT_ID, count=2))

    result = TrialAppRepository(sqlite_session_factory).resolve(app_id=_APP_ID, account_id=_ACCOUNT_ID)

    assert result == TrialAppAccessSnapshot(
        app=TrialAppRef(app_id=_APP_ID, tenant_id=_OWNER_TENANT_ID, app_mode="chat"),
        trial_limit=3,
        used_count=2,
    )


@pytest.mark.parametrize(("has_app", "has_trial"), [(False, False), (True, False), (False, True)])
def test_resolve_requires_both_trial_listing_and_app(
    sqlite_session_factory: sessionmaker[Session], has_app: bool, has_trial: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        if has_app:
            _add_app(session)
        if has_trial:
            _add_trial(session)
        session.add_all(
            [
                App(
                    id=_OTHER_APP_ID,
                    tenant_id=_OTHER_TENANT_ID,
                    name="Another trial app",
                    mode=AppMode.CHAT,
                    enable_site=True,
                    enable_api=False,
                ),
                TrialApp(app_id=_OTHER_APP_ID, tenant_id=_OTHER_TENANT_ID, trial_limit=3),
            ]
        )

    repository = TrialAppRepository(sqlite_session_factory)
    assert repository.resolve(app_id=_OTHER_APP_ID, account_id=_ACCOUNT_ID) == TrialAppAccessSnapshot(
        app=TrialAppRef(app_id=_OTHER_APP_ID, tenant_id=_OTHER_TENANT_ID, app_mode="chat"),
        trial_limit=3,
        used_count=None,
    )
    assert repository.resolve(app_id=_APP_ID, account_id=_ACCOUNT_ID) is None
    with pytest.raises(TrialAppUnavailableError, match=_APP_ID):
        TrialAppAccessService(apps=repository).get_access(app_id=_APP_ID, account_id=_ACCOUNT_ID)


def test_resolve_does_not_use_other_account_or_app_usage(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        _add_app(session)
        _add_trial(session)
        session.add_all(
            [
                AccountTrialAppRecord(app_id=_APP_ID, account_id=_OTHER_ACCOUNT_ID, count=10),
                AccountTrialAppRecord(app_id=_OTHER_APP_ID, account_id=_ACCOUNT_ID, count=10),
            ]
        )

    repository = TrialAppRepository(sqlite_session_factory)
    result = repository.resolve(app_id=_APP_ID, account_id=_ACCOUNT_ID)

    assert result is not None
    assert result.used_count is None
    assert TrialAppAccessService(apps=repository).get_access(app_id=_APP_ID, account_id=_ACCOUNT_ID) == result.app


@pytest.mark.parametrize(
    ("trial_limit", "used_count", "allowed"),
    [
        pytest.param(3, None, True, id="first-use"),
        pytest.param(0, None, True, id="first-use-zero-limit"),
        pytest.param(-1, None, True, id="first-use-negative-limit"),
        pytest.param(3, 0, True, id="zero-count"),
        pytest.param(3, 2, True, id="below-limit"),
        pytest.param(3, 3, False, id="at-limit"),
        pytest.param(3, 4, False, id="over-limit"),
        pytest.param(0, 0, False, id="zero-limit-existing-count"),
        pytest.param(-1, 0, False, id="negative-limit-existing-count"),
    ],
)
def test_access_enforces_limits_only_for_existing_usage(
    sqlite_session_factory: sessionmaker[Session], trial_limit: int, used_count: int | None, allowed: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        _add_app(session)
        _add_trial(session, trial_limit=trial_limit)
        if used_count is not None:
            session.add(AccountTrialAppRecord(app_id=_APP_ID, account_id=_ACCOUNT_ID, count=used_count))

    service = TrialAppAccessService(apps=TrialAppRepository(sqlite_session_factory))

    if allowed:
        assert service.get_access(app_id=_APP_ID, account_id=_ACCOUNT_ID) == TrialAppRef(
            app_id=_APP_ID, tenant_id=_OWNER_TENANT_ID, app_mode="chat"
        )
    else:
        with pytest.raises(TrialAppUsageLimitExceededError) as error:
            service.get_access(app_id=_APP_ID, account_id=_ACCOUNT_ID)
        assert _APP_ID in str(error.value)
        assert _ACCOUNT_ID in str(error.value)
        assert f"used {used_count}" in str(error.value)
        assert f"limit of {trial_limit}" in str(error.value)


@pytest.mark.parametrize("has_trial", [True, False])
def test_resolve_releases_connection_before_returning(
    sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine, has_trial: bool
) -> None:
    with sqlite_session_factory.begin() as session:
        _add_app(session)
        if has_trial:
            _add_trial(session)

    assert isinstance(sqlite_engine.pool, QueuePool)
    assert sqlite_engine.pool.checkedout() == 0
    result = TrialAppRepository(sqlite_session_factory).resolve(app_id=_APP_ID, account_id=_ACCOUNT_ID)

    assert (result is not None) == has_trial
    assert sqlite_engine.pool.checkedout() == 0


def _record(
    session_factory: sessionmaker[Session],
    *,
    app_id: str,
    account_id: str,
) -> AccountTrialAppRecord | None:
    with session_factory() as session:
        return session.scalar(
            select(AccountTrialAppRecord).where(
                AccountTrialAppRecord.app_id == app_id,
                AccountTrialAppRecord.account_id == account_id,
            )
        )


def test_record_increments_existing_usage(sqlite_session_factory: sessionmaker[Session]) -> None:
    app_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(AccountTrialAppRecord(app_id=app_id, account_id=account_id, count=3))

    TrialAppRepository(sqlite_session_factory).record(app_id=app_id, account_id=account_id)

    record = _record(sqlite_session_factory, app_id=app_id, account_id=account_id)
    assert record is not None
    assert record.count == 4


def test_record_does_not_commit_caller_session(sqlite_session_factory: sessionmaker[Session]) -> None:
    pending_app_id = str(uuid.uuid4())
    usage_app_id = str(uuid.uuid4())
    account_id = str(uuid.uuid4())

    with sqlite_session_factory() as caller_session:
        caller_session.add(AccountTrialAppRecord(app_id=pending_app_id, account_id=account_id, count=1))

        TrialAppRepository(sqlite_session_factory).record(app_id=usage_app_id, account_id=account_id)

        caller_session.rollback()

    assert _record(sqlite_session_factory, app_id=pending_app_id, account_id=account_id) is None
    usage = _record(sqlite_session_factory, app_id=usage_app_id, account_id=account_id)
    assert usage is not None
    assert usage.count == 1

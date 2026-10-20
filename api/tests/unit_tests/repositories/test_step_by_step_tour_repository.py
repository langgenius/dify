from dataclasses import replace
from datetime import datetime
from typing import cast
from unittest.mock import DEFAULT, Mock

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from models.onboarding import AccountStepByStepTourState
from repositories.step_by_step_tour_repository import (
    SQLAlchemyStepByStepTourStateRepository,
    _is_retryable_mysql_lock_error,
)


class _ErrnoOnlyError(Exception):
    def __init__(self, errno: int | str) -> None:
        super().__init__()
        self.errno = errno


def test_mutate_creates_and_updates_state_in_repository_owned_transaction(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory)

    saved = repository.mutate(
        "account-1",
        lambda state: replace(state, completed_task_ids=("home",)),
    )
    reloaded = repository.get("account-1")

    assert saved.first_workspace_id is None
    assert saved.completed_task_ids == ("home",)
    assert saved.updated_at is not None
    assert reloaded == saved


def test_initialize_creates_state_with_first_workspace_atomically(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory)

    result = repository.initialize("account-1", "workspace-1")

    assert result.first_workspace_id == "workspace-1"
    assert repository.get("account-1") == result


def test_initialize_claims_empty_state_once_without_overwriting_winner(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory)
    with sqlite_session_factory() as session:
        session.add(AccountStepByStepTourState(account_id="account-1"))
        session.commit()

    first = repository.initialize("account-1", "workspace-1")
    second = repository.initialize("account-1", "workspace-2")

    assert first.first_workspace_id == "workspace-1"
    assert second.first_workspace_id == "workspace-1"


def test_mutate_cannot_clear_or_overwrite_first_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory)
    repository.initialize("account-1", "workspace-1")

    result = repository.mutate(
        "account-1",
        lambda state: replace(state, first_workspace_id="workspace-2", skipped=True),
    )

    assert result.first_workspace_id == "workspace-1"
    assert result.skipped is True


def test_sequential_mutations_replay_against_latest_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory)

    repository.mutate("account-1", lambda state: replace(state, completed_task_ids=("home",)))
    result = repository.mutate(
        "account-1",
        lambda state: replace(state, completed_task_ids=(*state.completed_task_ids, "studio")),
    )

    assert result.completed_task_ids == ("home", "studio")


def test_mutate_replays_after_concurrent_create_conflict(
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
) -> None:
    concurrent_state = AccountStepByStepTourState(account_id="account-1")
    concurrent_state.completed_task_ids = ["home"]
    concurrent_state.updated_at = datetime(2026, 8, 13)
    with sqlite_session_factory.begin() as seed_session:
        seed_session.add(concurrent_state)
    session = sqlite_session_factory()
    empty_probe = session.execute(
        select(AccountStepByStepTourState).where(AccountStepByStepTourState.account_id == "missing")
    )
    probes = 0

    def simulate_stale_probe(*_args: object, **_kwargs: object) -> object:
        nonlocal probes
        probes += 1
        # Hide the committed winner from the initial probe. The real INSERT then
        # violates the unique key and exercises SQLAlchemy's failed transaction.
        return empty_probe if probes == 1 else DEFAULT

    statements = mocker.patch.object(session, "execute", wraps=session.execute, side_effect=simulate_stale_probe)
    rollback = mocker.spy(session, "rollback")
    factory = cast(sessionmaker[Session], Mock(return_value=session))
    repository = SQLAlchemyStepByStepTourStateRepository(factory)

    result = repository.mutate(
        "account-1",
        lambda state: replace(state, completed_task_ids=(*state.completed_task_ids, "studio")),
    )

    assert result.completed_task_ids == ("home", "studio")
    rollback.assert_called_once_with()
    initial_probe = statements.call_args_list[0].args[0]
    replay_statement = statements.call_args_list[1].args[0]
    assert initial_probe._for_update_arg is None
    assert replay_statement._for_update_arg is not None
    assert repository.get("account-1") == result


def test_mutate_retries_mysql_deadlock_with_fresh_session(
    sqlite_session_factory: sessionmaker[Session],
    mocker: MockerFixture,
) -> None:
    concurrent_state = AccountStepByStepTourState(account_id="account-1")
    concurrent_state.completed_task_ids = ["home"]
    concurrent_state.updated_at = datetime(2026, 8, 13)

    with sqlite_session_factory.begin() as seed_session:
        seed_session.add(concurrent_state)
    deadlocked_session = sqlite_session_factory()
    empty_probe = deadlocked_session.execute(
        select(AccountStepByStepTourState).where(AccountStepByStepTourState.account_id == "missing")
    )
    mocker.patch.object(deadlocked_session, "execute", return_value=empty_probe)
    mocker.patch.object(
        deadlocked_session,
        "flush",
        side_effect=OperationalError(
            "INSERT",
            {},
            Exception(1213, "Deadlock found when trying to get lock"),
        ),
    )
    close = mocker.spy(deadlocked_session, "close")
    retry_session = sqlite_session_factory()
    statements = mocker.spy(retry_session, "execute")
    factory = Mock(side_effect=[deadlocked_session, retry_session])
    repository = SQLAlchemyStepByStepTourStateRepository(cast(sessionmaker[Session], factory))

    result = repository.mutate(
        "account-1",
        lambda state: replace(state, completed_task_ids=(*state.completed_task_ids, "studio")),
    )

    assert result.completed_task_ids == ("home", "studio")
    assert factory.call_count == 2
    close.assert_called_once_with()
    retry_lock_statement = statements.call_args_list[1].args[0]
    assert retry_lock_statement._for_update_arg is not None
    assert SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory).get("account-1") == result


@pytest.mark.parametrize(
    ("orig", "expected"),
    [
        pytest.param(_ErrnoOnlyError(1205), True, id="errno-attribute"),
        pytest.param(Exception(1213, "deadlock"), True, id="integer-args-code"),
        pytest.param(Exception("1213", "deadlock"), True, id="string-args-code"),
        pytest.param(Exception(9999, "other error"), False, id="non-retryable-code"),
        pytest.param(Exception(True), False, id="boolean-is-not-an-error-code"),
        pytest.param(Exception(), False, id="missing-error-code"),
    ],
)
def test_mysql_lock_error_detection_preserves_errno_and_args_coverage(
    orig: BaseException,
    expected: bool,
) -> None:
    exc = OperationalError("statement", {}, orig)

    assert _is_retryable_mysql_lock_error(exc) is expected


def test_get_returns_none_for_unknown_account(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    assert SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory).get("missing") is None

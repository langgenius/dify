from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime
from typing import cast
from unittest.mock import MagicMock, Mock

from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from models.onboarding import AccountStepByStepTourState
from repositories.step_by_step_tour_repository import SQLAlchemyStepByStepTourStateRepository


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


def test_mutate_replays_after_concurrent_create_conflict() -> None:
    concurrent_state = AccountStepByStepTourState(account_id="account-1")
    concurrent_state.completed_task_ids = ["home"]
    concurrent_state.updated_at = datetime(2026, 8, 13)
    session = MagicMock(spec=Session)
    session.execute.return_value.scalar_one_or_none.side_effect = [None, concurrent_state]
    session.flush.side_effect = IntegrityError("insert", {}, Exception("duplicate"))
    factory = cast(sessionmaker[Session], Mock(return_value=nullcontext(session)))
    repository = SQLAlchemyStepByStepTourStateRepository(factory)

    result = repository.mutate(
        "account-1",
        lambda state: replace(state, completed_task_ids=(*state.completed_task_ids, "studio")),
    )

    assert result.completed_task_ids == ("home", "studio")
    session.rollback.assert_called_once_with()
    initial_probe = session.execute.call_args_list[0].args[0]
    replay_statement = session.execute.call_args_list[1].args[0]
    assert initial_probe._for_update_arg is None
    assert replay_statement._for_update_arg is not None


def test_mutate_retries_mysql_deadlock_with_fresh_session() -> None:
    concurrent_state = AccountStepByStepTourState(account_id="account-1")
    concurrent_state.completed_task_ids = ["home"]
    concurrent_state.updated_at = datetime(2026, 8, 13)

    deadlocked_session = MagicMock(spec=Session)
    deadlocked_session.execute.return_value.scalar_one_or_none.return_value = None
    deadlocked_session.flush.side_effect = OperationalError(
        "INSERT",
        {},
        Exception(1213, "Deadlock found when trying to get lock"),
    )

    retry_session = MagicMock(spec=Session)
    retry_session.execute.return_value.scalar_one_or_none.side_effect = [concurrent_state, concurrent_state]
    factory = cast(
        sessionmaker[Session],
        Mock(side_effect=[nullcontext(deadlocked_session), nullcontext(retry_session)]),
    )
    repository = SQLAlchemyStepByStepTourStateRepository(factory)

    result = repository.mutate(
        "account-1",
        lambda state: replace(state, completed_task_ids=(*state.completed_task_ids, "studio")),
    )

    assert result.completed_task_ids == ("home", "studio")
    assert factory.call_count == 2
    retry_lock_statement = retry_session.execute.call_args_list[1].args[0]
    assert retry_lock_statement._for_update_arg is not None


def test_get_returns_none_for_unknown_account(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    assert SQLAlchemyStepByStepTourStateRepository(sqlite_session_factory).get("missing") is None

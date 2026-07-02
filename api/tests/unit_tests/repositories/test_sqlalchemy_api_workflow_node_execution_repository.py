from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


def _make_repo() -> tuple[DifyAPISQLAlchemyWorkflowNodeExecutionRepository, MagicMock]:
    session = MagicMock()
    session_maker = MagicMock()
    session_maker.return_value.__enter__.return_value = session
    return DifyAPISQLAlchemyWorkflowNodeExecutionRepository(session_maker), session


def test_delete_expired_executions_rowcount_none_returns_zero() -> None:
    repo, session = _make_repo()
    # select returns one ID (< default batch_size=1000), loop exits after first batch
    select_result = MagicMock()
    select_result.scalars.return_value.all.return_value = ["exec-1"]
    delete_result = MagicMock()
    delete_result.rowcount = None
    session.execute.side_effect = [select_result, delete_result]

    assert repo.delete_expired_executions("tenant-1", datetime(2024, 1, 1, tzinfo=UTC)) == 0


def test_delete_executions_by_app_rowcount_none_returns_zero() -> None:
    repo, session = _make_repo()
    select_result = MagicMock()
    select_result.scalars.return_value.all.return_value = ["exec-1"]
    delete_result = MagicMock()
    delete_result.rowcount = None
    session.execute.side_effect = [select_result, delete_result]

    assert repo.delete_executions_by_app("tenant-1", "app-1") == 0


def test_delete_executions_by_ids_rowcount_none_returns_zero() -> None:
    repo, session = _make_repo()
    delete_result = MagicMock()
    delete_result.rowcount = None
    session.execute.return_value = delete_result

    assert repo.delete_executions_by_ids(["exec-1", "exec-2"]) == 0

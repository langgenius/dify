from datetime import UTC, datetime
from unittest.mock import Mock

import pytest

from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository


def _session_maker(session: Mock) -> Mock:
    session_maker = Mock()
    session_maker.return_value.__enter__.return_value = session
    session_maker.return_value.__exit__.return_value = None
    return session_maker


def _select_result(ids: list[str]) -> Mock:
    result = Mock()
    result.scalars.return_value.all.return_value = ids
    return result


@pytest.mark.parametrize(
    ("method_name", "arguments"),
    [
        (
            "delete_expired_executions",
            {"tenant_id": "tenant", "before_date": datetime.now(UTC), "batch_size": 2},
        ),
        (
            "delete_executions_by_app",
            {"tenant_id": "tenant", "app_id": "app", "batch_size": 2},
        ),
        ("delete_executions_by_ids", {"execution_ids": ["execution"]}),
    ],
)
def test_node_execution_delete_methods_treat_none_rowcount_as_zero(method_name: str, arguments: dict[str, object]):
    session = Mock()
    delete_result = Mock(rowcount=None)
    if method_name == "delete_executions_by_ids":
        session.execute.return_value = delete_result
    else:
        session.execute.side_effect = [_select_result(["execution"]), delete_result]

    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(_session_maker(session))

    assert getattr(repository, method_name)(**arguments) == 0


@pytest.mark.parametrize(
    ("method_name", "arguments"),
    [
        ("delete_runs_by_ids", {"run_ids": ["run"]}),
        ("delete_runs_by_app", {"tenant_id": "tenant", "app_id": "app", "batch_size": 2}),
    ],
)
def test_workflow_run_delete_methods_treat_none_rowcount_as_zero(method_name: str, arguments: dict[str, object]):
    session = Mock()
    delete_result = Mock(rowcount=None)
    session.execute.return_value = delete_result
    if method_name == "delete_runs_by_app":
        session.scalars.return_value.all.return_value = ["run"]

    repository = DifyAPISQLAlchemyWorkflowRunRepository(_session_maker(session))

    assert getattr(repository, method_name)(**arguments) == 0

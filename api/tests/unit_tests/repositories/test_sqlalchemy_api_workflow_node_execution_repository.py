from __future__ import annotations

from datetime import UTC, datetime

from repositories.sqlalchemy_api_workflow_node_execution_repository import (
    DifyAPISQLAlchemyWorkflowNodeExecutionRepository,
)


class _FakeScalarResult:
    def __init__(self, rows: list[str]) -> None:
        self._rows = rows

    def all(self) -> list[str]:
        return self._rows


class _FakeExecuteResult:
    rowcount: int | None

    def __init__(self, *, rowcount: int | None = None, scalar_rows: list[str] | None = None) -> None:
        self.rowcount = rowcount
        self._scalar_rows = scalar_rows or []

    def scalars(self) -> _FakeScalarResult:
        return _FakeScalarResult(self._scalar_rows)


class _FakeSession:
    def __init__(self, execute_results: list[_FakeExecuteResult]) -> None:
        self._execute_results = execute_results

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    def execute(self, _stmt: object) -> _FakeExecuteResult:
        return self._execute_results.pop(0)

    def commit(self) -> None:
        return None


class _FakeSessionMaker:
    def __init__(self, sessions: list[_FakeSession]) -> None:
        self._sessions = sessions

    def __call__(self) -> _FakeSession:
        return self._sessions.pop(0)


def test_delete_expired_executions_treats_unknown_rowcount_as_zero() -> None:
    session = _FakeSession(
        [
            _FakeExecuteResult(scalar_rows=["execution-1"]),
            _FakeExecuteResult(rowcount=None),
        ]
    )
    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(_FakeSessionMaker([session]))

    assert repository.delete_expired_executions("tenant-1", datetime(2024, 1, 1, tzinfo=UTC)) == 0


def test_delete_executions_by_app_treats_unknown_rowcount_as_zero() -> None:
    session = _FakeSession(
        [
            _FakeExecuteResult(scalar_rows=["execution-1"]),
            _FakeExecuteResult(rowcount=None),
        ]
    )
    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(_FakeSessionMaker([session]))

    assert repository.delete_executions_by_app("tenant-1", "app-1") == 0


def test_delete_executions_by_ids_treats_unknown_rowcount_as_zero() -> None:
    session = _FakeSession([_FakeExecuteResult(rowcount=None)])
    repository = DifyAPISQLAlchemyWorkflowNodeExecutionRepository(_FakeSessionMaker([session]))

    assert repository.delete_executions_by_ids(["execution-1"]) == 0

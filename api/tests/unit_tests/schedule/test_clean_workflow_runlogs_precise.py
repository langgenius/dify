import sys
from collections.abc import Callable, Iterator
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock

import pytest


class _NestedTransaction:
    entered: bool
    exited: bool

    def __init__(self) -> None:
        self.entered = False
        self.exited = False

    def __enter__(self) -> None:
        self.entered = True

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: object | None,
    ) -> bool:
        self.exited = True
        return False


class _ExecuteResult:
    rows: list[object]

    def __init__(self, rows: list[object] | None = None) -> None:
        self.rows = rows or []

    def all(self) -> list[object]:
        return self.rows


class _CeleryStub:
    def task(self, *_args: object, **_kwargs: object) -> Callable[[Callable[..., object]], Callable[..., object]]:
        def decorator(func: Callable[..., object]) -> Callable[..., object]:
            return func

        return decorator


def _load_cleanup_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    app_stub = ModuleType("app")
    app_stub.celery = _CeleryStub()
    monkeypatch.setitem(sys.modules, "app", app_stub)
    sys.modules.pop("schedule.clean_workflow_runlogs_precise", None)

    from schedule import clean_workflow_runlogs_precise as cleanup_module

    return cleanup_module


@pytest.fixture
def cleanup_module(monkeypatch: pytest.MonkeyPatch) -> Iterator[ModuleType]:
    yield _load_cleanup_module(monkeypatch)
    sys.modules.pop("schedule.clean_workflow_runlogs_precise", None)


def test_delete_batch_deletes_workflow_runs_with_the_caller_session(
    cleanup_module: ModuleType, monkeypatch: pytest.MonkeyPatch
) -> None:
    cleanup = cleanup_module
    session = MagicMock()
    nested_transaction = _NestedTransaction()
    session.begin_nested.return_value = nested_transaction
    session.get_bind.return_value = object()
    session.execute.side_effect = [
        _ExecuteResult([SimpleNamespace(id="message-1", conversation_id="conversation-1")]),
        *[_ExecuteResult() for _ in range(11)],
    ]

    node_execution_repo = MagicMock()
    node_execution_repo.delete_by_runs.return_value = (2, 1)
    trigger_log_repo = MagicMock()
    trigger_log_repo.delete_by_run_ids.return_value = 3
    monkeypatch.setattr(
        cleanup.DifyAPIRepositoryFactory,
        "create_api_workflow_node_execution_repository",
        lambda *_args, **_kwargs: node_execution_repo,
    )
    monkeypatch.setattr(cleanup, "SQLAlchemyWorkflowTriggerLogRepository", lambda _active_session: trigger_log_repo)

    workflow_runs = [SimpleNamespace(id="workflow-run-1")]
    workflow_run_repo = MagicMock()
    captured: dict[str, object] = {}

    def delete_runs_with_related_in_session(
        active_session: object,
        runs: list[SimpleNamespace],
        delete_node_executions: Callable[[object, list[SimpleNamespace]], tuple[int, int]],
        delete_trigger_logs: Callable[[object, list[str]], int],
    ) -> dict[str, int]:
        captured["session"] = active_session
        captured["runs"] = runs
        captured["node_execution_counts"] = delete_node_executions(active_session, runs)
        captured["trigger_log_count"] = delete_trigger_logs(active_session, ["workflow-run-1"])
        return {"runs": 1}

    workflow_run_repo.delete_runs_with_related_in_session.side_effect = delete_runs_with_related_in_session

    assert cleanup._delete_batch(session, workflow_run_repo, workflow_runs, attempt_count=0) is True

    assert nested_transaction.entered is True
    assert nested_transaction.exited is True
    assert captured["session"] is session
    assert captured["runs"] == workflow_runs
    assert captured["node_execution_counts"] == (2, 1)
    assert captured["trigger_log_count"] == 3
    workflow_run_repo.delete_runs_with_related_in_session.assert_called_once()
    workflow_run_repo.delete_runs_with_related.assert_not_called()
    node_execution_repo.delete_by_runs.assert_called_once_with(session, ["workflow-run-1"])
    trigger_log_repo.delete_by_run_ids.assert_called_once_with(["workflow-run-1"])

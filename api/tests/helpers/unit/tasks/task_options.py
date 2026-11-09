"""Inspect Celery execution options omitted by the installed Task type stubs."""

from typing import Protocol, runtime_checkable


@runtime_checkable
class TaskWithExecutionOptions(Protocol):
    def _get_exec_options(self) -> dict[str, object]: ...


def task_options(task: object) -> dict[str, object]:
    assert isinstance(task, TaskWithExecutionOptions)
    return task._get_exec_options()

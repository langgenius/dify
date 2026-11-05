"""
Unit tests for summary index task queue isolation.

These tasks must NOT run on the shared 'dataset' queue because they invoke LLMs
for each document segment and can occupy all worker slots for hours, blocking
document indexing tasks.
"""

from typing import Protocol, runtime_checkable

import pytest

from tasks.generate_summary_index_task import generate_summary_index_task
from tasks.regenerate_summary_index_task import regenerate_summary_index_task

SUMMARY_QUEUE = "dataset_summary"
INDEXING_QUEUE = "dataset"


@runtime_checkable
class _Queue(Protocol):
    name: str


class _Router(Protocol):
    def route(
        self,
        options: dict[str, object],
        name: str,
        args: tuple[object, ...],
        kwargs: dict[str, object],
    ) -> dict[str, object]: ...


class _Amqp(Protocol):
    router: _Router


class _CeleryApp(Protocol):
    amqp: _Amqp


@runtime_checkable
class _RoutableTask(Protocol):
    name: str
    app: _CeleryApp

    def _get_exec_options(self) -> dict[str, object]: ...


def _routed_queue(task: object) -> str | None:
    assert isinstance(task, _RoutableTask), "Expected a Celery task with routing metadata"
    options = task._get_exec_options()
    routed = task.app.amqp.router.route(options, task.name, args=(), kwargs={})
    queue = routed.get("queue")
    if queue is None:
        return None
    assert isinstance(queue, _Queue), "Expected a routed queue with a name"
    return queue.name


@pytest.mark.parametrize(
    ("task", "task_name"),
    [
        (generate_summary_index_task, "generate_summary_index_task"),
        (regenerate_summary_index_task, "regenerate_summary_index_task"),
    ],
)
def test_summary_task_routes_to_dedicated_queue(task: object, task_name: str) -> None:
    """Summary tasks must route to the dataset_summary queue, not the shared dataset queue.

    Summary generation is LLM-heavy and will block document indexing if placed
    on the shared queue.
    """
    assert _routed_queue(task) == SUMMARY_QUEUE, (
        f"{task_name} must route to '{SUMMARY_QUEUE}' queue (not '{INDEXING_QUEUE}'). "
        "Summary generation is LLM-heavy and will block document indexing if placed on the shared queue."
    )

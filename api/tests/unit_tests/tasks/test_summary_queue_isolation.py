"""
Unit tests for summary index task queue isolation.

These tasks must NOT run on the shared 'dataset' queue because they invoke LLMs
for each document segment and can occupy all worker slots for hours, blocking
document indexing tasks.
"""

import pytest

from tasks.generate_summary_index_task import generate_summary_index_task
from tasks.regenerate_summary_index_task import regenerate_summary_index_task

SUMMARY_QUEUE = "dataset_summary"
INDEXING_QUEUE = "dataset"


def _task_queue(task) -> str | None:
    # Celery's @shared_task(queue=...) stores the routing key on the task instance
    # at runtime, but type stubs don't declare it; use getattr to stay type-clean.
    return getattr(task, "queue", None)


@pytest.mark.parametrize(
    ("task", "task_name"),
    [
        (generate_summary_index_task, "generate_summary_index_task"),
        (regenerate_summary_index_task, "regenerate_summary_index_task"),
    ],
)
def test_summary_task_uses_dedicated_queue(task, task_name):
    """Summary tasks must use the dataset_summary queue, not the shared dataset queue.

    Summary generation is LLM-heavy and will block document indexing if placed
    on the shared queue.
    """
    assert _task_queue(task) == SUMMARY_QUEUE, (
        f"{task_name} must run on '{SUMMARY_QUEUE}' queue (not '{INDEXING_QUEUE}'). "
        "Summary generation is LLM-heavy and will block document indexing if placed on the shared queue."
    )

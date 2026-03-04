"""
Unit tests for summary index task queue isolation.

These tasks must NOT run on the shared 'dataset' queue because they invoke LLMs
for each document segment and can occupy all worker slots for hours, blocking
document indexing tasks.
"""

from tasks.generate_summary_index_task import generate_summary_index_task
from tasks.regenerate_summary_index_task import regenerate_summary_index_task

SUMMARY_QUEUE = "dataset_summary"
INDEXING_QUEUE = "dataset"


def test_generate_summary_task_uses_dedicated_queue():
    """generate_summary_index_task must use the dataset_summary queue, not dataset."""
    assert generate_summary_index_task.queue == SUMMARY_QUEUE, (
        f"generate_summary_index_task must run on '{SUMMARY_QUEUE}' queue (not '{INDEXING_QUEUE}'). "
        "Summary generation is LLM-heavy and will block document indexing if placed on the shared queue."
    )


def test_regenerate_summary_task_uses_dedicated_queue():
    """regenerate_summary_index_task must use the dataset_summary queue, not dataset."""
    assert regenerate_summary_index_task.queue == SUMMARY_QUEUE, (
        f"regenerate_summary_index_task must run on '{SUMMARY_QUEUE}' queue (not '{INDEXING_QUEUE}'). "
        "Summary regeneration is LLM-heavy and will block document indexing if placed on the shared queue."
    )


def test_summary_tasks_not_on_dataset_queue():
    """Regression guard: summary tasks must never be placed on the shared dataset queue."""
    assert generate_summary_index_task.queue != INDEXING_QUEUE
    assert regenerate_summary_index_task.queue != INDEXING_QUEUE

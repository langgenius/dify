from __future__ import annotations

from contextlib import ExitStack, nullcontext
from types import ModuleType
from unittest.mock import patch

import pytest
from celery import Task

import tasks.batch_clean_document_task as batch_clean_module
import tasks.clean_document_task as clean_document_module
import tasks.clean_notion_document_task as clean_notion_module
from services.knowledge.indexing.locks import KnowledgeIndexingLease, KnowledgeIndexingLockBusyError
from tasks.indexing_task_retry import TaskRetriesExhaustedError


@pytest.mark.parametrize(
    ("name", "module", "task", "task_args"),
    [
        (
            "clean_document_task",
            clean_document_module,
            clean_document_module.clean_document_task,
            ("document-1", "dataset-1", "text_model", None),
        ),
        (
            "batch_clean_document_task",
            batch_clean_module,
            batch_clean_module.batch_clean_document_task,
            (["document-1"], "dataset-1", "text_model", []),
        ),
        (
            "clean_notion_document_task",
            clean_notion_module,
            clean_notion_module.clean_notion_document_task,
            (["document-1"], "dataset-1"),
        ),
    ],
)
@pytest.mark.parametrize("invalid", [False, True])
def test_cleanup_retry_budget_survives_lock_waits_but_rejects_invalid_input(
    name: str,
    module: ModuleType,
    task: Task[..., None],
    task_args: tuple[object, ...],
    invalid: bool,
) -> None:
    with ExitStack() as stack:
        cleanup = stack.enter_context(patch.object(module, "_clean_documents"))
        if name == "clean_notion_document_task":
            leases: dict[str, KnowledgeIndexingLease] = {}
            stack.enter_context(patch.object(module, "_resolve_tenant_id", return_value="tenant-1"))
            stack.enter_context(patch.object(module, "_prepare_legacy_notion_cleanup", return_value="text_model"))
            stack.enter_context(patch.object(module, "hold_document_cleanup_locks", return_value=nullcontext(leases)))
        cleanup.side_effect = ValueError("invalid ownership") if invalid else [RuntimeError("temporary failure"), None]

        # Native Celery retries already include the previous lock waits. They
        # must not consume the opportunity to recover a real cleanup failure.
        result = task.apply(args=task_args, retries=6, throw=False)

    assert result.state == ("FAILURE" if invalid else "SUCCESS")
    assert cleanup.call_count == (1 if invalid else 2)


@pytest.mark.parametrize(
    ("module", "task", "task_args"),
    [
        (
            clean_document_module,
            clean_document_module.clean_document_task,
            ("document-1", "dataset-1", "text_model", None),
        ),
        (
            batch_clean_module,
            batch_clean_module.batch_clean_document_task,
            (["document-1"], "dataset-1", "text_model", []),
        ),
        (
            clean_notion_module,
            clean_notion_module.clean_notion_document_task,
            (["document-1"], "dataset-1"),
        ),
    ],
)
def test_cleanup_waits_for_a_busy_index_lock_beyond_the_bounded_retry_budget(
    module: ModuleType,
    task: Task[..., None],
    task_args: tuple[object, ...],
) -> None:
    with ExitStack() as stack:
        cleanup = stack.enter_context(patch.object(module, "_clean_documents"))
        if module is clean_notion_module:
            leases: dict[str, KnowledgeIndexingLease] = {}
            stack.enter_context(patch.object(module, "_resolve_tenant_id", return_value="tenant-1"))
            stack.enter_context(patch.object(module, "_prepare_legacy_notion_cleanup", return_value="text_model"))
            stack.enter_context(patch.object(module, "hold_document_cleanup_locks", return_value=nullcontext(leases)))
        cleanup.side_effect = [KnowledgeIndexingLockBusyError("busy"), None]

        # Far past max_retries: the indexing-vs-cleanup race must still be waited out.
        result = task.apply(args=task_args, retries=500, throw=False)

    assert result.state == "SUCCESS"
    assert cleanup.call_count == 2


@pytest.mark.parametrize(
    ("module", "task", "task_args"),
    [
        (
            clean_document_module,
            clean_document_module.clean_document_task,
            ("document-1", "dataset-1", "text_model", None),
        ),
        (
            batch_clean_module,
            batch_clean_module.batch_clean_document_task,
            (["document-1"], "dataset-1", "text_model", []),
        ),
        (
            clean_notion_module,
            clean_notion_module.clean_notion_document_task,
            (["document-1"], "dataset-1"),
        ),
    ],
)
def test_cleanup_stops_retrying_a_persistent_failure_and_marks_its_last_attempt_final(
    module: ModuleType,
    task: Task[..., None],
    task_args: tuple[object, ...],
) -> None:
    with ExitStack() as stack:
        cleanup = stack.enter_context(patch.object(module, "_clean_documents"))
        if module is clean_notion_module:
            leases: dict[str, KnowledgeIndexingLease] = {}
            stack.enter_context(patch.object(module, "_resolve_tenant_id", return_value="tenant-1"))
            stack.enter_context(patch.object(module, "_prepare_legacy_notion_cleanup", return_value="text_model"))
            stack.enter_context(patch.object(module, "hold_document_cleanup_locks", return_value=nullcontext(leases)))
        cleanup.side_effect = RuntimeError("database unavailable")
        max_retries = clean_document_module.DOCUMENT_CLEANUP_MAX_RETRIES

        result = task.apply(args=task_args, retries=max_retries - 1, throw=False)

    # One retryable attempt, then the final one: a persistent error no longer retries forever.
    assert result.state == "FAILURE"
    assert isinstance(result.result, TaskRetriesExhaustedError)
    assert isinstance(result.result.__cause__, RuntimeError)
    assert [call.kwargs["final_attempt"] for call in cleanup.call_args_list] == [False, True]

from contextlib import ExitStack, nullcontext
from importlib import import_module
from unittest.mock import patch

import pytest

from services.knowledge.indexing.locks import KnowledgeIndexingLease


@pytest.mark.parametrize("name", ["clean_document_task", "batch_clean_document_task", "clean_notion_document_task"])
@pytest.mark.parametrize("invalid", [False, True])
def test_cleanup_retry_budget_survives_lock_waits_but_rejects_invalid_input(name: str, invalid: bool) -> None:
    module = import_module(f"tasks.{name}")
    task = getattr(module, name)
    task_args: tuple[object, ...]
    if name == "clean_document_task":
        task_args = ("document-1", "dataset-1", "text_model", None)
    elif name == "batch_clean_document_task":
        file_ids: list[str] = []
        task_args = (["document-1"], "dataset-1", "text_model", file_ids)
    else:
        task_args = (["document-1"], "dataset-1")
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

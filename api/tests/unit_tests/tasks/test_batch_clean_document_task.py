import pytest

import tasks.batch_clean_document_task as task_module
from tasks.batch_clean_document_task import batch_clean_document_task


def test_batch_cleanup_delegates_once_with_original_task_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(task_module, "_clean_documents", lambda **kwargs: calls.append(kwargs))

    batch_clean_document_task.run(
        ["document-1", "document-2"],
        "dataset-1",
        "text_model",
        ["file-1", "file-2"],
    )

    assert calls == [
        {
            "document_ids": ["document-1", "document-2"],
            "dataset_id": "dataset-1",
            "doc_form": "text_model",
            "file_ids": ["file-1", "file-2"],
        }
    ]
    assert batch_clean_document_task.acks_late is True
    assert batch_clean_document_task.reject_on_worker_lost is True


def test_batch_cleanup_requires_doc_form(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(task_module, "_clean_documents", lambda **_kwargs: pytest.fail("must not dispatch"))

    with pytest.raises(ValueError, match="doc_form is required"):
        batch_clean_document_task.run(["document-1"], "dataset-1", None, [])

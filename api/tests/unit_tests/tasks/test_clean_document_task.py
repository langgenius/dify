from collections.abc import Sequence

import pytest

import tasks.clean_document_task as task_module
from tasks.clean_document_task import clean_document_task


def test_clean_documents_deduplicates_ids_and_refreshes_billing_after_index_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    index_calls: list[dict[str, object]] = []
    relational_calls: list[dict[str, object]] = []
    refreshed: list[str] = []

    monkeypatch.setattr(task_module, "_resolve_tenant_id", lambda **_kwargs: "tenant-1")
    monkeypatch.setattr(
        task_module,
        "clean_document_indexes",
        lambda **kwargs: index_calls.append(kwargs) or "tenant-1",
    )
    monkeypatch.setattr(
        task_module,
        "_delete_document_rows_and_unreferenced_files",
        lambda **kwargs: relational_calls.append(kwargs),
    )
    monkeypatch.setattr(task_module, "schedule_billing_vector_space_refresh", refreshed.append)

    task_module._clean_documents(
        document_ids=("document-2", "document-1", "document-2"),
        dataset_id="dataset-1",
        doc_form="text_model",
        file_ids=("file-1",),
    )

    assert index_calls[0]["document_ids"] == ("document-1", "document-2")
    assert relational_calls == [
        {
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "document_ids": ("document-1", "document-2"),
            "file_ids": ("file-1",),
        }
    ]
    assert refreshed == ["tenant-1"]


def test_clean_documents_retries_before_relational_cleanup_when_index_cleanup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    relational_calls: list[tuple[str, ...]] = []
    refreshed: list[str] = []

    monkeypatch.setattr(task_module, "_resolve_tenant_id", lambda **_kwargs: "tenant-1")

    def fail_index_cleanup(**_kwargs: object) -> None:
        raise RuntimeError("vector store unavailable")

    monkeypatch.setattr(task_module, "clean_document_indexes", fail_index_cleanup)

    def delete_rows(*, document_ids: Sequence[str], **_kwargs: object) -> None:
        relational_calls.append(tuple(document_ids))

    monkeypatch.setattr(task_module, "_delete_document_rows_and_unreferenced_files", delete_rows)
    monkeypatch.setattr(task_module, "schedule_billing_vector_space_refresh", refreshed.append)

    with pytest.raises(RuntimeError, match="vector store unavailable"):
        task_module._clean_documents(
            document_ids=("document-1",),
            dataset_id="dataset-1",
            doc_form="text_model",
            file_ids=(),
        )

    assert relational_calls == []
    assert refreshed == []


def test_clean_document_task_preserves_original_celery_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(task_module, "_clean_documents", lambda **kwargs: calls.append(kwargs))

    clean_document_task.run("document-1", "dataset-1", "text_model", "file-1")

    assert calls == [
        {
            "document_ids": ("document-1",),
            "dataset_id": "dataset-1",
            "doc_form": "text_model",
            "file_ids": ("file-1",),
        }
    ]
    assert clean_document_task.acks_late is True
    assert clean_document_task.reject_on_worker_lost is True


def test_clean_documents_requires_doc_form() -> None:
    with pytest.raises(ValueError, match="doc_form is required"):
        task_module._clean_documents(
            document_ids=("document-1",),
            dataset_id="dataset-1",
            doc_form="",
            file_ids=(),
        )

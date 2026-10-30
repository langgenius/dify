from contextlib import contextmanager
from typing import cast

import pytest
from sqlalchemy.orm import Session, sessionmaker

import tasks.clean_dataset_task as task_module
from core.workflow.file_reference import build_file_reference
from models.dataset import Document, DocumentSegment
from models.model import UploadFile
from tasks.clean_dataset_task import clean_dataset_task
from tasks.clean_document_task import _delete_document_rows_and_unreferenced_files
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document, _upload_file


def _record_relational_steps(monkeypatch: pytest.MonkeyPatch, steps: list[str]) -> None:
    monkeypatch.setattr(task_module, "_delete_child_chunks", lambda **_kwargs: steps.append("children"))
    monkeypatch.setattr(
        task_module,
        "_delete_segments",
        lambda **_kwargs: steps.append("segments"),
    )
    monkeypatch.setattr(
        task_module,
        "_delete_documents",
        lambda **_kwargs: steps.append("documents"),
    )
    monkeypatch.setattr(
        task_module,
        "_delete_remaining_attachments",
        lambda **_kwargs: steps.append("attachments"),
    )
    monkeypatch.setattr(
        task_module,
        "_delete_dataset_scoped_rows",
        lambda **_kwargs: steps.append("metadata"),
    )


def test_dataset_cleanup_skips_external_index_without_index_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steps: list[str] = []
    monkeypatch.setattr(
        task_module,
        "cleanup_dataset_crawl_cache",
        lambda tenant_id, dataset_id: steps.append(f"crawl:{tenant_id}:{dataset_id}"),
    )
    monkeypatch.setattr(task_module, "_clean_index", lambda *_args: pytest.fail("index cleanup must be skipped"))
    _record_relational_steps(monkeypatch, steps)

    clean_dataset_task.run(
        dataset_id="dataset-1",
        tenant_id="tenant-1",
        indexing_technique=None,
        index_struct=None,
        collection_binding_id=None,
        doc_form=None,
        pipeline_id="pipeline-1",
    )

    assert steps == [
        "crawl:tenant-1:dataset-1",
        "children",
        "segments",
        "documents",
        "attachments",
        "metadata",
    ]


class _RetryScheduledError(Exception):
    pass


def test_dataset_cleanup_retry_remembers_completed_index_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cleaned_indexes: list[str] = []
    refreshed: list[str] = []
    retry_kwargs: list[dict[str, object]] = []

    @contextmanager
    def create_session():
        yield object()

    monkeypatch.setattr(task_module.session_factory, "create_session", create_session)
    monkeypatch.setattr(task_module, "cleanup_dataset_crawl_cache", lambda *_args: None)
    monkeypatch.setattr(
        task_module,
        "_clean_index",
        lambda _session, dataset, _doc_form: cleaned_indexes.append(dataset.id),
    )
    monkeypatch.setattr(task_module, "schedule_billing_vector_space_refresh", refreshed.append)
    monkeypatch.setattr(task_module, "_delete_child_chunks", lambda **_kwargs: None)
    monkeypatch.setattr(
        task_module,
        "_delete_segments",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("database unavailable")),
    )

    def retry(**kwargs: object) -> None:
        retry_kwargs.append(kwargs)
        raise _RetryScheduledError

    monkeypatch.setattr(clean_dataset_task, "retry", retry)

    with pytest.raises(_RetryScheduledError):
        clean_dataset_task.run(
            dataset_id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique="high_quality",
            index_struct='{"type":"paragraph"}',
            collection_binding_id="binding-1",
            doc_form="text_model",
        )

    assert cleaned_indexes == ["dataset-1"]
    assert refreshed == ["tenant-1"]
    retry_task_kwargs = cast(dict[str, object], retry_kwargs[0]["kwargs"])
    assert retry_task_kwargs["index_cleanup_done"] is True
    assert retry_task_kwargs["dataset_id"] == "dataset-1"


def test_dataset_cleanup_task_has_bounded_retry_policy() -> None:
    assert clean_dataset_task.max_retries == 3
    assert clean_dataset_task.default_retry_delay == 30
    assert clean_dataset_task.acks_late is True
    assert clean_dataset_task.reject_on_worker_lost is True


def test_dataset_cleanup_can_be_replayed_after_late_ack_redelivery(monkeypatch: pytest.MonkeyPatch) -> None:
    steps: list[str] = []
    monkeypatch.setattr(task_module, "cleanup_dataset_crawl_cache", lambda *_args: steps.append("crawl"))
    _record_relational_steps(monkeypatch, steps)

    for _ in range(2):
        clean_dataset_task.run(
            dataset_id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique=None,
            index_struct=None,
            collection_binding_id=None,
            doc_form="text_model",
        )

    assert steps == [
        "crawl",
        "children",
        "segments",
        "documents",
        "attachments",
        "metadata",
        "crawl",
        "children",
        "segments",
        "documents",
        "attachments",
        "metadata",
    ]


def test_document_cleanup_storage_failure_keeps_an_unowned_blob_after_committing_metadata(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    old_image = _upload_file(key="old-indexing-image")
    document = _document("document-1", pending_file_ids=(old_image.id,))
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), document, old_image])

    def fail_delete(_key: str) -> None:
        raise RuntimeError("storage unavailable")

    monkeypatch.setattr(task_module.storage, "delete", fail_delete)
    task_module._delete_documents(tenant_id="workspace-1", dataset_id="dataset-1")

    with sqlite_session_factory() as session:
        assert session.get(Document, document.id) is None
        assert session.get(UploadFile, old_image.id) is None
    assert old_image.key in caplog.text


@pytest.mark.parametrize("kind", ["single", "batch", "dataset"])
@pytest.mark.parametrize("shared", [False, True])
@pytest.mark.parametrize("reference_kind", ["markdown", "canonical"])
def test_cleanup_reclaims_answer_only_files_unless_another_dataset_references_them(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    shared: bool,
    reference_kind: str,
) -> None:
    upload = _upload_file(key="uploads/qa-answer-only")
    image = (
        f"![answer](/files/{upload.id}/image-preview)"
        if reference_kind == "markdown"
        else build_file_reference(record_id=upload.id)
    )
    document_ids = ["qa-one", "qa-two"] if kind == "batch" else ["qa-one"]
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset("dataset-1", "workspace-1"), upload])
        for document_id in document_ids:
            document = _document(document_id)
            document.doc_form = "qa_model"
            session.add(document)
            session.add(
                DocumentSegment(
                    tenant_id="workspace-1",
                    dataset_id="dataset-1",
                    document_id=document_id,
                    position=1,
                    content="Question",
                    answer=image,
                    word_count=1,
                    tokens=1,
                    created_by="account-1",
                )
            )
        if shared:
            session.add_all(
                [
                    _dataset("dataset-2", "workspace-1"),
                    _document("shared", dataset_id="dataset-2"),
                    DocumentSegment(
                        tenant_id="workspace-1",
                        dataset_id="dataset-2",
                        document_id="shared",
                        position=1,
                        content=image,
                        word_count=1,
                        tokens=1,
                        created_by="account-1",
                    ),
                ]
            )
    deleted: list[str] = []
    monkeypatch.setattr(task_module.storage, "delete", deleted.append)

    if kind == "dataset":
        task_module._delete_segments(tenant_id="workspace-1", dataset_id="dataset-1")
        task_module._delete_documents(tenant_id="workspace-1", dataset_id="dataset-1")
    else:
        _delete_document_rows_and_unreferenced_files(
            tenant_id="workspace-1",
            dataset_id="dataset-1",
            document_ids=document_ids,
            file_ids=(),
        )

    with sqlite_session_factory() as session:
        for document_id in document_ids:
            assert session.get(Document, document_id) is None
        assert (session.get(UploadFile, upload.id) is not None) is shared
    assert deleted == ([] if shared else [upload.key])

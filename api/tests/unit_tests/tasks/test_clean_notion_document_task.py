import json
from datetime import datetime
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

import tasks.clean_notion_document_task as task_module
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import UploadFile
from tests.helpers.unit.model_factories import make_upload_file


def _dataset() -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="",
        provider="vendor",
        created_by="account-1",
        maintainer="account-1",
        data_source_type=DataSourceType.NOTION_IMPORT,
        indexing_technique="economy",
        chunk_structure="text_model",
    )


def _document(
    *,
    document_id: str = "document-1",
    tenant_id: str = "tenant-1",
    pending_file_id: str = "pending-image",
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info=json.dumps(
            {
                "notion_page_id": "page-1",
                "_pending_upload_cleanup_ids": [pending_file_id],
            }
        ),
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        indexing_status=IndexingStatus.COMPLETED,
        doc_form="text_model",
        enabled=True,
        archived=False,
        is_paused=False,
    )


def test_legacy_task_preserves_two_field_message_and_runs_shared_cleanup(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset(), _document()])

    with (
        patch.object(task_module.session_factory, "create_session", side_effect=sqlite_session_factory),
        patch.object(task_module.session_factory, "get_session_maker", return_value=sqlite_session_factory),
    ):
        task_module.clean_notion_document_task.run(["document-1", "document-1"], "dataset-1")
        task_module.clean_notion_document_task.run(["document-1"], "dataset-1")

    with sqlite_session_factory() as session:
        assert session.get(Document, "document-1") is None
    assert task_module.clean_notion_document_task.acks_late is True
    assert task_module.clean_notion_document_task.reject_on_worker_lost is True


def test_legacy_task_retains_hidden_document_evidence_when_cleanup_fails(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset(), _document()])

    with (
        patch.object(task_module.session_factory, "create_session", side_effect=sqlite_session_factory),
        patch.object(task_module.session_factory, "get_session_maker", return_value=sqlite_session_factory),
        patch.object(task_module, "_clean_documents", side_effect=RuntimeError("vector unavailable")),
    ):
        with pytest.raises(RuntimeError, match="vector unavailable"):
            task_module.clean_notion_document_task.run(["document-1"], "dataset-1")

    with sqlite_session_factory() as session:
        document = session.get_one(Document, "document-1")
        assert document.enabled is False
        assert document.archived is True
        assert document.data_source_info_dict["_pending_upload_cleanup_ids"] == ["pending-image"]


def test_legacy_task_rejects_conflicting_owner_evidence_before_writing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first_upload = make_upload_file(tenant_id="tenant-1", key="notion/first")
    second_upload = make_upload_file(tenant_id="tenant-2", key="notion/second")
    first = _document(pending_file_id=first_upload.id)
    second = _document(
        document_id="document-2",
        tenant_id="tenant-2",
        pending_file_id=second_upload.id,
    )
    document_ids = (first.id, second.id)
    upload_ids = (first_upload.id, second_upload.id)
    with sqlite_session_factory.begin() as session:
        session.add_all([first_upload, second_upload, first, second])

    with patch.object(task_module.session_factory, "create_session", side_effect=sqlite_session_factory):
        with pytest.raises(ValueError, match="ownership is ambiguous"):
            task_module.clean_notion_document_task.run(list(document_ids), "dataset-1")

    with sqlite_session_factory() as session:
        persisted_first = session.get_one(Document, document_ids[0])
        persisted_second = session.get_one(Document, document_ids[1])
        assert persisted_first.enabled is True
        assert persisted_first.archived is False
        assert persisted_second.enabled is True
        assert persisted_second.archived is False
        assert persisted_first.data_source_info_dict["_pending_upload_cleanup_ids"] == [upload_ids[0]]
        assert persisted_second.data_source_info_dict["_pending_upload_cleanup_ids"] == [upload_ids[1]]
        assert session.get(UploadFile, upload_ids[0]) is not None
        assert session.get(UploadFile, upload_ids[1]) is not None

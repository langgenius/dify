"""Testcontainers integration tests for SQL-backed DocumentService paths."""

import datetime
import json
from unittest.mock import create_autospec, patch
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models import Account
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import UploadFile
from services.dataset_service import DocumentService
from services.errors.account import NoPermissionError

FIXED_UPLOAD_CREATED_AT = datetime.datetime(2024, 1, 1, 0, 0, 0)


class DocumentServiceIntegrationFactory:
    @staticmethod
    def create_dataset(
        db_session_with_containers,
        *,
        tenant_id: str | None = None,
        created_by: str | None = None,
        name: str | None = None,
    ) -> Dataset:
        dataset = Dataset(
            tenant_id=tenant_id or str(uuid4()),
            name=name or f"dataset-{uuid4()}",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by or str(uuid4()),
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_document(
        db_session_with_containers,
        *,
        dataset: Dataset,
        name: str = "doc.txt",
        position: int = 1,
        tenant_id: str | None = None,
        indexing_status: str = IndexingStatus.COMPLETED,
        enabled: bool = True,
        archived: bool = False,
        is_paused: bool = False,
        need_summary: bool = False,
        doc_form: str = IndexStructureType.PARAGRAPH_INDEX,
        batch: str | None = None,
        data_source_type: str = DataSourceType.UPLOAD_FILE,
        data_source_info: dict | None = None,
        created_by: str | None = None,
    ) -> Document:
        document = Document(
            tenant_id=tenant_id or dataset.tenant_id,
            dataset_id=dataset.id,
            position=position,
            data_source_type=data_source_type,
            data_source_info=json.dumps(data_source_info or {}),
            batch=batch or f"batch-{uuid4()}",
            name=name,
            created_from=DocumentCreatedFrom.WEB,
            created_by=created_by or dataset.created_by,
            doc_form=doc_form,
        )
        document.indexing_status = indexing_status
        document.enabled = enabled
        document.archived = archived
        document.is_paused = is_paused
        document.need_summary = need_summary
        if indexing_status == IndexingStatus.COMPLETED:
            document.completed_at = FIXED_UPLOAD_CREATED_AT
        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document

    @staticmethod
    def create_upload_file(
        db_session_with_containers,
        *,
        tenant_id: str,
        created_by: str,
        file_id: str | None = None,
        name: str = "source.txt",
    ) -> UploadFile:
        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
            key=f"uploads/{uuid4()}",
            name=name,
            size=128,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=created_by,
            created_at=FIXED_UPLOAD_CREATED_AT,
            used=False,
        )
        if file_id:
            upload_file.id = file_id
        db_session_with_containers.add(upload_file)
        db_session_with_containers.commit()
        return upload_file


@pytest.fixture
def current_user_mock():
    with patch("services.dataset_service.current_user", create_autospec(Account, instance=True)) as current_user:
        current_user.id = str(uuid4())
        current_user.current_tenant_id = str(uuid4())
        current_user.current_role = None
        yield current_user


def test_get_document_returns_none_when_document_id_is_missing(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)

    assert DocumentService.get_document(dataset.id, None) is None


def test_get_document_queries_by_dataset_and_document_id(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    document = DocumentServiceIntegrationFactory.create_document(db_session_with_containers, dataset=dataset)

    result = DocumentService.get_document(dataset.id, document.id)

    assert result is not None
    assert result.id == document.id


def test_get_documents_by_ids_returns_empty_for_empty_input(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)

    result = DocumentService.get_documents_by_ids(dataset.id, [])

    assert result == []


def test_get_documents_by_ids_uses_single_batch_query(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    doc_a = DocumentServiceIntegrationFactory.create_document(db_session_with_containers, dataset=dataset, name="a.txt")
    doc_b = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        name="b.txt",
        position=2,
    )

    result = DocumentService.get_documents_by_ids(dataset.id, [doc_a.id, doc_b.id])

    assert {document.id for document in result} == {doc_a.id, doc_b.id}


def test_update_documents_need_summary_returns_zero_for_empty_input(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)

    assert DocumentService.update_documents_need_summary(dataset.id, []) == 0


def test_update_documents_need_summary_updates_matching_non_qa_documents(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    paragraph_doc = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        need_summary=True,
    )
    qa_doc = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        need_summary=True,
        doc_form=IndexStructureType.QA_INDEX,
    )

    updated_count = DocumentService.update_documents_need_summary(
        dataset.id,
        [paragraph_doc.id, qa_doc.id],
        need_summary=False,
    )

    db_session_with_containers.expire_all()
    refreshed_paragraph = db_session_with_containers.get(Document, paragraph_doc.id)
    refreshed_qa = db_session_with_containers.get(Document, qa_doc.id)
    assert updated_count == 1
    assert refreshed_paragraph is not None
    assert refreshed_qa is not None
    assert refreshed_paragraph.need_summary is False
    assert refreshed_qa.need_summary is True


def test_get_document_download_url_uses_signed_url_helper(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    upload_file = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
    )
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": upload_file.id},
    )

    with patch("services.dataset_service.file_helpers.get_signed_file_url", return_value="signed-url") as get_url:
        result = DocumentService.get_document_download_url(document)

    assert result == "signed-url"
    get_url.assert_called_once_with(upload_file_id=upload_file.id, as_attachment=True)


def test_get_upload_file_id_for_upload_file_document_rejects_invalid_source_type(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_type=DataSourceType.WEBSITE_CRAWL,
        data_source_info={"url": "https://example.com"},
    )

    with pytest.raises(NotFound, match="invalid source"):
        DocumentService._get_upload_file_id_for_upload_file_document(
            document,
            invalid_source_message="invalid source",
            missing_file_message="missing file",
        )


def test_get_upload_file_id_for_upload_file_document_rejects_missing_upload_file_id(
    db_session_with_containers: Session,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={},
    )

    with pytest.raises(NotFound, match="missing file"):
        DocumentService._get_upload_file_id_for_upload_file_document(
            document,
            invalid_source_message="invalid source",
            missing_file_message="missing file",
        )


def test_get_upload_file_id_for_upload_file_document_returns_string_id(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": 99},
    )

    result = DocumentService._get_upload_file_id_for_upload_file_document(
        document,
        invalid_source_message="invalid source",
        missing_file_message="missing file",
    )

    assert result == "99"


def test_get_upload_file_for_upload_file_document_raises_when_file_service_returns_nothing(
    db_session_with_containers: Session,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": "missing-file"},
    )

    with patch("services.dataset_service.FileService.get_upload_files_by_ids", return_value={}):
        with pytest.raises(NotFound, match="Uploaded file not found"):
            DocumentService._get_upload_file_for_upload_file_document(document)


def test_get_upload_file_for_upload_file_document_returns_upload_file(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    upload_file = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
    )
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": upload_file.id},
    )

    result = DocumentService._get_upload_file_for_upload_file_document(document)

    assert result.id == upload_file.id


def test_get_upload_files_by_document_id_for_zip_download_raises_for_missing_documents(
    db_session_with_containers: Session,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)

    with pytest.raises(NotFound, match="Document not found"):
        DocumentService._get_upload_files_by_document_id_for_zip_download(
            dataset_id=dataset.id,
            document_ids=[str(uuid4())],
            tenant_id=dataset.tenant_id,
        )


def test_get_upload_files_by_document_id_for_zip_download_rejects_cross_tenant_access(
    db_session_with_containers: Session,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    upload_file = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
    )
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        tenant_id=str(uuid4()),
        data_source_info={"upload_file_id": upload_file.id},
    )

    with pytest.raises(Forbidden, match="No permission"):
        DocumentService._get_upload_files_by_document_id_for_zip_download(
            dataset_id=dataset.id,
            document_ids=[document.id],
            tenant_id=dataset.tenant_id,
        )


def test_get_upload_files_by_document_id_for_zip_download_rejects_missing_upload_files(
    db_session_with_containers: Session,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": str(uuid4())},
    )

    with pytest.raises(NotFound, match="Only uploaded-file documents can be downloaded as ZIP"):
        DocumentService._get_upload_files_by_document_id_for_zip_download(
            dataset_id=dataset.id,
            document_ids=[document.id],
            tenant_id=dataset.tenant_id,
        )


def test_get_upload_files_by_document_id_for_zip_download_returns_document_keyed_mapping(
    db_session_with_containers: Session,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    upload_file_a = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
        name="a.txt",
    )
    upload_file_b = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
        name="b.txt",
    )
    document_a = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": upload_file_a.id},
    )
    document_b = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        data_source_info={"upload_file_id": upload_file_b.id},
    )

    mapping = DocumentService._get_upload_files_by_document_id_for_zip_download(
        dataset_id=dataset.id,
        document_ids=[document_a.id, document_b.id],
        tenant_id=dataset.tenant_id,
    )

    assert mapping[document_a.id].id == upload_file_a.id
    assert mapping[document_b.id].id == upload_file_b.id


def test_prepare_document_batch_download_zip_raises_not_found_for_missing_dataset(
    current_user_mock, flask_app_with_containers
):
    with flask_app_with_containers.app_context():
        with pytest.raises(NotFound, match="Dataset not found"):
            DocumentService.prepare_document_batch_download_zip(
                dataset_id=str(uuid4()),
                document_ids=[str(uuid4())],
                tenant_id=current_user_mock.current_tenant_id,
                current_user=current_user_mock,
            )


def test_prepare_document_batch_download_zip_translates_permission_error_to_forbidden(
    db_session_with_containers: Session,
    current_user_mock,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(
        db_session_with_containers,
        tenant_id=current_user_mock.current_tenant_id,
        created_by=current_user_mock.id,
    )

    with patch(
        "services.dataset_service.DatasetService.check_dataset_permission",
        side_effect=NoPermissionError("denied"),
    ):
        with pytest.raises(Forbidden, match="denied"):
            DocumentService.prepare_document_batch_download_zip(
                dataset_id=dataset.id,
                document_ids=[],
                tenant_id=current_user_mock.current_tenant_id,
                current_user=current_user_mock,
            )


def test_prepare_document_batch_download_zip_returns_upload_files_in_requested_order(
    db_session_with_containers: Session,
    current_user_mock,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(
        db_session_with_containers,
        tenant_id=current_user_mock.current_tenant_id,
        created_by=current_user_mock.id,
    )
    upload_file_a = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
        name="a.txt",
    )
    upload_file_b = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
        name="b.txt",
    )
    document_a = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": upload_file_a.id},
    )
    document_b = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        data_source_info={"upload_file_id": upload_file_b.id},
    )

    upload_files, download_name = DocumentService.prepare_document_batch_download_zip(
        dataset_id=dataset.id,
        document_ids=[document_b.id, document_a.id],
        tenant_id=current_user_mock.current_tenant_id,
        current_user=current_user_mock,
    )

    assert [upload_file.id for upload_file in upload_files] == [upload_file_b.id, upload_file_a.id]
    assert download_name.endswith(".zip")


def test_get_document_by_dataset_id_returns_enabled_documents(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    enabled_document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        enabled=True,
    )
    DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        enabled=False,
    )

    result = DocumentService.get_document_by_dataset_id(dataset.id)

    assert [document.id for document in result] == [enabled_document.id]


def test_get_working_documents_by_dataset_id_returns_completed_enabled_unarchived_documents(
    db_session_with_containers: Session,
):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    available_document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        indexing_status=IndexingStatus.COMPLETED,
        enabled=True,
        archived=False,
    )
    DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        indexing_status=IndexingStatus.ERROR,
    )

    result = DocumentService.get_working_documents_by_dataset_id(dataset.id)

    assert [document.id for document in result] == [available_document.id]


def test_get_error_documents_by_dataset_id_returns_error_and_paused_documents(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    error_document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        indexing_status=IndexingStatus.ERROR,
    )
    paused_document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        indexing_status=IndexingStatus.PAUSED,
    )
    DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=3,
        indexing_status=IndexingStatus.COMPLETED,
    )

    result = DocumentService.get_error_documents_by_dataset_id(dataset.id)

    assert {document.id for document in result} == {error_document.id, paused_document.id}


def test_get_batch_documents_filters_by_current_user_tenant(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    batch = f"batch-{uuid4()}"
    matching_document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        batch=batch,
    )
    DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        tenant_id=str(uuid4()),
        batch=batch,
    )

    with patch("services.dataset_service.current_user", create_autospec(Account, instance=True)) as current_user:
        current_user.current_tenant_id = dataset.tenant_id
        result = DocumentService.get_batch_documents(dataset.id, batch)

    assert [document.id for document in result] == [matching_document.id]


def test_get_document_file_detail_returns_upload_file(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    upload_file = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
    )

    result = DocumentService.get_document_file_detail(upload_file.id)

    assert result is not None
    assert result.id == upload_file.id


def test_delete_document_emits_signal_and_commits(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    upload_file = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
    )
    document = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": upload_file.id},
    )

    with patch("services.dataset_service.document_was_deleted.send") as signal_send:
        DocumentService.delete_document(document)

    assert db_session_with_containers.get(Document, document.id) is None
    signal_send.assert_called_once_with(
        document.id,
        dataset_id=document.dataset_id,
        doc_form=document.doc_form,
        file_id=upload_file.id,
    )


def test_delete_documents_ignores_empty_input(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)

    with patch("services.dataset_service.batch_clean_document_task.delay") as delay:
        DocumentService.delete_documents(dataset, [])

    delay.assert_not_called()


def test_delete_documents_deletes_rows_and_dispatches_cleanup_task(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    dataset.chunk_structure = IndexStructureType.PARAGRAPH_INDEX
    db_session_with_containers.commit()
    upload_file_a = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
        name="a.txt",
    )
    upload_file_b = DocumentServiceIntegrationFactory.create_upload_file(
        db_session_with_containers,
        tenant_id=dataset.tenant_id,
        created_by=dataset.created_by,
        name="b.txt",
    )
    document_a = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        data_source_info={"upload_file_id": upload_file_a.id},
    )
    document_b = DocumentServiceIntegrationFactory.create_document(
        db_session_with_containers,
        dataset=dataset,
        position=2,
        data_source_info={"upload_file_id": upload_file_b.id},
    )

    with patch("services.dataset_service.batch_clean_document_task.delay") as delay:
        DocumentService.delete_documents(dataset, [document_a.id, document_b.id])

    assert db_session_with_containers.get(Document, document_a.id) is None
    assert db_session_with_containers.get(Document, document_b.id) is None
    delay.assert_called_once()
    args = delay.call_args.args
    assert args[0] == [document_a.id, document_b.id]
    assert args[1] == dataset.id
    assert set(args[3]) == {upload_file_a.id, upload_file_b.id}


def test_get_documents_position_returns_next_position_when_documents_exist(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)
    DocumentServiceIntegrationFactory.create_document(db_session_with_containers, dataset=dataset, position=3)

    assert DocumentService.get_documents_position(dataset.id) == 4


def test_get_documents_position_defaults_to_one_when_dataset_is_empty(db_session_with_containers: Session):
    dataset = DocumentServiceIntegrationFactory.create_dataset(db_session_with_containers)

    assert DocumentService.get_documents_position(dataset.id) == 1

"""Container-backed integration tests for document repository rename behavior."""

import datetime
import json
from collections.abc import Mapping
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom
from models.model import UploadFile
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.documents.contracts import DocumentPersistenceNotFoundError
from services.knowledge.resource_scope import DatasetRef, DocumentRef

FIXED_UPLOAD_CREATED_AT = datetime.datetime(2024, 1, 1, 0, 0, 0)


def _repository(session: Session) -> SQLAlchemyDocumentRepository:
    return SQLAlchemyDocumentRepository(session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False))


def _document_ref(dataset: Dataset, document: Document) -> DocumentRef:
    return DatasetRef(dataset.tenant_id, dataset.id).document(document.id)


def make_dataset(
    db_session_with_containers: Session,
    dataset_id: str | None = None,
    tenant_id: str | None = None,
    built_in_field_enabled: bool = False,
) -> Dataset:
    """Persist a dataset row for rename_document integration scenarios."""
    dataset_id = dataset_id or str(uuid4())
    tenant_id = tenant_id or str(uuid4())

    dataset = Dataset(
        tenant_id=tenant_id,
        name=f"dataset-{uuid4()}",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=str(uuid4()),
    )
    dataset.id = dataset_id
    dataset.built_in_field_enabled = built_in_field_enabled

    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()
    return dataset


def make_document(
    db_session_with_containers: Session,
    document_id: str | None = None,
    dataset_id: str | None = None,
    tenant_id: str | None = None,
    name: str = "Old Name",
    data_source_info: Mapping[str, object] | None = None,
    doc_metadata: Mapping[str, object] | None = None,
) -> Document:
    """Persist a document row used by rename_document integration scenarios."""
    document_id = document_id or str(uuid4())
    dataset_id = dataset_id or str(uuid4())
    tenant_id = tenant_id or str(uuid4())

    doc = Document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info=json.dumps(data_source_info or {}),
        batch=f"batch-{uuid4()}",
        name=name,
        created_from=DocumentCreatedFrom.WEB,
        created_by=str(uuid4()),
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    doc.id = document_id
    doc.indexing_status = "completed"
    doc.doc_metadata = dict(doc_metadata or {})

    db_session_with_containers.add(doc)
    db_session_with_containers.commit()
    return doc


def make_upload_file(db_session_with_containers: Session, tenant_id: str, file_id: str, name: str) -> UploadFile:
    """Persist an upload file row referenced by document.data_source_info."""
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"uploads/{uuid4()}",
        name=name,
        size=128,
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=FIXED_UPLOAD_CREATED_AT,
        used=False,
    )
    upload_file.id = file_id

    db_session_with_containers.add(upload_file)
    db_session_with_containers.commit()
    return upload_file


def test_rename_document_success(db_session_with_containers: Session) -> None:
    """Rename succeeds and returns the renamed document identity by id."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    new_name = "New Document Name"
    tenant_id = str(uuid4())
    dataset = make_dataset(db_session_with_containers, dataset_id, tenant_id)
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset_id,
        tenant_id=tenant_id,
    )

    # Act
    result = _repository(db_session_with_containers).rename_document(_document_ref(dataset, document), new_name)

    # Assert
    db_session_with_containers.refresh(document)
    assert result["id"] == document.id
    assert document.name == new_name


def test_rename_document_with_built_in_fields(db_session_with_containers: Session) -> None:
    """Built-in document_name metadata is updated while existing metadata keys are preserved."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    new_name = "Renamed"
    tenant_id = str(uuid4())
    dataset = make_dataset(db_session_with_containers, dataset_id, tenant_id, built_in_field_enabled=True)
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        doc_metadata={"foo": "bar"},
    )

    # Act
    _repository(db_session_with_containers).rename_document(_document_ref(dataset, document), new_name)

    # Assert
    db_session_with_containers.refresh(document)
    assert document.name == new_name
    assert document.doc_metadata["document_name"] == new_name
    assert document.doc_metadata["foo"] == "bar"


def test_rename_document_updates_upload_file_when_present(db_session_with_containers: Session) -> None:
    """Rename propagates to UploadFile.name when upload_file_id is present in data_source_info."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    file_id = str(uuid4())
    new_name = "Renamed"
    tenant_id = str(uuid4())
    dataset = make_dataset(db_session_with_containers, dataset_id, tenant_id)
    upload_file = make_upload_file(
        db_session_with_containers,
        tenant_id=tenant_id,
        file_id=file_id,
        name="old.pdf",
    )
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        data_source_info={"upload_file_id": file_id},
    )

    # Act
    _repository(db_session_with_containers).rename_document(_document_ref(dataset, document), new_name)

    # Assert
    db_session_with_containers.refresh(document)
    db_session_with_containers.refresh(upload_file)
    assert document.name == new_name
    assert upload_file.name == new_name


def test_rename_document_does_not_update_upload_file_when_missing_id(db_session_with_containers: Session) -> None:
    """Rename does not update UploadFile when data_source_info lacks upload_file_id."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    new_name = "Another Name"
    tenant_id = str(uuid4())
    dataset = make_dataset(db_session_with_containers, dataset_id, tenant_id)
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset.id,
        tenant_id=tenant_id,
        data_source_info={"url": "https://example.com"},
    )
    untouched_file = make_upload_file(
        db_session_with_containers,
        tenant_id=tenant_id,
        file_id=str(uuid4()),
        name="untouched.pdf",
    )

    # Act
    _repository(db_session_with_containers).rename_document(_document_ref(dataset, document), new_name)

    # Assert
    db_session_with_containers.refresh(document)
    db_session_with_containers.refresh(untouched_file)
    assert document.name == new_name
    assert untouched_file.name == "untouched.pdf"


def test_rename_document_missing_owner_chain_is_not_found(db_session_with_containers: Session) -> None:
    """The repository rejects a document whose complete owner chain is absent."""
    ref = DatasetRef(str(uuid4()), str(uuid4())).document(str(uuid4()))

    with pytest.raises(DocumentPersistenceNotFoundError, match="Document not found"):
        _repository(db_session_with_containers).rename_document(ref, "x")


def test_rename_document_not_found(db_session_with_containers: Session) -> None:
    """Rename raises Document not found when document id is absent in the dataset."""
    # Arrange
    dataset = make_dataset(db_session_with_containers, str(uuid4()), str(uuid4()))

    # Act / Assert
    with pytest.raises(DocumentPersistenceNotFoundError, match="Document not found"):
        _repository(db_session_with_containers).rename_document(
            DatasetRef(dataset.tenant_id, dataset.id).document(str(uuid4())), "x"
        )


def test_rename_document_rejects_tenant_mismatch(db_session_with_containers: Session) -> None:
    """A document outside the dataset owner chain is not addressable."""
    # Arrange
    dataset = make_dataset(db_session_with_containers, str(uuid4()), str(uuid4()))
    document = make_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=str(uuid4()),
    )

    # Act / Assert
    with pytest.raises(DocumentPersistenceNotFoundError, match="Document not found"):
        _repository(db_session_with_containers).rename_document(_document_ref(dataset, document), "x")

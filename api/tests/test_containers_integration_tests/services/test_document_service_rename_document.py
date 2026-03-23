"""Container-backed integration tests for DocumentService.rename_document real SQL paths."""

import datetime
import json
from unittest.mock import create_autospec, patch
from uuid import uuid4

import pytest

from models import Account
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.dataset_service import DocumentService

FIXED_UPLOAD_CREATED_AT = datetime.datetime(2024, 1, 1, 0, 0, 0)


@pytest.fixture
def mock_env():
    """Patch only non-SQL dependency used by rename_document: current_user context."""
    with patch("services.dataset_service.current_user", create_autospec(Account, instance=True)) as current_user:
        current_user.current_tenant_id = str(uuid4())
        current_user.id = str(uuid4())
        yield {"current_user": current_user}


def make_dataset(db_session_with_containers, dataset_id=None, tenant_id=None, built_in_field_enabled=False):
    """Persist a dataset row for rename_document integration scenarios."""
    dataset_id = dataset_id or str(uuid4())
    tenant_id = tenant_id or str(uuid4())

    dataset = Dataset(
        tenant_id=tenant_id,
        name=f"dataset-{uuid4()}",
        data_source_type="upload_file",
        created_by=str(uuid4()),
    )
    dataset.id = dataset_id
    dataset.built_in_field_enabled = built_in_field_enabled

    db_session_with_containers.add(dataset)
    db_session_with_containers.commit()
    return dataset


def make_document(
    db_session_with_containers,
    document_id=None,
    dataset_id=None,
    tenant_id=None,
    name="Old Name",
    data_source_info=None,
    doc_metadata=None,
):
    """Persist a document row used by rename_document integration scenarios."""
    document_id = document_id or str(uuid4())
    dataset_id = dataset_id or str(uuid4())
    tenant_id = tenant_id or str(uuid4())

    doc = Document(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type="upload_file",
        data_source_info=json.dumps(data_source_info or {}),
        batch=f"batch-{uuid4()}",
        name=name,
        created_from="web",
        created_by=str(uuid4()),
        doc_form="text_model",
    )
    doc.id = document_id
    doc.indexing_status = "completed"
    doc.doc_metadata = dict(doc_metadata or {})

    db_session_with_containers.add(doc)
    db_session_with_containers.commit()
    return doc


def make_upload_file(db_session_with_containers, tenant_id: str, file_id: str, name: str):
    """Persist an upload file row referenced by document.data_source_info."""
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type="local",
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


def test_rename_document_success(db_session_with_containers, mock_env):
    """Rename succeeds and returns the renamed document identity by id."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    new_name = "New Document Name"
    dataset = make_dataset(db_session_with_containers, dataset_id, mock_env["current_user"].current_tenant_id)
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset_id,
        tenant_id=mock_env["current_user"].current_tenant_id,
    )

    # Act
    result = DocumentService.rename_document(dataset.id, document_id, new_name)

    # Assert
    db_session_with_containers.refresh(document)
    assert result.id == document.id
    assert document.name == new_name


def test_rename_document_with_built_in_fields(db_session_with_containers, mock_env):
    """Built-in document_name metadata is updated while existing metadata keys are preserved."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    new_name = "Renamed"
    dataset = make_dataset(
        db_session_with_containers,
        dataset_id,
        mock_env["current_user"].current_tenant_id,
        built_in_field_enabled=True,
    )
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset.id,
        tenant_id=mock_env["current_user"].current_tenant_id,
        doc_metadata={"foo": "bar"},
    )

    # Act
    DocumentService.rename_document(dataset.id, document.id, new_name)

    # Assert
    db_session_with_containers.refresh(document)
    assert document.name == new_name
    assert document.doc_metadata["document_name"] == new_name
    assert document.doc_metadata["foo"] == "bar"


def test_rename_document_updates_upload_file_when_present(db_session_with_containers, mock_env):
    """Rename propagates to UploadFile.name when upload_file_id is present in data_source_info."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    file_id = str(uuid4())
    new_name = "Renamed"
    dataset = make_dataset(db_session_with_containers, dataset_id, mock_env["current_user"].current_tenant_id)
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset.id,
        tenant_id=mock_env["current_user"].current_tenant_id,
        data_source_info={"upload_file_id": file_id},
    )
    upload_file = make_upload_file(
        db_session_with_containers,
        tenant_id=mock_env["current_user"].current_tenant_id,
        file_id=file_id,
        name="old.pdf",
    )

    # Act
    DocumentService.rename_document(dataset.id, document.id, new_name)

    # Assert
    db_session_with_containers.refresh(document)
    db_session_with_containers.refresh(upload_file)
    assert document.name == new_name
    assert upload_file.name == new_name


def test_rename_document_does_not_update_upload_file_when_missing_id(db_session_with_containers, mock_env):
    """Rename does not update UploadFile when data_source_info lacks upload_file_id."""
    # Arrange
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    new_name = "Another Name"
    dataset = make_dataset(db_session_with_containers, dataset_id, mock_env["current_user"].current_tenant_id)
    document = make_document(
        db_session_with_containers,
        document_id=document_id,
        dataset_id=dataset.id,
        tenant_id=mock_env["current_user"].current_tenant_id,
        data_source_info={"url": "https://example.com"},
    )
    untouched_file = make_upload_file(
        db_session_with_containers,
        tenant_id=mock_env["current_user"].current_tenant_id,
        file_id=str(uuid4()),
        name="untouched.pdf",
    )

    # Act
    DocumentService.rename_document(dataset.id, document.id, new_name)

    # Assert
    db_session_with_containers.refresh(document)
    db_session_with_containers.refresh(untouched_file)
    assert document.name == new_name
    assert untouched_file.name == "untouched.pdf"


def test_rename_document_dataset_not_found(db_session_with_containers, mock_env):
    """Rename raises Dataset not found when dataset id does not exist."""
    # Arrange
    missing_dataset_id = str(uuid4())

    # Act / Assert
    with pytest.raises(ValueError, match="Dataset not found"):
        DocumentService.rename_document(missing_dataset_id, str(uuid4()), "x")


def test_rename_document_not_found(db_session_with_containers, mock_env):
    """Rename raises Document not found when document id is absent in the dataset."""
    # Arrange
    dataset = make_dataset(db_session_with_containers, str(uuid4()), mock_env["current_user"].current_tenant_id)

    # Act / Assert
    with pytest.raises(ValueError, match="Document not found"):
        DocumentService.rename_document(dataset.id, str(uuid4()), "x")


def test_rename_document_permission_denied_when_tenant_mismatch(db_session_with_containers, mock_env):
    """Rename raises No permission when document tenant differs from current_user tenant."""
    # Arrange
    dataset = make_dataset(db_session_with_containers, str(uuid4()), mock_env["current_user"].current_tenant_id)
    document = make_document(
        db_session_with_containers,
        dataset_id=dataset.id,
        tenant_id=str(uuid4()),
    )

    # Act / Assert
    with pytest.raises(ValueError, match="No permission"):
        DocumentService.rename_document(dataset.id, document.id, "x")

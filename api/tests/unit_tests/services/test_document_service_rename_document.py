from types import SimpleNamespace
from unittest.mock import Mock, create_autospec, patch

import pytest

from models import Account
from services.dataset_service import DocumentService


@pytest.fixture
def mock_env():
    """Patch dependencies used by DocumentService.rename_document.

    Mocks:
      - DatasetService.get_dataset
      - DocumentService.get_document
      - current_user (with current_tenant_id)
      - db.session
    """
    with (
        patch("services.dataset_service.DatasetService.get_dataset") as get_dataset,
        patch("services.dataset_service.DocumentService.get_document") as get_document,
        patch("services.dataset_service.current_user", create_autospec(Account, instance=True)) as current_user,
        patch("extensions.ext_database.db.session") as db_session,
    ):
        current_user.current_tenant_id = "tenant-123"
        yield {
            "get_dataset": get_dataset,
            "get_document": get_document,
            "current_user": current_user,
            "db_session": db_session,
        }


def make_dataset(dataset_id="dataset-123", tenant_id="tenant-123", built_in_field_enabled=False):
    return SimpleNamespace(id=dataset_id, tenant_id=tenant_id, built_in_field_enabled=built_in_field_enabled)


def make_document(
    document_id="document-123",
    dataset_id="dataset-123",
    tenant_id="tenant-123",
    name="Old Name",
    data_source_info=None,
    doc_metadata=None,
):
    doc = Mock()
    doc.id = document_id
    doc.dataset_id = dataset_id
    doc.tenant_id = tenant_id
    doc.name = name
    doc.data_source_info = data_source_info or {}
    # property-like usage in code relies on a dict
    doc.data_source_info_dict = dict(doc.data_source_info)
    doc.doc_metadata = dict(doc_metadata or {})
    return doc


def test_rename_document_success(mock_env):
    dataset_id = "dataset-123"
    document_id = "document-123"
    new_name = "New Document Name"

    dataset = make_dataset(dataset_id)
    document = make_document(document_id=document_id, dataset_id=dataset_id)

    mock_env["get_dataset"].return_value = dataset
    mock_env["get_document"].return_value = document

    result = DocumentService.rename_document(dataset_id, document_id, new_name)

    assert result is document
    assert document.name == new_name
    mock_env["db_session"].add.assert_called_once_with(document)
    mock_env["db_session"].commit.assert_called_once()


def test_rename_document_with_built_in_fields(mock_env):
    dataset_id = "dataset-123"
    document_id = "document-123"
    new_name = "Renamed"

    dataset = make_dataset(dataset_id, built_in_field_enabled=True)
    document = make_document(document_id=document_id, dataset_id=dataset_id, doc_metadata={"foo": "bar"})

    mock_env["get_dataset"].return_value = dataset
    mock_env["get_document"].return_value = document

    DocumentService.rename_document(dataset_id, document_id, new_name)

    assert document.name == new_name
    # BuiltInField.document_name == "document_name" in service code
    assert document.doc_metadata["document_name"] == new_name
    assert document.doc_metadata["foo"] == "bar"


def test_rename_document_updates_upload_file_when_present(mock_env):
    dataset_id = "dataset-123"
    document_id = "document-123"
    new_name = "Renamed"
    file_id = "file-123"

    dataset = make_dataset(dataset_id)
    document = make_document(
        document_id=document_id,
        dataset_id=dataset_id,
        data_source_info={"upload_file_id": file_id},
    )

    mock_env["get_dataset"].return_value = dataset
    mock_env["get_document"].return_value = document

    # Intercept UploadFile rename UPDATE chain
    mock_query = Mock()
    mock_query.where.return_value = mock_query
    mock_env["db_session"].query.return_value = mock_query

    DocumentService.rename_document(dataset_id, document_id, new_name)

    assert document.name == new_name
    mock_env["db_session"].query.assert_called()  # update executed


def test_rename_document_does_not_update_upload_file_when_missing_id(mock_env):
    """
    When data_source_info_dict exists but does not contain "upload_file_id",
    UploadFile should not be updated.
    """
    dataset_id = "dataset-123"
    document_id = "document-123"
    new_name = "Another Name"

    dataset = make_dataset(dataset_id)
    # Ensure data_source_info_dict is truthy but lacks the key
    document = make_document(
        document_id=document_id,
        dataset_id=dataset_id,
        data_source_info={"url": "https://example.com"},
    )

    mock_env["get_dataset"].return_value = dataset
    mock_env["get_document"].return_value = document

    DocumentService.rename_document(dataset_id, document_id, new_name)

    assert document.name == new_name
    # Should NOT attempt to update UploadFile
    mock_env["db_session"].query.assert_not_called()


def test_rename_document_dataset_not_found(mock_env):
    mock_env["get_dataset"].return_value = None

    with pytest.raises(ValueError, match="Dataset not found"):
        DocumentService.rename_document("missing", "doc", "x")


def test_rename_document_not_found(mock_env):
    dataset = make_dataset("dataset-123")
    mock_env["get_dataset"].return_value = dataset
    mock_env["get_document"].return_value = None

    with pytest.raises(ValueError, match="Document not found"):
        DocumentService.rename_document(dataset.id, "missing", "x")


def test_rename_document_permission_denied_when_tenant_mismatch(mock_env):
    dataset = make_dataset("dataset-123")
    # different tenant than current_user.current_tenant_id
    document = make_document(dataset_id=dataset.id, tenant_id="tenant-other")

    mock_env["get_dataset"].return_value = dataset
    mock_env["get_document"].return_value = document

    with pytest.raises(ValueError, match="No permission"):
        DocumentService.rename_document(dataset.id, document.id, "x")

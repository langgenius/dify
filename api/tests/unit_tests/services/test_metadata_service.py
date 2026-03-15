from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.rag.index_processor.constant.built_in_field import BuiltInField, MetadataDataSource
from models.dataset import Dataset
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.metadata_service import MetadataService


@dataclass
class _DocumentStub:
    id: str
    name: str
    uploader: str
    upload_date: datetime
    last_update_date: datetime
    data_source_type: str
    doc_metadata: dict[str, object] | None


@pytest.fixture
def mock_db(mocker: MockerFixture) -> MagicMock:
    mocked_db = mocker.patch("services.metadata_service.db")
    mocked_db.session = MagicMock()
    return mocked_db


@pytest.fixture
def mock_redis_client(mocker: MockerFixture) -> MagicMock:
    return mocker.patch("services.metadata_service.redis_client")


@pytest.fixture
def mock_current_account(mocker: MockerFixture) -> MagicMock:
    mock_user = SimpleNamespace(id="user-1")
    return mocker.patch("services.metadata_service.current_account_with_tenant", return_value=(mock_user, "tenant-1"))


def _build_document(document_id: str, doc_metadata: dict[str, object] | None = None) -> _DocumentStub:
    now = datetime(2025, 1, 1, 10, 30, tzinfo=UTC)
    return _DocumentStub(
        id=document_id,
        name=f"doc-{document_id}",
        uploader="qa@example.com",
        upload_date=now,
        last_update_date=now,
        data_source_type="upload_file",
        doc_metadata=doc_metadata,
    )


def _dataset(**kwargs: Any) -> Dataset:
    return cast(Dataset, SimpleNamespace(**kwargs))


def test_create_metadata_should_raise_value_error_when_name_exceeds_limit() -> None:
    # Arrange
    metadata_args = MetadataArgs(type="string", name="x" * 256)

    # Act + Assert
    with pytest.raises(ValueError, match="cannot exceed 255"):
        MetadataService.create_metadata("dataset-1", metadata_args)


def test_create_metadata_should_raise_value_error_when_metadata_name_already_exists(
    mock_db: MagicMock,
    mock_current_account: MagicMock,
) -> None:
    # Arrange
    metadata_args = MetadataArgs(type="string", name="priority")
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

    # Act + Assert
    with pytest.raises(ValueError, match="already exists"):
        MetadataService.create_metadata("dataset-1", metadata_args)

    # Assert
    mock_current_account.assert_called_once()


def test_create_metadata_should_raise_value_error_when_name_collides_with_builtin(
    mock_db: MagicMock, mock_current_account: MagicMock
) -> None:
    # Arrange
    metadata_args = MetadataArgs(type="string", name=BuiltInField.document_name)
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="Built-in fields"):
        MetadataService.create_metadata("dataset-1", metadata_args)


def test_create_metadata_should_persist_metadata_when_input_is_valid(
    mock_db: MagicMock, mock_current_account: MagicMock
) -> None:
    # Arrange
    metadata_args = MetadataArgs(type="number", name="score")
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

    # Act
    result = MetadataService.create_metadata("dataset-1", metadata_args)

    # Assert
    assert result.tenant_id == "tenant-1"
    assert result.dataset_id == "dataset-1"
    assert result.type == "number"
    assert result.name == "score"
    assert result.created_by == "user-1"
    mock_db.session.add.assert_called_once_with(result)
    mock_db.session.commit.assert_called_once()
    mock_current_account.assert_called_once()


def test_update_metadata_name_should_raise_value_error_when_name_exceeds_limit() -> None:
    # Arrange
    too_long_name = "x" * 256

    # Act + Assert
    with pytest.raises(ValueError, match="cannot exceed 255"):
        MetadataService.update_metadata_name("dataset-1", "metadata-1", too_long_name)


def test_update_metadata_name_should_raise_value_error_when_duplicate_name_exists(
    mock_db: MagicMock, mock_current_account: MagicMock
) -> None:
    # Arrange
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()

    # Act + Assert
    with pytest.raises(ValueError, match="already exists"):
        MetadataService.update_metadata_name("dataset-1", "metadata-1", "duplicate")

    # Assert
    mock_current_account.assert_called_once()


def test_update_metadata_name_should_raise_value_error_when_name_collides_with_builtin(
    mock_db: MagicMock,
    mock_current_account: MagicMock,
) -> None:
    # Arrange
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = None

    # Act + Assert
    with pytest.raises(ValueError, match="Built-in fields"):
        MetadataService.update_metadata_name("dataset-1", "metadata-1", BuiltInField.source)

    # Assert
    mock_current_account.assert_called_once()


def test_update_metadata_name_should_update_bound_documents_and_return_metadata(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mock_current_account: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    fixed_now = datetime(2025, 2, 1, 0, 0, tzinfo=UTC)
    mocker.patch("services.metadata_service.naive_utc_now", return_value=fixed_now)

    metadata = SimpleNamespace(id="metadata-1", name="old_name", updated_by=None, updated_at=None)
    bindings = [SimpleNamespace(document_id="doc-1"), SimpleNamespace(document_id="doc-2")]
    query_duplicate = MagicMock()
    query_duplicate.filter_by.return_value.first.return_value = None
    query_metadata = MagicMock()
    query_metadata.filter_by.return_value.first.return_value = metadata
    query_bindings = MagicMock()
    query_bindings.filter_by.return_value.all.return_value = bindings
    mock_db.session.query.side_effect = [query_duplicate, query_metadata, query_bindings]

    doc_1 = _build_document("1", {"old_name": "value", "other": "keep"})
    doc_2 = _build_document("2", None)
    mock_get_documents = mocker.patch("services.metadata_service.DocumentService.get_document_by_ids")
    mock_get_documents.return_value = [doc_1, doc_2]

    # Act
    result = MetadataService.update_metadata_name("dataset-1", "metadata-1", "new_name")

    # Assert
    assert result is metadata
    assert metadata.name == "new_name"
    assert metadata.updated_by == "user-1"
    assert metadata.updated_at == fixed_now
    assert doc_1.doc_metadata == {"other": "keep", "new_name": "value"}
    assert doc_2.doc_metadata == {"new_name": None}
    mock_get_documents.assert_called_once_with(["doc-1", "doc-2"])
    mock_db.session.commit.assert_called_once()
    mock_redis_client.delete.assert_called_once_with("dataset_metadata_lock_dataset-1")
    mock_current_account.assert_called_once()


def test_update_metadata_name_should_return_none_when_metadata_does_not_exist(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mock_current_account: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    mock_logger = mocker.patch("services.metadata_service.logger")

    query_duplicate = MagicMock()
    query_duplicate.filter_by.return_value.first.return_value = None
    query_metadata = MagicMock()
    query_metadata.filter_by.return_value.first.return_value = None
    mock_db.session.query.side_effect = [query_duplicate, query_metadata]

    # Act
    result = MetadataService.update_metadata_name("dataset-1", "missing-id", "new_name")

    # Assert
    assert result is None
    mock_logger.exception.assert_called_once()
    mock_redis_client.delete.assert_called_once_with("dataset_metadata_lock_dataset-1")
    mock_current_account.assert_called_once()


def test_delete_metadata_should_remove_metadata_and_related_document_fields(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    metadata = SimpleNamespace(id="metadata-1", name="obsolete")
    bindings = [SimpleNamespace(document_id="doc-1")]
    query_metadata = MagicMock()
    query_metadata.filter_by.return_value.first.return_value = metadata
    query_bindings = MagicMock()
    query_bindings.filter_by.return_value.all.return_value = bindings
    mock_db.session.query.side_effect = [query_metadata, query_bindings]

    document = _build_document("1", {"obsolete": "legacy", "remaining": "value"})
    mocker.patch("services.metadata_service.DocumentService.get_document_by_ids", return_value=[document])

    # Act
    result = MetadataService.delete_metadata("dataset-1", "metadata-1")

    # Assert
    assert result is metadata
    assert document.doc_metadata == {"remaining": "value"}
    mock_db.session.delete.assert_called_once_with(metadata)
    mock_db.session.commit.assert_called_once()
    mock_redis_client.delete.assert_called_once_with("dataset_metadata_lock_dataset-1")


def test_delete_metadata_should_return_none_when_metadata_is_missing(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = None
    mock_logger = mocker.patch("services.metadata_service.logger")

    # Act
    result = MetadataService.delete_metadata("dataset-1", "missing-id")

    # Assert
    assert result is None
    mock_logger.exception.assert_called_once()
    mock_redis_client.delete.assert_called_once_with("dataset_metadata_lock_dataset-1")


def test_get_built_in_fields_should_return_all_expected_fields() -> None:
    # Arrange
    expected_names = {
        BuiltInField.document_name,
        BuiltInField.uploader,
        BuiltInField.upload_date,
        BuiltInField.last_update_date,
        BuiltInField.source,
    }

    # Act
    result = MetadataService.get_built_in_fields()

    # Assert
    assert {item["name"] for item in result} == expected_names
    assert [item["type"] for item in result] == ["string", "string", "time", "time", "string"]


def test_enable_built_in_field_should_return_immediately_when_already_enabled(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    dataset = _dataset(id="dataset-1", built_in_field_enabled=True)
    get_docs = mocker.patch("services.metadata_service.DocumentService.get_working_documents_by_dataset_id")

    # Act
    MetadataService.enable_built_in_field(dataset)

    # Assert
    get_docs.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_enable_built_in_field_should_populate_documents_and_enable_flag(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    dataset = _dataset(id="dataset-1", built_in_field_enabled=False)
    doc_1 = _build_document("1", {"custom": "value"})
    doc_2 = _build_document("2", None)
    mocker.patch(
        "services.metadata_service.DocumentService.get_working_documents_by_dataset_id",
        return_value=[doc_1, doc_2],
    )

    # Act
    MetadataService.enable_built_in_field(dataset)

    # Assert
    assert dataset.built_in_field_enabled is True
    assert doc_1.doc_metadata is not None
    assert doc_1.doc_metadata[BuiltInField.document_name] == "doc-1"
    assert doc_1.doc_metadata[BuiltInField.source] == MetadataDataSource.upload_file
    assert doc_2.doc_metadata is not None
    assert doc_2.doc_metadata[BuiltInField.uploader] == "qa@example.com"
    mock_db.session.commit.assert_called_once()
    mock_redis_client.delete.assert_called_once_with("dataset_metadata_lock_dataset-1")


def test_disable_built_in_field_should_return_immediately_when_already_disabled(
    mock_db: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    dataset = _dataset(id="dataset-1", built_in_field_enabled=False)
    get_docs = mocker.patch("services.metadata_service.DocumentService.get_working_documents_by_dataset_id")

    # Act
    MetadataService.disable_built_in_field(dataset)

    # Assert
    get_docs.assert_not_called()
    mock_db.session.commit.assert_not_called()


def test_disable_built_in_field_should_remove_builtin_keys_and_disable_flag(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    dataset = _dataset(id="dataset-1", built_in_field_enabled=True)
    document = _build_document(
        "1",
        {
            BuiltInField.document_name: "doc",
            BuiltInField.uploader: "user",
            BuiltInField.upload_date: 1.0,
            BuiltInField.last_update_date: 2.0,
            BuiltInField.source: MetadataDataSource.upload_file,
            "custom": "keep",
        },
    )
    mocker.patch(
        "services.metadata_service.DocumentService.get_working_documents_by_dataset_id",
        return_value=[document],
    )

    # Act
    MetadataService.disable_built_in_field(dataset)

    # Assert
    assert dataset.built_in_field_enabled is False
    assert document.doc_metadata == {"custom": "keep"}
    mock_db.session.commit.assert_called_once()
    mock_redis_client.delete.assert_called_once_with("dataset_metadata_lock_dataset-1")


def test_update_documents_metadata_should_replace_metadata_and_create_bindings_on_full_update(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mock_current_account: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    dataset = _dataset(id="dataset-1", built_in_field_enabled=False)
    document = _build_document("1", {"legacy": "value"})
    mocker.patch("services.metadata_service.DocumentService.get_document", return_value=document)
    delete_chain = mock_db.session.query.return_value.filter_by.return_value
    delete_chain.delete.return_value = 1
    operation = DocumentMetadataOperation(
        document_id="1",
        metadata_list=[MetadataDetail(id="meta-1", name="priority", value="high")],
        partial_update=False,
    )
    metadata_args = MetadataOperationData(operation_data=[operation])

    # Act
    MetadataService.update_documents_metadata(dataset, metadata_args)

    # Assert
    assert document.doc_metadata == {"priority": "high"}
    delete_chain.delete.assert_called_once()
    assert mock_db.session.commit.call_count == 1
    mock_redis_client.delete.assert_called_once_with("document_metadata_lock_1")
    mock_current_account.assert_called_once()


def test_update_documents_metadata_should_skip_existing_binding_and_preserve_existing_fields_on_partial_update(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mock_current_account: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    dataset = _dataset(id="dataset-1", built_in_field_enabled=True)
    document = _build_document("1", {"existing": "value"})
    mocker.patch("services.metadata_service.DocumentService.get_document", return_value=document)
    mock_db.session.query.return_value.filter_by.return_value.first.return_value = object()
    operation = DocumentMetadataOperation(
        document_id="1",
        metadata_list=[MetadataDetail(id="meta-1", name="new_key", value="new_value")],
        partial_update=True,
    )
    metadata_args = MetadataOperationData(operation_data=[operation])

    # Act
    MetadataService.update_documents_metadata(dataset, metadata_args)

    # Assert
    assert document.doc_metadata is not None
    assert document.doc_metadata["existing"] == "value"
    assert document.doc_metadata["new_key"] == "new_value"
    assert document.doc_metadata[BuiltInField.source] == MetadataDataSource.upload_file
    assert mock_db.session.commit.call_count == 1
    assert mock_db.session.add.call_count == 1
    mock_redis_client.delete.assert_called_once_with("document_metadata_lock_1")
    mock_current_account.assert_called_once()


def test_update_documents_metadata_should_raise_and_rollback_when_document_not_found(
    mock_db: MagicMock,
    mock_redis_client: MagicMock,
    mocker: MockerFixture,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None
    dataset = _dataset(id="dataset-1", built_in_field_enabled=False)
    mocker.patch("services.metadata_service.DocumentService.get_document", return_value=None)
    operation = DocumentMetadataOperation(document_id="404", metadata_list=[], partial_update=True)
    metadata_args = MetadataOperationData(operation_data=[operation])

    # Act + Assert
    with pytest.raises(ValueError, match="Document not found"):
        MetadataService.update_documents_metadata(dataset, metadata_args)

    # Assert
    mock_db.session.rollback.assert_called_once()
    mock_redis_client.delete.assert_called_once_with("document_metadata_lock_404")


@pytest.mark.parametrize(
    ("dataset_id", "document_id", "expected_key"),
    [
        ("dataset-1", None, "dataset_metadata_lock_dataset-1"),
        (None, "doc-1", "document_metadata_lock_doc-1"),
    ],
)
def test_knowledge_base_metadata_lock_check_should_set_lock_when_not_already_locked(
    dataset_id: str | None,
    document_id: str | None,
    expected_key: str,
    mock_redis_client: MagicMock,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = None

    # Act
    MetadataService.knowledge_base_metadata_lock_check(dataset_id, document_id)

    # Assert
    mock_redis_client.set.assert_called_once_with(expected_key, 1, ex=3600)


def test_knowledge_base_metadata_lock_check_should_raise_when_dataset_lock_exists(
    mock_redis_client: MagicMock,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = 1

    # Act + Assert
    with pytest.raises(ValueError, match="knowledge base metadata operation is running"):
        MetadataService.knowledge_base_metadata_lock_check("dataset-1", None)


def test_knowledge_base_metadata_lock_check_should_raise_when_document_lock_exists(
    mock_redis_client: MagicMock,
) -> None:
    # Arrange
    mock_redis_client.get.return_value = 1

    # Act + Assert
    with pytest.raises(ValueError, match="document metadata operation is running"):
        MetadataService.knowledge_base_metadata_lock_check(None, "doc-1")


def test_get_dataset_metadatas_should_exclude_builtin_and_include_binding_counts(mock_db: MagicMock) -> None:
    # Arrange
    dataset = _dataset(
        id="dataset-1",
        built_in_field_enabled=True,
        doc_metadata=[
            {"id": "meta-1", "name": "priority", "type": "string"},
            {"id": "built-in", "name": "ignored", "type": "string"},
            {"id": "meta-2", "name": "score", "type": "number"},
        ],
    )
    count_chain = mock_db.session.query.return_value.filter_by.return_value
    count_chain.count.side_effect = [3, 1]

    # Act
    result = MetadataService.get_dataset_metadatas(dataset)

    # Assert
    assert result["built_in_field_enabled"] is True
    assert result["doc_metadata"] == [
        {"id": "meta-1", "name": "priority", "type": "string", "count": 3},
        {"id": "meta-2", "name": "score", "type": "number", "count": 1},
    ]


def test_get_dataset_metadatas_should_return_empty_list_when_no_metadata(mock_db: MagicMock) -> None:
    # Arrange
    dataset = _dataset(id="dataset-1", built_in_field_enabled=False, doc_metadata=None)

    # Act
    result = MetadataService.get_dataset_metadatas(dataset)

    # Assert
    assert result == {"doc_metadata": [], "built_in_field_enabled": False}
    mock_db.session.query.assert_not_called()

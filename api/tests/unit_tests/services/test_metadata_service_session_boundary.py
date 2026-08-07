from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.index_processor.constant.built_in_field import BuiltInField
from models import Account
from models.dataset import Document
from services.dataset_ref_service import DatasetRefService
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.metadata_service import MetadataService


def _account() -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "account-1"
    return account


def test_create_metadata_flushes_without_committing_caller_session() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    metadata = MetadataService.create_metadata(
        "dataset-1",
        MetadataArgs(type="string", name="author"),
        _account(),
        "tenant-1",
        session=session,
    )

    assert metadata.name == "author"
    session.flush.assert_called_once_with()
    session.commit.assert_not_called()
    session.rollback.assert_not_called()


def _document() -> MagicMock:
    document = MagicMock()
    document.id = "document-1"
    document.name = "Document"
    document.doc_metadata = {}
    document.data_source_type = "upload_file"
    document.upload_date = datetime(2026, 1, 1)
    document.last_update_date = datetime(2026, 1, 2)
    document.uploader = "global-session uploader"
    document.get_uploader.return_value = "caller-session uploader"
    return document


def test_enable_built_in_field_uses_caller_session_for_uploader() -> None:
    session = MagicMock()
    dataset = MagicMock(id="dataset-1", built_in_field_enabled=False)
    document = _document()

    with (
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch.object(DocumentService, "get_working_documents_by_dataset_id", return_value=[document]),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.enable_built_in_field(dataset, session)

    assert document.doc_metadata[BuiltInField.uploader] == "caller-session uploader"
    document.get_uploader.assert_called_once_with(session=session)


def test_update_documents_metadata_uses_caller_session_for_uploader() -> None:
    session = MagicMock()
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1", built_in_field_enabled=True)
    document = _document()
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(document_id=document.id, metadata_list=[], partial_update=False),
        ]
    )

    with (
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch.object(DatasetRefService, "get_document_by_ref", return_value=document),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(
            dataset,
            metadata_args,
            _account(),
            "tenant-1",
            session=session,
        )

    assert document.doc_metadata[BuiltInField.uploader] == "caller-session uploader"
    document.get_uploader.assert_called_once_with(session=session)


def test_update_documents_metadata_rejects_foreign_metadata_before_writes() -> None:
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1")
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(
                document_id="document-1",
                metadata_list=[MetadataDetail(id="foreign-metadata", name="spoofed", value="value")],
                partial_update=False,
            )
        ]
    )

    with (
        pytest.raises(ValueError, match="Metadata not found"),
        patch.object(MetadataService, "knowledge_base_metadata_lock_check") as lock_check,
    ):
        MetadataService.update_documents_metadata(dataset, metadata_args, _account(), session=session)

    lock_check.assert_not_called()
    session.add.assert_not_called()
    session.execute.assert_not_called()
    session.commit.assert_not_called()


def test_update_documents_metadata_validates_all_documents_before_writes() -> None:
    session = MagicMock()
    metadata = SimpleNamespace(id="metadata-1", name="canonical")
    session.scalars.return_value.all.return_value = [metadata]
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1", built_in_field_enabled=False)
    metadata_detail = MetadataDetail(id=metadata.id, name="spoofed", value="value")
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(document_id="document-1", metadata_list=[metadata_detail], partial_update=False),
            DocumentMetadataOperation(
                document_id="foreign-document", metadata_list=[metadata_detail], partial_update=False
            ),
        ]
    )

    with (
        pytest.raises(ValueError, match="Document not found"),
        patch.object(DatasetRefService, "get_document_by_ref", side_effect=[_document(), None]),
        patch.object(MetadataService, "knowledge_base_metadata_lock_check") as lock_check,
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(dataset, metadata_args, _account(), session=session)

    lock_check.assert_not_called()
    session.add.assert_not_called()
    session.execute.assert_not_called()
    session.commit.assert_not_called()


def test_update_documents_metadata_uses_canonical_metadata_name() -> None:
    session = MagicMock()
    metadata = SimpleNamespace(id="metadata-1", name="canonical")
    session.scalars.return_value.all.return_value = [metadata]
    dataset = MagicMock(id="dataset-1", tenant_id="tenant-1", built_in_field_enabled=False)
    document = _document()
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(
                document_id=document.id,
                metadata_list=[MetadataDetail(id=metadata.id, name="spoofed", value="value")],
                partial_update=False,
            )
        ]
    )

    with (
        patch.object(DatasetRefService, "get_document_by_ref", return_value=document),
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(dataset, metadata_args, _account(), session=session)

    assert document.doc_metadata == {"canonical": "value"}


def test_document_metadata_details_scopes_binding_to_document_owner() -> None:
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    document = MagicMock(
        id="document-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        doc_metadata={"canonical": "value"},
    )
    document.get_built_in_fields.return_value = []

    assert Document.get_doc_metadata_details(document, session=session) == []

    statement = str(session.scalars.call_args.args[0])
    assert "dataset_metadatas.tenant_id" in statement
    assert "dataset_metadatas.dataset_id" in statement
    assert "dataset_metadata_bindings.tenant_id" in statement
    assert "dataset_metadata_bindings.dataset_id" in statement
    assert "dataset_metadata_bindings.document_id" in statement


def test_get_dataset_metadatas_uses_caller_session() -> None:
    session = MagicMock()
    session.scalar.return_value = 2
    dataset = MagicMock(id="dataset-1", built_in_field_enabled=False)
    dataset.get_doc_metadata.return_value = [{"id": "metadata-1", "name": "author", "type": "string"}]

    result = MetadataService.get_dataset_metadatas(dataset, session)

    assert result == {
        "doc_metadata": [{"id": "metadata-1", "name": "author", "type": "string", "count": 2}],
        "built_in_field_enabled": False,
    }
    dataset.get_doc_metadata.assert_called_once_with(session=session)

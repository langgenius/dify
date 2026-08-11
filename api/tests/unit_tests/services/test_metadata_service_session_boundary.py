from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from core.rag.index_processor.constant.built_in_field import BuiltInField
from models import Account
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Document
from models.enums import DataSourceType, DocumentCreatedFrom
from services.dataset_service import DocumentService
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataOperationData,
    MetadataUpdateArgs,
)
from services.metadata_service import MetadataService


def _account() -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "account-1"
    return account


def test_create_metadata_flushes_without_committing_caller_session(sqlite_session: Session) -> None:
    transaction_events: list[str] = []
    event.listen(sqlite_session, "after_commit", lambda _session: transaction_events.append("commit"))
    event.listen(sqlite_session, "after_rollback", lambda _session: transaction_events.append("rollback"))

    metadata = MetadataService.create_metadata(
        "dataset-1",
        MetadataArgs(type="string", name="author"),
        _account(),
        "tenant-1",
        session=sqlite_session,
    )

    assert metadata.name == "author"
    assert sqlite_session.get(DatasetMetadata, metadata.id) is metadata
    assert transaction_events == []


def _dataset(*, built_in_field_enabled: bool) -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="",
        provider="vendor",
        created_by="account-1",
        built_in_field_enabled=built_in_field_enabled,
    )


def _document() -> Document:
    return Document(
        id="document-1",
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
        doc_metadata={},
    )


def test_enable_built_in_field_uses_caller_session_for_uploader(sqlite_session: Session) -> None:
    dataset = _dataset(built_in_field_enabled=False)
    document = _document()
    sqlite_session.add_all([_account(), dataset, document])
    sqlite_session.commit()

    with (
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch.object(DocumentService, "get_working_documents_by_dataset_id", return_value=[document]),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.enable_built_in_field(dataset, sqlite_session)

    assert document.doc_metadata[BuiltInField.uploader] == "User"


def test_update_documents_metadata_uses_caller_session_for_uploader(sqlite_session: Session) -> None:
    dataset = _dataset(built_in_field_enabled=True)
    document = _document()
    sqlite_session.add_all([_account(), dataset, document])
    sqlite_session.commit()
    metadata_args = MetadataOperationData(
        operation_data=[
            DocumentMetadataOperation(document_id=document.id, metadata_list=[], partial_update=False),
        ]
    )

    with (
        patch.object(MetadataService, "knowledge_base_metadata_lock_check"),
        patch.object(DocumentService, "get_document", return_value=document),
        patch("services.metadata_service.redis_client.delete"),
    ):
        MetadataService.update_documents_metadata(
            dataset,
            metadata_args,
            _account(),
            "tenant-1",
            session=sqlite_session,
        )

    assert document.doc_metadata[BuiltInField.uploader] == "User"


def test_get_dataset_metadatas_uses_caller_session(monkeypatch, sqlite_session: Session) -> None:
    dataset = _dataset(built_in_field_enabled=False)
    sqlite_session.add_all(
        [
            DatasetMetadataBinding(
                tenant_id="tenant-1",
                dataset_id="dataset-1",
                document_id=f"document-{index}",
                metadata_id="metadata-1",
                created_by="account-1",
            )
            for index in range(2)
        ]
    )
    sqlite_session.commit()

    def get_doc_metadata(_dataset: Dataset, *, session: Session) -> list[dict[str, str]]:
        assert session is sqlite_session
        return [{"id": "metadata-1", "name": "author", "type": "string"}]

    monkeypatch.setattr(Dataset, "get_doc_metadata", get_doc_metadata)

    result = MetadataService.get_dataset_metadatas(dataset, sqlite_session)

    assert result == {
        "doc_metadata": [{"id": "metadata-1", "name": "author", "type": "string", "count": 2}],
        "built_in_field_enabled": False,
    }
    assert sqlite_session.scalar(select(DatasetMetadataBinding).limit(1)) is not None


def test_rebuild_effective_metadata_merges_document_defaults_and_segment_overrides() -> None:
    session = MagicMock()
    dataset = SimpleNamespace(id="dataset-1", built_in_field_enabled=False)
    document = SimpleNamespace(
        id="document-1",
        doc_metadata={"security_level": "public", "region": "cn"},
        segment_metadata_override_count=0,
        has_segment_metadata_override=False,
    )
    inherited_segment = SimpleNamespace(id="segment-1")
    overridden_segment = SimpleNamespace(id="segment-2")
    metadata_definitions = [SimpleNamespace(id="metadata-security", name="security_level")]
    override = SimpleNamespace(segment_id="segment-2", metadata_id="metadata-security", value_json="confidential")

    def result(items):
        scalar_result = MagicMock()
        scalar_result.all.return_value = items
        return scalar_result

    session.scalars.side_effect = [
        result([inherited_segment, overridden_segment]),
        result(metadata_definitions),
        result([override]),
    ]
    session.scalar.return_value = 1

    MetadataService.rebuild_segment_effective_metadata(session, dataset, document)

    assert inherited_segment.effective_metadata == {"security_level": "public", "region": "cn"}
    assert inherited_segment.effective_security_level == "public"
    assert inherited_segment.metadata_override_count == 0
    assert overridden_segment.effective_metadata == {"security_level": "confidential", "region": "cn"}
    assert overridden_segment.effective_security_level == "confidential"
    assert overridden_segment.metadata_override_count == 1
    assert document.has_segment_metadata_override is True
    assert document.segment_metadata_override_count == 1


def test_segment_value_equal_to_document_default_removes_override() -> None:
    session = MagicMock()
    dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1", built_in_field_enabled=False)
    document = SimpleNamespace(id="document-1", doc_metadata={"security_level": "public"})
    segment = SimpleNamespace(id="segment-1", dataset_id="dataset-1", document_id="document-1")
    metadata = SimpleNamespace(id="metadata-security", name="security_level")
    existing_binding = SimpleNamespace(id="binding-1")
    metadata_result = MagicMock()
    metadata_result.all.return_value = [metadata]
    session.scalars.return_value = metadata_result
    session.scalar.return_value = existing_binding

    with patch.object(MetadataService, "rebuild_segment_effective_metadata") as rebuild:
        MetadataService.apply_segment_metadata_override(
            session,
            dataset,
            document,
            segment,
            [MetadataUpdateArgs(name="security_level", value="public")],
            _account(),
            "tenant-1",
        )

    session.delete.assert_called_once_with(existing_binding)
    rebuild.assert_called_once_with(session, dataset, document, segment_ids=[segment.id])


def test_segment_explicit_null_is_preserved_as_override() -> None:
    session = MagicMock()
    dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1", built_in_field_enabled=False)
    document = SimpleNamespace(id="document-1", doc_metadata={"security_level": None})
    segment = SimpleNamespace(id="segment-1", dataset_id="dataset-1", document_id="document-1")
    metadata = SimpleNamespace(id="metadata-security", name="security_level")
    metadata_result = MagicMock()
    metadata_result.all.return_value = [metadata]
    session.scalars.return_value = metadata_result
    session.scalar.return_value = None

    with patch.object(MetadataService, "rebuild_segment_effective_metadata"):
        MetadataService.apply_segment_metadata_override(
            session,
            dataset,
            document,
            segment,
            [MetadataUpdateArgs(name="security_level", value=None)],
            _account(),
            "tenant-1",
        )

    binding = session.add.call_args.args[0]
    assert binding.value_json is None
    assert binding.metadata_id == metadata.id
    session.delete.assert_not_called()


def test_metadata_lock_uses_owner_token_for_atomic_release() -> None:
    with patch("services.metadata_service.redis_client") as redis:
        redis.set.return_value = True
        with MetadataService.metadata_lock(document_id="document-1"):
            pass

    lock_key, token = redis.set.call_args.args[:2]
    assert lock_key == "document_metadata_lock_document-1"
    redis.set.assert_called_once_with(
        lock_key,
        token,
        nx=True,
        ex=MetadataService._LOCK_TTL_SECONDS,
    )
    redis.eval.assert_called_once_with(MetadataService._LOCK_RELEASE_SCRIPT, 1, lock_key, token)


def test_metadata_lock_does_not_release_another_owner() -> None:
    with patch("services.metadata_service.redis_client") as redis:
        redis.set.return_value = False
        with pytest.raises(ValueError, match="Another document metadata operation"):
            with MetadataService.metadata_lock(document_id="document-1"):
                pass

    redis.eval.assert_not_called()

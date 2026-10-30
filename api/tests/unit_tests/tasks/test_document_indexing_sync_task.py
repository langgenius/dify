"""Tests for the legacy Notion document sync task's current persistence boundary."""

import json
import uuid
from collections.abc import Iterator
from contextlib import AbstractContextManager, nullcontext
from datetime import datetime
from typing import override
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import tasks.document_indexing_sync_task as task_module
from core.db import session_factory as session_factory_module
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.locks import KnowledgeIndexingLeaseLostError
from tasks.document_indexing_sync_task import document_indexing_sync_task


class _OwnedLease:
    token = "test-owner"

    @staticmethod
    def assert_owned() -> None:
        return None

    @staticmethod
    def renew() -> bool:
        return True

    @staticmethod
    def release() -> bool:
        return True


class _LostAfterCleanupLease(_OwnedLease):
    def __init__(self) -> None:
        self._checks = 0

    @override
    def assert_owned(self) -> None:
        self._checks += 1
        if self._checks == 2:
            raise KnowledgeIndexingLeaseLostError("ownership changed after cleanup")


class _IndexingLockStub:
    def __init__(self, lease: _OwnedLease) -> None:
        self.lease = lease

    def hold(self, *_args: object, **_kwargs: object) -> AbstractContextManager[_OwnedLease]:
        return nullcontext(self.lease)


pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment)],
    indirect=True,
)


@pytest.fixture
def dataset_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def document_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def tenant_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def dataset(sqlite_session: Session, dataset_id: str, tenant_id: str) -> Dataset:
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Notion dataset",
        data_source_type=DataSourceType.NOTION_IMPORT,
        indexing_technique="economy",
        created_by=str(uuid.uuid4()),
    )
    sqlite_session.add(dataset)
    sqlite_session.commit()
    return dataset


@pytest.fixture
def document(
    sqlite_session: Session,
    dataset: Dataset,
    document_id: str,
    tenant_id: str,
) -> Document:
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info=json.dumps(
            {
                "notion_workspace_id": "workspace-id",
                "notion_page_id": "page-id",
                "type": "page",
                "last_edited_time": "2024-01-01T00:00:00Z",
                "credential_id": "credential-id",
            }
        ),
        batch="batch-1",
        name="Notion page",
        created_from=DocumentCreatedFrom.API,
        created_by=str(uuid.uuid4()),
        indexing_status=IndexingStatus.WAITING,
        completed_at=datetime(2024, 1, 1),
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add(document)
    sqlite_session.commit()
    return document


@pytest.fixture(autouse=True)
def _bind_sqlite_session_factory(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    monkeypatch.setattr(
        session_factory_module,
        "_session_maker",
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )
    monkeypatch.setattr(task_module, "RedisKnowledgeIndexingLock", lambda **_kwargs: _IndexingLockStub(_OwnedLease()))


@pytest.fixture
def datasource_provider() -> Iterator[MagicMock]:
    with patch("tasks.document_indexing_sync_task.build_data_source_credentials", autospec=True) as builder:
        provider = MagicMock()
        provider.get_stored_notion_access_token.return_value = "test-token"
        builder.return_value.providers = provider
        yield provider


@pytest.fixture
def notion_extractor() -> Iterator[dict[str, MagicMock]]:
    with patch("tasks.document_indexing_sync_task.NotionExtractor", autospec=True) as extractor_class:
        extractor = MagicMock()
        extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"
        extractor_class.return_value = extractor
        yield {"class": extractor_class, "instance": extractor}


def test_unchanged_page_resolves_credentials_and_constructs_extractor(
    datasource_provider: MagicMock,
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    document_indexing_sync_task(dataset_id, document_id)

    datasource_provider.get_stored_notion_access_token.assert_called_once_with(
        tenant_id=document.tenant_id,
        credential_id="credential-id",
    )
    notion_extractor["class"].assert_called_once_with(
        notion_obj_id="page-id",
        notion_page_type="page",
        notion_access_token="test-token",
    )
    notion_extractor["instance"].get_notion_last_edited_time.assert_called_once_with()
    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(Document, document.id)
    assert persisted.indexing_status == IndexingStatus.COMPLETED
    assert persisted.data_source_info_dict["last_edited_time"] == "2024-01-01T00:00:00Z"
    assert persisted.completed_at is not None


@pytest.mark.usefixtures("datasource_provider")
def test_unchanged_first_import_runs_indexing_instead_of_faking_completion(
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    document.completed_at = None
    sqlite_session.commit()
    indexing_service = MagicMock()

    with (
        patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as processor_factory,
        patch(
            "tasks.document_indexing_sync_task.build_document_indexing_service",
            return_value=indexing_service,
        ),
    ):
        document_indexing_sync_task(dataset_id, document_id)

    processor_factory.assert_not_called()
    notion_extractor["instance"].get_notion_last_edited_time.assert_called_once_with()
    expected_ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
    indexing_service.run.assert_called_once()
    assert indexing_service.run.call_args.args == ([expected_ref],)
    assert set(indexing_service.run.call_args.kwargs["owned_leases"]) == {document.id}
    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(Document, document.id)
    assert persisted.indexing_status == IndexingStatus.PARSING
    assert persisted.completed_at is None


@pytest.mark.usefixtures("datasource_provider")
def test_unchanged_partial_first_import_cleans_known_nodes_before_reindexing(
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    document.completed_at = None
    segment = DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=1,
        content="partial content",
        answer=None,
        word_count=2,
        tokens=2,
        keywords=None,
        index_node_id="partial-node",
        index_node_hash="partial-hash",
        hit_count=0,
        enabled=True,
        status=SegmentStatus.COMPLETED,
        created_by=document.created_by,
    )
    sqlite_session.add(segment)
    sqlite_session.commit()
    indexing_service = MagicMock()

    with (
        patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as processor_factory,
        patch(
            "tasks.document_indexing_sync_task.build_document_indexing_service",
            return_value=indexing_service,
        ),
    ):
        document_indexing_sync_task(dataset_id, document_id)

    clean = processor_factory.return_value.init_index_processor.return_value.clean
    assert clean.call_args.args[1] == ["partial-node"]
    notion_extractor["instance"].get_notion_last_edited_time.assert_called_once_with()
    expected_ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
    indexing_service.run.assert_called_once()
    assert indexing_service.run.call_args.args == ([expected_ref],)
    assert set(indexing_service.run.call_args.kwargs["owned_leases"]) == {document.id}
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all() == []


def test_missing_credential_id_is_forwarded_as_none(
    datasource_provider: MagicMock,
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    source_info = document.data_source_info_dict
    source_info.pop("credential_id")
    document.data_source_info = json.dumps(source_info)
    sqlite_session.commit()

    document_indexing_sync_task(dataset_id, document_id)

    datasource_provider.get_stored_notion_access_token.assert_called_once_with(
        tenant_id=document.tenant_id,
        credential_id=None,
    )
    notion_extractor["instance"].get_notion_last_edited_time.assert_called_once_with()


def test_missing_credentials_mark_document_error_without_indexing(
    datasource_provider: MagicMock,
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    datasource_provider.get_stored_notion_access_token.side_effect = ValueError("stored credential unavailable")
    with patch("tasks.document_indexing_sync_task.build_document_indexing_service") as build_indexing:
        document_indexing_sync_task(dataset_id, document_id)

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(Document, document.id)
    assert persisted.indexing_status == IndexingStatus.ERROR
    assert persisted.error == "Datasource credential not found. Please reconnect your Notion workspace."
    assert persisted.stopped_at is not None
    notion_extractor["class"].assert_not_called()
    build_indexing.assert_not_called()


@pytest.mark.usefixtures("datasource_provider")
def test_changed_page_starts_indexing_without_publishing_source_version_early(
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    notion_extractor["instance"].get_notion_last_edited_time.return_value = "2024-02-01T00:00:00Z"
    segment = DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=1,
        content="old content",
        answer=None,
        word_count=2,
        tokens=2,
        keywords=None,
        index_node_id="old-node",
        index_node_hash="old-hash",
        hit_count=0,
        enabled=True,
        status=SegmentStatus.COMPLETED,
        created_by=document.created_by,
    )
    sqlite_session.add(segment)
    sqlite_session.commit()

    indexing_service = MagicMock()
    with (
        patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as processor_factory,
        patch(
            "tasks.document_indexing_sync_task.build_document_indexing_service",
            return_value=indexing_service,
        ),
    ):
        document_indexing_sync_task(dataset_id, document_id)

    processor_factory.return_value.init_index_processor.return_value.clean.assert_called_once()
    expected_ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
    indexing_service.run.assert_called_once()
    assert indexing_service.run.call_args.args == ([expected_ref],)
    assert set(indexing_service.run.call_args.kwargs["owned_leases"]) == {document.id}
    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(Document, document.id)
    assert persisted.data_source_info_dict["last_edited_time"] == "2024-01-01T00:00:00Z"
    assert "pending_last_edited_time" not in persisted.data_source_info_dict
    assert persisted.indexing_status == IndexingStatus.PARSING
    assert persisted.processing_started_at is not None
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all() == []


@pytest.mark.usefixtures("datasource_provider")
def test_lease_loss_after_notion_cleanup_preserves_retryable_state(
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    notion_extractor["instance"].get_notion_last_edited_time.return_value = "2024-02-01T00:00:00Z"
    segment = DocumentSegment(
        tenant_id=document.tenant_id,
        dataset_id=document.dataset_id,
        document_id=document.id,
        position=1,
        content="old content",
        word_count=2,
        tokens=2,
        index_node_id="old-node",
        created_by=document.created_by,
    )
    sqlite_session.add(segment)
    sqlite_session.commit()

    with (
        patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as processor_factory,
        patch("tasks.document_indexing_sync_task.build_document_indexing_service") as indexing_service,
        pytest.raises(KnowledgeIndexingLeaseLostError),
    ):
        task_module._run_document_indexing_sync_task(
            dataset_id,
            document_id,
            lease=_LostAfterCleanupLease(),
        )

    processor_factory.return_value.init_index_processor.return_value.clean.assert_called_once()
    indexing_service.return_value.run.assert_not_called()
    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(Document, document.id)
    assert persisted.indexing_status == IndexingStatus.WAITING
    assert persisted.error is None
    assert sqlite_session.get(DocumentSegment, segment.id) is not None


@pytest.mark.parametrize(
    ("status", "runner"),
    [
        (IndexingStatus.PARSING, "run"),
        (IndexingStatus.CLEANING, "run"),
        (IndexingStatus.SPLITTING, "run_in_splitting_status"),
        (IndexingStatus.INDEXING, "run_in_indexing_status"),
    ],
)
def test_interrupted_document_resumes_under_the_owned_lease(
    datasource_provider: MagicMock,
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
    status: IndexingStatus,
    runner: str,
) -> None:
    document.indexing_status = status
    sqlite_session.commit()

    with patch("tasks.document_indexing_sync_task.build_document_indexing_service") as builder:
        document_indexing_sync_task(dataset_id, document_id)

    resumed = getattr(builder.return_value, runner)
    resumed.assert_called_once()
    assert resumed.call_args.kwargs.get("owned_lease") or resumed.call_args.kwargs.get("owned_leases")

    datasource_provider.get_stored_notion_access_token.assert_not_called()
    notion_extractor["class"].assert_not_called()


@pytest.mark.usefixtures("datasource_provider")
def test_lease_loss_after_parsing_commit_is_resumed_on_redelivery(
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
) -> None:
    notion_extractor["instance"].get_notion_last_edited_time.return_value = "new-version"
    ref = DatasetRef(document.tenant_id, document.dataset_id).document(document.id)
    with (
        patch("tasks.document_indexing_sync_task.IndexProcessorFactory"),
        patch("tasks.document_indexing_sync_task.build_document_indexing_service") as builder,
    ):
        builder.return_value.run.side_effect = KnowledgeIndexingLeaseLostError("expired after parsing commit")
        with pytest.raises(KnowledgeIndexingLeaseLostError):
            task_module._run_document_indexing_sync_task(document.dataset_id, document.id, lease=_OwnedLease())
        sqlite_session.refresh(document)
        assert document.indexing_status == IndexingStatus.PARSING

        def complete(*_args: object, **_kwargs: object) -> None:
            document.indexing_status = IndexingStatus.COMPLETED
            sqlite_session.commit()

        builder.return_value.run.side_effect = complete
        task_module._run_document_indexing_sync_task(document.dataset_id, document.id, lease=_OwnedLease())

    assert builder.return_value.run.call_count == 2
    assert builder.return_value.run.call_args.args[0] == [ref]
    sqlite_session.refresh(document)
    assert document.indexing_status == IndexingStatus.COMPLETED


def test_non_notion_document_is_skipped(
    datasource_provider: MagicMock,
    notion_extractor: dict[str, MagicMock],
    document: Document,
    sqlite_session: Session,
    dataset_id: str,
    document_id: str,
) -> None:
    document.data_source_type = DataSourceType.UPLOAD_FILE
    sqlite_session.commit()

    document_indexing_sync_task(dataset_id, document_id)

    datasource_provider.get_stored_notion_access_token.assert_not_called()
    notion_extractor["class"].assert_not_called()

"""Unit tests for document sync persistence and external collaborator wiring.

The task's Dataset and Document lookups use real SQLite transactions. Datasource,
Notion extraction, index cleanup, and indexing remain mocked I/O boundaries.
"""

import json
import uuid
from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import TypedDict
from unittest.mock import ANY, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import tasks.document_indexing_sync_task as sync_task_module
from core.db import session_factory as session_factory_module
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLeaseLostError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef, DocumentRef
from tasks.document_indexing_sync_task import (
    _run_document_indexing_sync_task,
    document_indexing_sync_task,
    sync_notion_document_indexing_task,
)

pytestmark = pytest.mark.parametrize(
    "sqlite_session",
    [(Dataset, Document, DocumentSegment, KnowledgeTaskOutbox)],
    indirect=True,
)
_GENERATION = "5d5df92f-2c72-45cb-a5af-f17083b38149"


@dataclass
class RecordingLease:
    name: str
    events: list[str]
    lost: bool = False
    token: str = "lease-token"

    def assert_owned(self) -> None:
        self.events.append(f"assert:{self.name}")
        if self.lost:
            raise KnowledgeIndexingLeaseLostError(f"lease lost: {self.name}")

    def renew(self) -> bool:
        return not self.lost

    def release(self) -> bool:
        return True


@dataclass
class RecordingLock:
    events: list[str] = field(default_factory=list)
    leases: dict[str, RecordingLease] = field(default_factory=dict)

    @contextmanager
    def hold(self, name: str, **_kwargs: object) -> Generator[RecordingLease]:
        self.events.append(f"enter:{name}")
        lease = self.leases.setdefault(name, RecordingLease(name=name, events=self.events))
        try:
            yield lease
        finally:
            lease.lost = True
            self.events.append(f"exit:{name}")


@dataclass
class RecordingIndexingService:
    calls: list[tuple[tuple[DocumentRef, ...], Mapping[str, DocumentIndexingExecution]]] = field(default_factory=list)
    error: Exception | None = None

    def run(
        self,
        refs: Sequence[DocumentRef],
        *,
        executions: Mapping[str, DocumentIndexingExecution],
    ) -> None:
        self.calls.append((tuple(refs), dict(executions)))
        if self.error is not None:
            raise self.error


@dataclass
class RecordingProcessor:
    callback: Callable[[], None] | None = None
    clean_calls: int = 0

    def clean(self, *_args: object, **_kwargs: object) -> None:
        self.clean_calls += 1
        if self.callback is not None:
            self.callback()


@dataclass(frozen=True)
class ProcessorFactoryResult:
    processor: RecordingProcessor

    def init_index_processor(self) -> RecordingProcessor:
        return self.processor


@dataclass
class DataSourceProvider:
    credential: dict[str, str] = field(default_factory=lambda: {"integration_secret": "test_token"})

    def get_datasource_credentials(self, **_kwargs: object) -> dict[str, str]:
        return dict(self.credential)

    def get_stored_notion_access_token(self, **_kwargs: object) -> str:
        return "test-token"


@dataclass(frozen=True)
class DataSourceCredentials:
    providers: DataSourceProvider


class ChangedNotionExtractor:
    def __init__(self, **_kwargs: object) -> None:
        pass

    def get_notion_last_edited_time(self) -> str:
        return "2024-02-01T00:00:00Z"


class ExtractorMocks(TypedDict):
    class_: MagicMock
    instance: MagicMock


@pytest.fixture
def dataset_id() -> str:
    """Generate a dataset id."""
    return str(uuid.uuid4())


@pytest.fixture
def document_id() -> str:
    """Generate a document id."""
    return str(uuid.uuid4())


@pytest.fixture
def notion_workspace_id() -> str:
    """Generate a notion workspace id."""
    return str(uuid.uuid4())


@pytest.fixture
def notion_page_id() -> str:
    """Generate a notion page id."""
    return str(uuid.uuid4())


@pytest.fixture
def credential_id() -> str:
    """Generate a credential id."""
    return str(uuid.uuid4())


@pytest.fixture
def tenant_id() -> str:
    """Generate the tenant that owns the persisted dataset and document."""
    return str(uuid.uuid4())


@pytest.fixture
def dataset(sqlite_session: Session, dataset_id: str, tenant_id: str) -> Dataset:
    """Persist the dataset resolved by the task's initial and cleanup transactions."""
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Notion dataset",
        data_source_type=DataSourceType.NOTION_IMPORT,
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
    notion_workspace_id: str,
    notion_page_id: str,
    credential_id: str,
) -> Document:
    """Persist a completed Notion document for collaborator and update assertions."""
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info=json.dumps(
            {
                "notion_workspace_id": notion_workspace_id,
                "notion_page_id": notion_page_id,
                "type": "page",
                "last_edited_time": "2024-01-01T00:00:00Z",
                "credential_id": credential_id,
            }
        ),
        batch="batch-1",
        name="Notion page",
        created_from=DocumentCreatedFrom.API,
        created_by=str(uuid.uuid4()),
        indexing_status=IndexingStatus.COMPLETED,
        indexing_generation=_GENERATION,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    sqlite_session.add(document)
    sqlite_session.commit()
    return document


@pytest.fixture(autouse=True)
def _bind_sqlite_session_factory(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    indexing_lock: RecordingLock,
) -> None:
    """Bind each task-owned session to the test's isolated SQLite database."""
    monkeypatch.setattr(
        session_factory_module,
        "_session_maker",
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
    )
    monkeypatch.setattr(sync_task_module, "_indexing_lock", lambda: indexing_lock)
    monkeypatch.setattr(sync_task_module, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)


@pytest.fixture
def indexing_lock() -> RecordingLock:
    return RecordingLock()


@pytest.fixture
def mock_datasource_provider_service() -> Generator[MagicMock]:
    """Mock datasource credential provider."""
    with patch("tasks.document_indexing_sync_task.build_data_source_credentials", autospec=True) as mock_service_class:
        mock_service = MagicMock()
        mock_service.get_datasource_credentials.return_value = {"integration_secret": "test_token"}
        mock_service_class.return_value.providers = mock_service
        yield mock_service


@pytest.fixture
def mock_notion_extractor() -> Generator[ExtractorMocks]:
    """Mock notion extractor class and instance."""
    with patch("tasks.document_indexing_sync_task.NotionExtractor", autospec=True) as mock_extractor_class:
        mock_extractor = MagicMock()
        mock_extractor.get_notion_last_edited_time.return_value = "2024-01-01T00:00:00Z"
        mock_extractor_class.return_value = mock_extractor
        yield {"class_": mock_extractor_class, "instance": mock_extractor}


def _install_changed_content_collaborators(
    monkeypatch: pytest.MonkeyPatch,
    *,
    provider: DataSourceProvider,
    processor: RecordingProcessor,
    indexing_service: RecordingIndexingService,
) -> None:
    def build_credentials(*, database_client: object) -> DataSourceCredentials:
        del database_client
        return DataSourceCredentials(providers=provider)

    def build_processor(_index_type: str) -> ProcessorFactoryResult:
        return ProcessorFactoryResult(processor=processor)

    def build_indexing_service(*, session_factory: object) -> RecordingIndexingService:
        del session_factory
        return indexing_service

    monkeypatch.setattr(sync_task_module, "build_data_source_credentials", build_credentials)
    monkeypatch.setattr(sync_task_module, "NotionExtractor", ChangedNotionExtractor)
    monkeypatch.setattr(sync_task_module, "IndexProcessorFactory", build_processor)
    monkeypatch.setattr(sync_task_module, "build_document_indexing_service", build_indexing_service)


def _persist_indexed_segment(session: Session, *, dataset: Dataset, document: Document) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="notion content",
        word_count=2,
        tokens=2,
        created_by=document.created_by,
        index_node_id="notion-node-1",
    )
    session.add(segment)
    session.commit()
    return segment


class TestDocumentIndexingSyncTaskCollaboratorParams:
    """Unit tests for collaborator parameter passing in document_indexing_sync_task."""

    def test_notion_extractor_initialized_with_correct_params(
        self,
        mock_datasource_provider_service: MagicMock,
        mock_notion_extractor: ExtractorMocks,
        document: Document,
        dataset_id: str,
        document_id: str,
        notion_workspace_id: str,
        notion_page_id: str,
    ) -> None:
        """Test that NotionExtractor is initialized with expected arguments."""
        # Arrange
        expected_token = "test_token"

        # Act
        _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

        # Assert
        mock_notion_extractor["class_"].assert_called_once_with(
            notion_token_loader=ANY,
            notion_workspace_id=notion_workspace_id,
            notion_obj_id=notion_page_id,
            notion_page_type="page",
            notion_access_token=expected_token,
            tenant_id=document.tenant_id,
        )

    def test_datasource_credentials_requested_correctly(
        self,
        mock_datasource_provider_service: MagicMock,
        mock_notion_extractor: ExtractorMocks,
        document: Document,
        dataset_id: str,
        document_id: str,
        credential_id: str,
    ) -> None:
        """Test that datasource credentials are requested with expected identifiers."""
        # Arrange
        expected_tenant_id = document.tenant_id

        # Act
        _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

        # Assert
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once_with(
            tenant_id=expected_tenant_id,
            credential_id=credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )

    def test_versioned_celery_delivery_completes_durable_intent(
        self,
        sqlite_session: Session,
        mock_datasource_provider_service: MagicMock,
        mock_notion_extractor: ExtractorMocks,
        document: Document,
        dataset_id: str,
        document_id: str,
    ) -> None:
        intent = KnowledgeTaskOutbox(
            tenant_id=document.tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            resource_id=document_id,
            task_kind="document_index_sync",
            payload={
                "dataset_id": dataset_id,
                "document_id": document_id,
                "generation": _GENERATION,
                "source": "notion",
            },
            status="dispatched",
        )
        sqlite_session.add(intent)
        sqlite_session.commit()

        sync_notion_document_indexing_task.run(dataset_id, document_id, _GENERATION, intent.id)

        sqlite_session.expire_all()
        persisted = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
        assert persisted is not None
        assert persisted.status == "completed"
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once()
        mock_notion_extractor["instance"].get_notion_last_edited_time.assert_called_once()

    def test_new_notion_sync_with_unchanged_content_completes_generation_and_preserves_material(
        self,
        sqlite_session: Session,
        mock_datasource_provider_service: MagicMock,
        mock_notion_extractor: ExtractorMocks,
        dataset: Dataset,
        document: Document,
        dataset_id: str,
        document_id: str,
    ) -> None:
        segment = _persist_indexed_segment(sqlite_session, dataset=dataset, document=document)
        document.indexing_generation = "old-generation"
        document.need_summary = True
        dataset.indexing_technique = "high_quality"
        dataset.summary_index_setting = {"enable": True}
        sqlite_session.commit()
        repository = SQLAlchemyDocumentRepository(
            session_factory=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
            wake_after_commit=lambda _session: None,
        )
        repository.sync_notion(
            DatasetRef(document.tenant_id, dataset_id).document(document_id),
            generation=_GENERATION,
        )
        sqlite_session.expire_all()
        sync_intent = sqlite_session.scalar(
            select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_sync")
        )
        assert sync_intent is not None
        sync_intent.status = "dispatched"
        sqlite_session.commit()

        sync_notion_document_indexing_task.run(dataset_id, document_id, _GENERATION, sync_intent.id)

        sqlite_session.expire_all()
        persisted = sqlite_session.get(Document, document_id)
        persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
        intents = sqlite_session.scalars(select(KnowledgeTaskOutbox).order_by(KnowledgeTaskOutbox.created_at)).all()
        assert persisted is not None
        assert persisted_segment is not None
        assert persisted.indexing_status == IndexingStatus.COMPLETED
        assert persisted.indexing_generation == _GENERATION
        assert persisted_segment.content == segment.content
        assert [intent.task_kind for intent in intents] == ["document_index_sync", "document_summary_index"]
        assert intents[0].status == "completed"
        assert intents[1].payload["expected_generation"] == _GENERATION
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once()
        mock_notion_extractor["instance"].get_notion_last_edited_time.assert_called_once()

    def test_legacy_notion_sync_converts_once_even_for_completed_document(
        self,
        sqlite_session: Session,
        mock_datasource_provider_service: MagicMock,
        document: Document,
        dataset_id: str,
        document_id: str,
    ) -> None:
        original_generation = document.indexing_generation

        document_indexing_sync_task.run(dataset_id, document_id)
        sqlite_session.expire_all()
        converted = sqlite_session.get(Document, document_id)
        intents = sqlite_session.scalars(select(KnowledgeTaskOutbox)).all()
        assert converted is not None
        assert converted.indexing_status == IndexingStatus.WAITING
        assert converted.indexing_generation != original_generation
        assert len(intents) == 1
        assert intents[0].payload["source"] == "notion"
        replacement_generation = converted.indexing_generation

        document_indexing_sync_task.run(dataset_id, document_id)
        sqlite_session.expire_all()
        converted = sqlite_session.get(Document, document_id)
        assert converted is not None
        assert converted.indexing_generation == replacement_generation
        assert len(sqlite_session.scalars(select(KnowledgeTaskOutbox)).all()) == 1
        mock_datasource_provider_service.get_datasource_credentials.assert_not_called()

    @pytest.mark.parametrize(
        ("task_kind", "intent_document_id", "payload"),
        [
            (
                "document_index_update",
                "document-id",
                {"document_id": "document-id", "generation": _GENERATION},
            ),
            (
                "document_index_retry",
                None,
                {
                    "document_ids": ["document-id"],
                    "generations": {"document-id": _GENERATION},
                    "repair": False,
                },
            ),
        ],
    )
    def test_legacy_notion_delivery_does_not_cancel_current_update_or_retry(
        self,
        sqlite_session: Session,
        mock_datasource_provider_service: MagicMock,
        document: Document,
        dataset_id: str,
        document_id: str,
        task_kind: str,
        intent_document_id: str | None,
        payload: dict[str, object],
    ) -> None:
        payload = json.loads(json.dumps(payload).replace("document-id", document_id))
        document.indexing_status = IndexingStatus.WAITING
        sqlite_session.add(
            KnowledgeTaskOutbox(
                tenant_id=document.tenant_id,
                dataset_id=dataset_id,
                document_id=document_id if intent_document_id is not None else None,
                resource_id=document_id,
                task_kind=task_kind,
                payload=payload,
                status="pending",
            )
        )
        sqlite_session.commit()

        document_indexing_sync_task.run(dataset_id, document_id)

        sqlite_session.expire_all()
        persisted = sqlite_session.get(Document, document_id)
        intents = sqlite_session.scalars(select(KnowledgeTaskOutbox)).all()
        assert persisted is not None
        assert persisted.indexing_generation == _GENERATION
        assert persisted.indexing_status == IndexingStatus.WAITING
        assert [(intent.task_kind, intent.payload) for intent in intents] == [(task_kind, payload)]
        mock_datasource_provider_service.get_datasource_credentials.assert_not_called()

    def test_credential_id_missing_uses_none(
        self,
        mock_datasource_provider_service: MagicMock,
        mock_notion_extractor: ExtractorMocks,
        document: Document,
        sqlite_session: Session,
        dataset_id: str,
        document_id: str,
    ) -> None:
        """Test that missing credential_id is forwarded as None."""
        # Arrange
        document.data_source_info = json.dumps(
            {
                "notion_workspace_id": "workspace-id",
                "notion_page_id": "page-id",
                "type": "page",
                "last_edited_time": "2024-01-01T00:00:00Z",
            }
        )
        sqlite_session.commit()

        # Act
        _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

        # Assert
        mock_datasource_provider_service.get_datasource_credentials.assert_called_once_with(
            tenant_id=document.tenant_id,
            credential_id=None,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )


class TestDataSourceInfoSerialization:
    """Regression test: data_source_info must be written as a JSON string, not a raw dict.

    See https://github.com/langgenius/dify/issues/32705
    psycopg2 raises ``ProgrammingError: can't adapt type 'dict'`` when a Python
    dict is passed directly to a text/LongText column.
    """

    def test_data_source_info_serialized_as_json_string(
        self,
        document: Document,
        sqlite_session: Session,
        dataset_id: str,
        document_id: str,
    ) -> None:
        """data_source_info must be serialized with json.dumps before DB write."""
        with (
            patch("tasks.document_indexing_sync_task.build_data_source_credentials") as mock_service_class,
            patch("tasks.document_indexing_sync_task.NotionExtractor") as mock_extractor_class,
            patch("tasks.document_indexing_sync_task.IndexProcessorFactory") as mock_ipf,
            patch("tasks.document_indexing_sync_task.build_document_indexing_service") as mock_runner_class,
        ):
            # External collaborators
            mock_service = MagicMock()
            mock_service.get_datasource_credentials.return_value = {"integration_secret": "token"}
            mock_service_class.return_value.providers = mock_service

            mock_extractor = MagicMock()
            # Return a *different* timestamp so the task enters the sync/update branch
            mock_extractor.get_notion_last_edited_time.return_value = "2024-02-01T00:00:00Z"
            mock_extractor_class.return_value = mock_extractor

            mock_ip = MagicMock()
            mock_ipf.return_value.init_index_processor.return_value = mock_ip

            mock_runner = MagicMock()
            mock_runner_class.return_value = mock_runner

            # Act
            _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

            # Assert: data_source_info must be a JSON *string*, not a dict
            sqlite_session.expire_all()
            stored_document = sqlite_session.get(Document, document.id)
            assert stored_document is not None
            assert isinstance(stored_document.data_source_info, str), (
                f"data_source_info should be a JSON string, got {type(stored_document.data_source_info).__name__}"
            )
            parsed = json.loads(stored_document.data_source_info)
            assert parsed["last_edited_time"] == "2024-02-01T00:00:00Z"
            assert stored_document.indexing_status == IndexingStatus.PARSING
            assert stored_document.processing_started_at is not None


def test_changed_content_passes_generation_fence_and_uses_stable_lock_order(
    document: Document,
    dataset_id: str,
    document_id: str,
    indexing_lock: RecordingLock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = DataSourceProvider()
    processor = RecordingProcessor()
    indexing_service = RecordingIndexingService()
    _install_changed_content_collaborators(
        monkeypatch,
        provider=provider,
        processor=processor,
        indexing_service=indexing_service,
    )
    generation_assert_event = "assert:generation"
    original_assert_generation = SQLAlchemyDocumentRepository.assert_indexing_generation

    def record_generation_assertion(
        repository: SQLAlchemyDocumentRepository,
        ref: DocumentRef,
        expected_generation: str | None,
    ) -> None:
        indexing_lock.events.append(generation_assert_event)
        original_assert_generation(repository, ref, expected_generation)

    monkeypatch.setattr(
        SQLAlchemyDocumentRepository,
        "assert_indexing_generation",
        record_generation_assertion,
    )

    _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

    assert len(indexing_service.calls) == 1
    refs, executions = indexing_service.calls[0]
    assert len(refs) == 1
    assert refs[0].dataset.tenant_id == document.tenant_id
    assert refs[0].dataset.dataset_id == dataset_id
    assert refs[0].document_id == document_id
    assert executions[document_id].expected_generation == _GENERATION
    assert indexing_lock.events[:2] == [
        f"enter:{dataset_index_lock_name(dataset_id)}",
        f"enter:{document_index_lock_name(document_id)}",
    ]
    first_generation_assertion = indexing_lock.events.index(generation_assert_event)
    assert indexing_lock.events[first_generation_assertion - 2 : first_generation_assertion + 1] == [
        f"assert:{dataset_index_lock_name(dataset_id)}",
        f"assert:{document_index_lock_name(document_id)}",
        generation_assert_event,
    ]


def test_runner_failure_is_fenced_and_persisted_before_indexing_leases_are_released(
    sqlite_session: Session,
    document: Document,
    dataset_id: str,
    document_id: str,
    indexing_lock: RecordingLock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert document.id == document_id
    indexing_service = RecordingIndexingService(error=RuntimeError("provider indexing failed"))
    _install_changed_content_collaborators(
        monkeypatch,
        provider=DataSourceProvider(),
        processor=RecordingProcessor(),
        indexing_service=indexing_service,
    )

    _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document_id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.ERROR
    assert persisted.error == "provider indexing failed"
    assert len(indexing_service.calls) == 1
    document_exit = indexing_lock.events.index(f"exit:{document_index_lock_name(document_id)}")
    assert all(event.startswith("assert:") for event in indexing_lock.events[document_exit - 3 : document_exit])


def test_generation_change_after_vector_cleanup_stops_and_enqueues_current_repair(
    sqlite_session: Session,
    dataset: Dataset,
    document: Document,
    dataset_id: str,
    document_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist_indexed_segment(sqlite_session, dataset=dataset, document=document)
    successor_generation = str(uuid.uuid4())

    def advance_generation() -> None:
        with Session(sqlite_session.get_bind()) as writer, writer.begin():
            persisted = writer.get(Document, document_id)
            assert persisted is not None
            persisted.indexing_generation = successor_generation
            persisted.indexing_status = IndexingStatus.COMPLETED

    processor = RecordingProcessor(callback=advance_generation)
    indexing_service = RecordingIndexingService()
    _install_changed_content_collaborators(
        monkeypatch,
        provider=DataSourceProvider(),
        processor=processor,
        indexing_service=indexing_service,
    )

    _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document_id)
    assert persisted is not None
    assert persisted.indexing_status == IndexingStatus.COMPLETED
    assert processor.clean_calls == 1
    assert indexing_service.calls == []
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_state")
    )
    assert repair is not None
    repair_generation = repair.payload.get("generation")
    assert isinstance(repair_generation, str)
    assert repair_generation != successor_generation
    assert persisted.indexing_generation == repair_generation
    assert repair.payload == {
        "document_id": document_id,
        "generation": repair_generation,
        "action": "add",
    }


def test_document_lease_loss_after_vector_cleanup_enqueues_repair_and_raises(
    sqlite_session: Session,
    dataset: Dataset,
    document: Document,
    dataset_id: str,
    document_id: str,
    indexing_lock: RecordingLock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist_indexed_segment(sqlite_session, dataset=dataset, document=document)

    def lose_document_lease() -> None:
        indexing_lock.leases[document_index_lock_name(document_id)].lost = True

    processor = RecordingProcessor(callback=lose_document_lease)
    indexing_service = RecordingIndexingService()
    _install_changed_content_collaborators(
        monkeypatch,
        provider=DataSourceProvider(),
        processor=processor,
        indexing_service=indexing_service,
    )

    with pytest.raises(KnowledgeIndexingLeaseLostError, match="lease lost"):
        _run_document_indexing_sync_task(dataset_id, document_id, _GENERATION, None)

    sqlite_session.expire_all()
    persisted = sqlite_session.get(Document, document_id)
    assert persisted is not None
    assert processor.clean_calls == 1
    assert indexing_service.calls == []
    repair = sqlite_session.scalar(
        select(KnowledgeTaskOutbox).where(KnowledgeTaskOutbox.task_kind == "document_index_state")
    )
    assert repair is not None
    repair_generation = repair.payload.get("generation")
    assert isinstance(repair_generation, str)
    assert repair_generation != _GENERATION
    assert persisted.indexing_generation == repair_generation
    assert repair.payload == {
        "document_id": document_id,
        "generation": repair_generation,
        "action": "add",
    }

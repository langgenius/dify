import json
import threading
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime
from typing import cast, override
from unittest.mock import MagicMock, create_autospec, patch

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import AttachmentDocument, ChildDocument
from core.rag.models.document import Document as IndexDocument
from enums.creator import CreatorUserRole
from extensions.storage.storage_type import StorageType
from models import Account
from models.dataset import Dataset, DatasetKeywordTable, DatasetProcessRule, Document, DocumentSegment
from models.enums import DataSourceType, IndexingStatus, ProcessRuleMode, SegmentStatus
from models.model import UploadFile
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.data_source.entities.website import WebsiteJobRef
from services.data_source.website_crawl_cache import website_crawl_provider_instance_id
from services.data_source.website_service import WebsiteService
from services.entities.upload_file import CreatedUploadArtifact
from services.extraction.contracts import (
    DatasourceType,
    ExtractedImage,
    ExtractionResult,
    ExtractSetting,
    ImageWriter,
    UploadFileExtractionInput,
)
from services.extraction.images import ExtractionImageWriter
from services.file_service import FileService
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.adapters.execution import IndexingExecutionAdapter
from services.knowledge.indexing.adapters.sources import CompositeStoredSourceResolver, WebsiteSourceAdapter
from services.knowledge.indexing.contracts import IndexingDocument
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.execution import DocumentIndexingService
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document
from tests.unit_tests.services.knowledge.test_indexing_execution import _TestIndexingLock

MODULE = "services.knowledge.indexing.adapters.execution"


class _CommitUnknownSession(Session):
    @override
    def commit(self) -> None:
        super().commit()
        raise RuntimeError("commit result unknown")


class _NoopFileService(FileService):
    def __init__(self) -> None:
        pass

    @override
    def delete_file(self, *, tenant_id: str, file_id: str) -> None:
        del tenant_id, file_id


def _file_extract_setting() -> ExtractSetting:
    return ExtractSetting(
        datasource_type=DatasourceType.FILE,
        upload_file=UploadFileExtractionInput(
            id="source-upload",
            tenant_id="workspace-1",
            key="source/file.pdf",
            created_by="account-1",
        ),
    )


BackendFixture = tuple[
    IndexingExecutionAdapter,
    SQLAlchemyDocumentRepository,
    SQLAlchemySegmentRepository,
    MagicMock,
    IndexingDocument,
    MagicMock,
]


@pytest.fixture
def website_service() -> WebsiteService:
    return create_autospec(WebsiteService, instance=True, spec_set=True)


@pytest.fixture
def backend(sqlite_session_factory: sessionmaker[Session], website_service: WebsiteService) -> Iterator[BackendFixture]:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [_dataset("dataset-1", "workspace-1"), _document("document-1", status=IndexingStatus.SPLITTING)]
        )
    documents = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    segments = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    sources = MagicMock()
    sources.resolve.return_value = ExtractSetting(datasource_type=DatasourceType.WEBSITE)
    adapter = IndexingExecutionAdapter(
        session_factory=sqlite_session_factory,
        documents=documents,
        segments=segments,
        sources=sources,
        files=MagicMock(),
        website=website_service,
    )
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1")
    document = documents.get_indexing_document(ref)
    assert document is not None
    job = replace(document, processing_rule={"mode": "automatic", "rules": {}})
    with patch(f"{MODULE}.redis_client") as redis:
        redis.get.return_value = None
        yield adapter, documents, segments, sources, job, redis


@pytest.fixture
def active_transactions(sqlite_engine: Engine) -> Iterator[set[Connection]]:
    active: set[Connection] = set()

    def begin(connection: Connection) -> None:
        active.add(connection)

    def finish(connection: Connection) -> None:
        active.discard(connection)

    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", finish)
    event.listen(sqlite_engine, "rollback", finish)
    try:
        yield active
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", finish)
        event.remove(sqlite_engine, "rollback", finish)


@pytest.mark.parametrize("doc_form", [IndexStructureType.PARAGRAPH_INDEX, IndexStructureType.PARENT_CHILD_INDEX])
def test_vector_io_releases_transactions_and_preserves_chunk_structure(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    active_transactions: set[Connection],
    doc_form: IndexStructureType,
) -> None:
    adapter, documents, segments, _, job, _ = backend
    upload = UploadFile(
        tenant_id="workspace-1",
        storage_type=StorageType.LOCAL,
        key="image-workspace-1",
        name="image.png",
        size=1,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        used=True,
    )
    with sqlite_session_factory.begin() as session:
        dataset = session.get_one(Dataset, "dataset-1")
        document = session.get_one(Document, "document-1")
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.is_multimodal = True
        document.doc_form = doc_form
        if doc_form == IndexStructureType.PARENT_CHILD_INDEX:
            rule = DatasetProcessRule(
                dataset_id=dataset.id,
                mode=ProcessRuleMode.HIERARCHICAL,
                rules='{"parent_mode": "paragraph"}',
                created_by="account-1",
            )
            rule.id = "hierarchical-rule"
            document.dataset_process_rule_id = rule.id
            session.add(rule)
        session.add(upload)
    indexing_document = replace(job, source=job.source._replace(document_model=doc_form))
    child = ChildDocument(page_content="child", metadata={"doc_id": "child-node", "doc_hash": "child-hash"})
    chunk = IndexDocument(
        page_content="parent",
        metadata={"doc_id": "node", "doc_hash": "hash"},
        children=[child] if doc_form == IndexStructureType.PARENT_CHILD_INDEX else None,
        attachments=[AttachmentDocument(page_content="image", metadata={"doc_id": upload.id, "doc_type": "image"})],
    )
    segments.save_for_indexing(indexing_document, [chunk], [5])
    get_files = cast(MagicMock, adapter._files.get_files)
    get_files.return_value = {upload.id: upload}

    def external_call(*_args: object, **_kwargs: object) -> None:
        assert not active_transactions, "Index I/O must not hold a database transaction"

    vector_backend = MagicMock()
    vector_backend.create.side_effect = external_call
    vector_backend.create_multimodal.side_effect = external_call

    def vector_factory(*_args: object, **_kwargs: object) -> MagicMock:
        external_call()
        return vector_backend

    with Flask(__name__).app_context(), patch(f"{MODULE}.Vector", side_effect=vector_factory) as vector:
        vector.resolve_vector_type.side_effect = lambda *_args, **_kwargs: "qdrant"
        DocumentIndexingService(
            documents=documents,
            segments=segments,
            backend=adapter,
            indexing_locks=_TestIndexingLock(),
        ).run_in_indexing_status(indexing_document.ref)

    indexed_texts = vector_backend.create.call_args.args[0]
    assert [text.metadata["doc_id"] for text in indexed_texts] == [
        "child-node" if doc_form == IndexStructureType.PARENT_CHILD_INDEX else "node"
    ]
    indexed_images = vector_backend.create_multimodal.call_args.args[0]
    assert [image.metadata["doc_id"] for image in indexed_images] == [upload.id]
    assert indexed_images[0].metadata["dataset_id"] == indexing_document.ref.dataset.dataset_id
    assert indexed_images[0].metadata["document_id"] == indexing_document.ref.document_id
    assert vector_backend.create_multimodal.call_args.kwargs == {"upload_file_keys": {upload.id: upload.key}}
    assert segments.resume_indexing(indexing_document) == ([], 5)


@pytest.mark.parametrize("storage_type", ["database", "file"])
def test_keyword_io_releases_transactions_and_commits_before_unlocking(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    active_transactions: set[Connection],
    storage_type: str,
) -> None:
    adapter, _, segments, _, job, redis = backend
    original = json.dumps({"__type__": "keyword_table", "__data__": {"table": {"existing": ["old-node"]}}})
    with sqlite_session_factory.begin() as session:
        session.add(DatasetKeywordTable(dataset_id="dataset-1", data_source_type=storage_type, keyword_table=original))
    chunk = IndexDocument(page_content="hello", metadata={"doc_id": "node", "doc_hash": "hash"})
    segments.save_for_indexing(job, [chunk], [5])
    locked = False

    @contextmanager
    def dataset_lock() -> Generator[None]:
        nonlocal locked
        locked = True
        yield
        assert not active_transactions
        with sqlite_session_factory() as session:
            segment = session.scalar(select(DocumentSegment))
            assert segment is not None
            assert segment.keywords == ["hello"]
        locked = False

    redis.lock.side_effect = lambda *_args, **_kwargs: dataset_lock()

    def external_call(*_args: object, **_kwargs: object) -> None:
        assert locked
        assert not active_transactions, "Keyword I/O must not hold a database transaction"

    with (
        patch("core.rag.datasource.keyword.jieba.jieba.redis_client", redis),
        patch("core.rag.datasource.keyword.jieba.jieba.storage") as storage,
        patch("core.rag.datasource.keyword.jieba.jieba.JiebaKeywordTableHandler") as handler,
    ):
        storage.load_once.side_effect = lambda *_args: (external_call(), original.encode())[1]
        storage.exists.side_effect = lambda *_args: (external_call(), True)[1]
        storage.delete.side_effect = external_call
        storage.save.side_effect = external_call
        handler.return_value.extract_keywords.side_effect = lambda *_args: (external_call(), {"hello"})[1]
        adapter._process_chunk(Flask(__name__), job.ref, [chunk], True)

    assert not locked
    _, encoded = segments.get_keyword_table(job.ref.dataset)
    if storage_type == "file":
        encoded = storage.save.call_args.args[1]
    assert encoded is not None
    assert json.loads(encoded)["__data__"]["table"] == {"existing": ["old-node"], "hello": ["node"]}
    assert segments.resume_indexing(job) == ([], 5)


@pytest.mark.parametrize(
    ("mode", "expected_is_automatic"),
    [("automatic", True), ("hierarchical", True), ("custom", False)],
)
def test_extract_attaches_document_metadata_and_forwards_source_context(
    backend: BackendFixture,
    website_service: WebsiteService,
    mode: str,
    expected_is_automatic: bool,
) -> None:
    adapter, _, _, sources, job, _ = backend
    indexing_job = replace(job, processing_rule={"mode": mode, "rules": {}})
    text = IndexDocument(page_content="source")

    def extract(extract_setting: object, is_automatic: bool, **kwargs: object) -> ExtractionResult[IndexDocument]:
        assert extract_setting is sources.resolve.return_value
        assert is_automatic is expected_is_automatic
        assert kwargs["capture_source_version"] is True
        assert kwargs["image_writer"] is None
        assert kwargs["website_service"] is website_service
        return ExtractionResult(documents=[text])

    with patch(f"{MODULE}.ExtractProcessor.extract", side_effect=extract):
        assert adapter.extract(indexing_job).documents == [text]

    sources.resolve.assert_called_once_with(indexing_job.source)
    assert text.metadata == {"dataset_id": "dataset-1", "document_id": "document-1"}


def test_extract_failure_deletes_only_artifacts_known_not_to_have_entered_commit(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    website_service: WebsiteService,
) -> None:
    _, documents, segments, sources, document, _ = backend
    sources.resolve.return_value = _file_extract_setting()
    files = create_autospec(FileService, instance=True, spec_set=True)
    adapter = IndexingExecutionAdapter(
        session_factory=sqlite_session_factory,
        documents=documents,
        segments=segments,
        sources=sources,
        files=files,
        website=website_service,
    )
    artifacts: list[CreatedUploadArtifact] = []

    def fail_extract(*_args: object, **kwargs: object) -> ExtractionResult[IndexDocument]:
        writer = cast(ExtractionImageWriter | None, kwargs["image_writer"])
        assert writer is not None
        writer.write(ExtractedImage(content=b"image", extension="png", mime_type="image/png"))
        artifacts.extend(writer.created_upload_artifacts)
        raise RuntimeError("extract failed")

    with patch(f"{MODULE}.ExtractProcessor.extract", side_effect=fail_extract), patch(f"{MODULE}.storage.save"):
        with pytest.raises(RuntimeError, match="extract failed"):
            adapter.extract(document)

    [artifact] = artifacts
    files.delete_uncommitted_artifact.assert_called_once_with(artifact=artifact)
    files.delete_file.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, artifact.id) is None


def test_extract_retains_service_owned_image_evidence_after_parser_returns(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    adapter, _, _, sources, document, _ = backend
    sources.resolve.return_value = _file_extract_setting()

    def extract(*_args: object, **kwargs: object) -> ExtractionResult[IndexDocument]:
        writer = cast(ImageWriter | None, kwargs["image_writer"])
        assert writer is not None
        reference = writer.write(ExtractedImage(content=b"image", extension="png", mime_type="image/png"))
        return ExtractionResult(documents=[IndexDocument(page_content=f"![image]({reference.preview_url})")])

    with patch(f"{MODULE}.ExtractProcessor.extract", side_effect=extract), patch(f"{MODULE}.storage.save"):
        result = adapter.extract(document)

    [artifact] = result.created_upload_artifacts
    assert f"/files/{artifact.id}/file-preview" in result.documents[0].page_content
    with sqlite_session_factory() as session:
        upload = session.get(UploadFile, artifact.id)
        assert upload is not None
        assert upload.key == artifact.key


def test_extract_commit_failure_never_deletes_by_uncommitted_blob_key(
    backend: BackendFixture,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
    website_service: WebsiteService,
) -> None:
    _, documents, segments, sources, document, _ = backend
    sources.resolve.return_value = _file_extract_setting()
    session_factory: sessionmaker[Session] = sessionmaker(
        bind=sqlite_engine, class_=_CommitUnknownSession, expire_on_commit=False
    )
    files = create_autospec(FileService, instance=True, spec_set=True)
    adapter = IndexingExecutionAdapter(
        session_factory=session_factory,
        documents=documents,
        segments=segments,
        sources=sources,
        files=files,
        website=website_service,
    )
    artifacts: list[CreatedUploadArtifact] = []

    def extract(*_args: object, **kwargs: object) -> ExtractionResult[IndexDocument]:
        writer = cast(ExtractionImageWriter | None, kwargs["image_writer"])
        assert writer is not None
        writer.write(ExtractedImage(content=b"image", extension="png", mime_type="image/png"))
        artifacts.extend(writer.created_upload_artifacts)
        return ExtractionResult(documents=[IndexDocument(page_content="source")])

    with patch(f"{MODULE}.ExtractProcessor.extract", side_effect=extract), patch(f"{MODULE}.storage.save"):
        with pytest.raises(RuntimeError, match="commit result unknown"):
            adapter.extract(document)

    [artifact] = artifacts
    files.delete_file.assert_called_once_with(tenant_id="workspace-1", file_id=artifact.id)
    files.delete_uncommitted_artifact.assert_not_called()
    with sqlite_session_factory() as session:
        assert session.get(UploadFile, artifact.id) is not None


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (ProviderTokenNotInitError(), "Provider Token Not Init"),
        (ProviderTokenNotInitError("configure an embedding provider"), "configure an embedding provider"),
        (LLMBadRequestError("invalid model input"), "invalid model input"),
        (QuotaExceededError(), "Quota Exceeded"),
        (PluginDaemonClientSideError("plugin unavailable"), "plugin unavailable"),
        (NotFound("source file missing"), "source file missing"),
        (RuntimeError("index unavailable"), "index unavailable"),
    ],
)
def test_indexing_preserves_provider_and_source_error_descriptions(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    error: Exception,
    message: str,
) -> None:
    adapter, documents, segments, sources, job, _ = backend
    sources.resolve.side_effect = error
    with sqlite_session_factory.begin() as session:
        rule = DatasetProcessRule(
            dataset_id=job.ref.dataset.dataset_id,
            mode=ProcessRuleMode.AUTOMATIC,
            rules="{}",
            created_by="account-1",
        )
        session.add(rule)
        session.flush()
        session.get_one(Document, job.ref.document_id).dataset_process_rule_id = rule.id

    DocumentIndexingService(
        documents=documents,
        segments=segments,
        backend=adapter,
        indexing_locks=_TestIndexingLock(),
    ).run([job.ref])

    sources.resolve.assert_called_once()
    with sqlite_session_factory() as session:
        document = session.get_one(Document, job.ref.document_id)
        assert document.indexing_status == IndexingStatus.ERROR
        assert document.error == message
        assert document.completed_at is None


@pytest.mark.parametrize("provider", [None, "embedding-provider"])
def test_transform_selects_embedding_model_and_preserves_processor_options(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    provider: str | None,
) -> None:
    adapter, documents, _, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        dataset = session.get_one(Dataset, "dataset-1")
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.embedding_model_provider = provider
        dataset.embedding_model = "embedding-model"
    with (
        patch.object(documents, "get_indexing_user", return_value=MagicMock()) as user,
        patch(f"{MODULE}.ModelManager.for_tenant") as manager,
        patch(f"{MODULE}.IndexProcessorFactory") as factory,
    ):
        processor = factory.return_value.init_index_processor.return_value
        processor.transform.return_value = list[IndexDocument]()
        adapter.transform(job, [])
        selected = (
            manager.return_value.get_model_instance if provider else manager.return_value.get_default_model_instance
        )
        selected.assert_called_once()
        assert processor.transform.call_args.kwargs["embedding_model_instance"] is selected.return_value
        assert processor.transform.call_args.kwargs["process_rule"] == job.processing_rule
        assert processor.transform.call_args.args == ([], user.return_value)


def test_transform_failure_cleans_uploads_reported_by_the_processor(backend: BackendFixture) -> None:
    adapter, documents, _, _, job, _ = backend
    delete_file = cast(MagicMock, adapter._files.delete_file)
    indexing_user = Account(name="Indexer", email="indexer@example.com")
    indexing_user.id = "account-1"
    with (
        patch.object(documents, "get_indexing_user", return_value=indexing_user),
        patch(f"{MODULE}.IndexProcessorFactory") as factory,
    ):
        processor = factory.return_value.init_index_processor.return_value

        def transform(*_args: object, **kwargs: object) -> list[IndexDocument]:
            callback = cast(Callable[[str], None], kwargs["on_upload_file_created"])
            callback("upload-1")
            raise RuntimeError("transform failed")

        processor.transform.side_effect = transform
        with pytest.raises(RuntimeError, match="transform failed"):
            adapter.transform(job, [])

    delete_file.assert_called_once_with(tenant_id="workspace-1", file_id="upload-1")


def test_hash_groups_load_worker_owned_inputs_before_completion(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    adapter, _, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        session.get_one(Dataset, "dataset-1").indexing_technique = IndexTechniqueType.HIGH_QUALITY
    chunks = [
        IndexDocument(page_content=content, metadata={"doc_id": f"node-{i}", "doc_hash": f"hash-{i}"})
        for i, content in enumerate(["same", "other", "same"])
    ]
    segments.save_for_indexing(job, chunks, [3, 5, 7])
    calls: list[tuple[Dataset, list[str]]] = []
    main_thread = threading.get_ident()

    def vector(dataset: Dataset, *, session: Session | None, vector_type: str) -> MagicMock:
        assert threading.get_ident() != main_thread
        assert inspect(dataset).detached
        assert session is None
        assert vector_type == "qdrant"
        result = MagicMock()
        result.create.side_effect = lambda group: calls.append((dataset, [chunk.page_content for chunk in group]))
        return result

    with Flask(__name__).app_context(), patch(f"{MODULE}.Vector", side_effect=vector) as factory:
        factory.resolve_vector_type.return_value = "qdrant"
        adapter.load(job, chunks)

    assert sum(group.count("same") for _, group in calls) == 2
    assert sum("same" in group for _, group in calls) == 1
    assert len({id(dataset) for dataset, _ in calls}) == len(calls)
    assert segments.resume_indexing(job) == ([], 15)


@pytest.mark.parametrize("technique", [IndexTechniqueType.ECONOMY, IndexTechniqueType.HIGH_QUALITY])
def test_worker_failure_marks_document_error_and_keeps_retryable_segments(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    technique: str,
) -> None:
    adapter, documents, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        session.get_one(Dataset, "dataset-1").indexing_technique = technique
    chunks = [IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})]
    segments.save_for_indexing(job, chunks, [9])
    with (
        Flask(__name__).app_context(),
        patch(f"{MODULE}.Jieba") as keyword,
        patch(f"{MODULE}.Vector") as vector,
    ):
        keyword.return_value.update_texts.side_effect = RuntimeError("worker failed")
        vector.return_value.create.side_effect = RuntimeError("worker failed")
        DocumentIndexingService(
            documents=documents,
            segments=segments,
            backend=adapter,
            indexing_locks=_TestIndexingLock(),
        ).run_in_indexing_status(job.ref)

    with sqlite_session_factory() as session:
        document = session.get_one(Document, job.ref.document_id)
        assert document.indexing_status == IndexingStatus.ERROR
        assert document.error == "worker failed"
    assert len(segments.resume_indexing(job)[0]) == 1


def test_worker_pause_does_not_mark_segments_complete(backend: BackendFixture) -> None:
    adapter, _, segments, _, job, redis = backend
    chunks = [IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})]
    segments.save_for_indexing(job, chunks, [9])
    redis.get.return_value = b"paused"
    with Flask(__name__).app_context(), pytest.raises(DocumentIsPausedError):
        adapter.load(job, chunks)
    assert len(segments.resume_indexing(job)[0]) == 1


@pytest.mark.parametrize("technique", [IndexTechniqueType.ECONOMY, IndexTechniqueType.HIGH_QUALITY])
@pytest.mark.parametrize(
    "doc_form",
    [IndexStructureType.PARAGRAPH_INDEX, IndexStructureType.QA_INDEX, IndexStructureType.PARENT_CHILD_INDEX],
)
def test_full_indexing_commits_phases_through_real_repositories(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    technique: IndexTechniqueType,
    doc_form: IndexStructureType,
) -> None:
    adapter, documents, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        dataset = session.get_one(Dataset, "dataset-1")
        dataset.indexing_technique = technique
        document = session.get_one(Document, "document-1")
        document.doc_form = doc_form
        rule = DatasetProcessRule(
            dataset_id="dataset-1", mode=ProcessRuleMode.AUTOMATIC, rules="{}", created_by="account-1"
        )
        rule.id = "rule-1"
        document.dataset_process_rule_id = rule.id
        session.add(rule)
    chunk = IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})
    with (
        Flask(__name__).app_context(),
        patch.object(documents, "get_indexing_user", return_value=MagicMock()),
        patch(f"{MODULE}.ExtractProcessor.extract", return_value=ExtractionResult(documents=[chunk])),
        patch(f"{MODULE}.IndexProcessorFactory") as factory,
        patch(f"{MODULE}.ModelManager.for_tenant"),
        patch(f"{MODULE}.calculate_segment_token_counts", return_value=[19]),
        patch(f"{MODULE}.Jieba"),
        patch(f"{MODULE}.Vector"),
    ):
        processor = factory.return_value.init_index_processor.return_value
        processor.transform.return_value = [chunk]
        DocumentIndexingService(
            documents=documents,
            segments=segments,
            backend=adapter,
            indexing_locks=_TestIndexingLock(),
        ).run([job.ref])

    with sqlite_session_factory() as session:
        document = session.get_one(Document, "document-1")
        assert document.indexing_status == IndexingStatus.COMPLETED
        assert document.tokens == 19
        assert document.parsing_completed_at is not None
        assert document.splitting_completed_at is not None
        assert document.completed_at is not None


def test_jina_sync_refetches_scrape_source_and_completes_real_pipeline(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _adapter, documents, segments, _sources, job, _redis = backend
    provider_instance_id = website_crawl_provider_instance_id(provider="jinareader")
    with sqlite_session_factory.begin() as session:
        session.get_one(Dataset, "dataset-1").data_source_type = DataSourceType.WEBSITE_CRAWL
        document = session.get_one(Document, "document-1")
        document.data_source_type = DataSourceType.WEBSITE_CRAWL
        document.data_source_info = json.dumps(
            {
                "provider": "jinareader",
                "provider_instance_id": provider_instance_id,
                "job_id": "",
                "url": "https://example.com/current",
                "mode": "scrape",
                "only_main_content": True,
            }
        )
        rule = DatasetProcessRule(
            dataset_id="dataset-1", mode=ProcessRuleMode.AUTOMATIC, rules="{}", created_by="account-1"
        )
        rule.id = "jina-sync-rule"
        document.dataset_process_rule_id = rule.id
        session.add(rule)

    sources = CompositeStoredSourceResolver(adapters={DataSourceType.WEBSITE_CRAWL: WebsiteSourceAdapter()})
    crawl_calls: list[tuple[WebsiteJobRef, str, bool]] = []

    class WebsiteServiceStub:
        @staticmethod
        def get_crawl_url_data_by_ref(job_ref: WebsiteJobRef, url: str, *, use_job: bool) -> dict[str, str]:
            crawl_calls.append((job_ref, url, use_job))
            return {"content": "fresh Jina content", "url": url, "title": "Current page"}

    adapter = IndexingExecutionAdapter(
        session_factory=sqlite_session_factory,
        documents=documents,
        segments=segments,
        sources=sources,
        files=_NoopFileService(),
        website=cast(WebsiteService, WebsiteServiceStub()),
    )

    indexing_user = Account(name="Indexer", email="indexer@example.com")
    indexing_user.id = "account-1"
    monkeypatch.setattr(documents, "get_indexing_user", lambda *_args, **_kwargs: indexing_user)
    service = DocumentIndexingService(
        documents=documents,
        segments=segments,
        backend=adapter,
        indexing_locks=_TestIndexingLock(),
    )
    with (
        Flask(__name__).app_context(),
        patch(f"{MODULE}.calculate_segment_token_counts", return_value=[18]),
        patch(f"{MODULE}.Jieba"),
    ):
        service.run([job.ref])

    assert crawl_calls == [
        (
            WebsiteJobRef(
                tenant_id="workspace-1",
                provider="jinareader",
                provider_instance_id=provider_instance_id,
                job_id="",
            ),
            "https://example.com/current",
            False,
        )
    ]
    with sqlite_session_factory() as session:
        document = session.get_one(Document, "document-1")
        assert document.indexing_status == IndexingStatus.COMPLETED
        assert document.tokens == 18
        segments_in_db = session.scalars(
            select(DocumentSegment).where(DocumentSegment.document_id == document.id)
        ).all()
        assert [segment.content for segment in segments_in_db] == ["fresh Jina content"]


@pytest.mark.parametrize("change", ["paused", "deleted"])
def test_document_changed_during_worker_io_cannot_be_completed(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    change: str,
) -> None:
    adapter, documents, segments, _, job, _ = backend
    chunks = [IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})]
    segments.save_for_indexing(job, chunks, [9])

    def change_document(*_args: object, **_kwargs: object) -> None:
        with sqlite_session_factory.begin() as session:
            document = session.get_one(Document, "document-1")
            if change == "paused":
                document.is_paused = True
            else:
                session.delete(document)

    service = DocumentIndexingService(
        documents=documents,
        segments=segments,
        backend=adapter,
        indexing_locks=_TestIndexingLock(),
    )
    with Flask(__name__).app_context(), patch(f"{MODULE}.Jieba") as keyword:
        keyword.return_value.update_texts.side_effect = change_document
        if change == "paused":
            with pytest.raises(DocumentIsPausedError):
                service.run_in_indexing_status(job.ref)
        else:
            service.run_in_indexing_status(job.ref)

    with sqlite_session_factory() as session:
        segment = session.scalar(select(DocumentSegment))
        assert segment is not None
        assert segment.status == SegmentStatus.INDEXING


def test_partial_worker_failure_retries_only_incomplete_segments_and_keeps_total(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    adapter, documents, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        session.get_one(Dataset, "dataset-1").indexing_technique = IndexTechniqueType.HIGH_QUALITY
    chunks = [
        IndexDocument(page_content=content, metadata={"doc_id": content, "doc_hash": content})
        for content in ["good", "bad"]
    ]
    segments.save_for_indexing(job, chunks, [13, 17])
    service = DocumentIndexingService(
        documents=documents,
        segments=segments,
        backend=adapter,
        indexing_locks=_TestIndexingLock(),
    )

    def load(group: list[IndexDocument]) -> None:
        if group[0].page_content == "bad":
            raise RuntimeError("one shard failed")

    with (
        Flask(__name__).app_context(),
        patch(f"{MODULE}.Vector") as factory,
        patch(f"{MODULE}.helper.generate_text_hash", side_effect=lambda content: "0" if content == "good" else "1"),
    ):
        vector = factory.return_value
        vector.create.side_effect = load
        service.run_in_indexing_status(job.ref)
        pending, tokens = segments.resume_indexing(job)
        assert [chunk.page_content for chunk in pending] == ["bad"]
        assert tokens == 30
        vector.create.reset_mock()
        vector.create.side_effect = None
        service.run_in_indexing_status(job.ref)
        vector.create.assert_called_once()
        assert [chunk.page_content for chunk in vector.create.call_args.args[0]] == ["bad"]

    with sqlite_session_factory() as session:
        document = session.get_one(Document, "document-1")
        assert document.indexing_status == IndexingStatus.COMPLETED
        assert document.tokens == 30
        assert document.error is None

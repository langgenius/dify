from collections.abc import Sequence
from contextlib import nullcontext
from dataclasses import dataclass
from unittest.mock import create_autospec

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.models.document import Document as IndexDocument
from graphon.model_runtime.entities.llm_entities import LLMUsage
from libs.helper import generate_text_hash
from machinery.context import RequestContext
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.knowledge.dataset_access import DatasetAccessService, WorkspaceRoleReader
from services.knowledge.segments import indexing as indexing_module
from services.knowledge.segments.adapters import SegmentPresentationAdapter
from services.knowledge.segments.application import (
    DatasetSegmentApplicationService,
    SegmentBatchImportDispatcher,
    SegmentIndexingState,
    SegmentModelGuard,
)
from services.knowledge.segments.indexing import SegmentIndexingGateway


class _RedisStub:
    def get(self, name: str | bytes) -> object | None:
        del name
        return None

    def set(self, name: str | bytes, value: object, *, nx: bool = False, ex: int | None = None) -> bool:
        del name, value, nx, ex
        return True

    def setex(self, name: str, time: int, value: object) -> bool:
        del name, time, value
        return True

    def lock(self, name: str, timeout: int) -> nullcontext[None]:
        del name, timeout
        return nullcontext()


@dataclass
class _VectorProbe:
    writes: int = 0

    def add_texts(self, documents: Sequence[IndexDocument], **_kwargs: object) -> None:
        self.writes += len(documents)

    def create(self, documents: Sequence[IndexDocument], **kwargs: object) -> None:
        self.add_texts(documents, **kwargs)

    def delete_by_ids(self, _ids: Sequence[str]) -> None:
        return None


class _TokenModel:
    def get_text_embedding_num_tokens(self, texts: Sequence[str]) -> list[int]:
        return [len(text) for text in texts]


class _ModelLookup:
    def get_model_instance(self, **_kwargs: object) -> _TokenModel:
        return _TokenModel()


class _SegmentLimits:
    SINGLE_CHUNK_ATTACHMENT_LIMIT = 10
    DATASET_MAX_SEGMENTS_PER_REQUEST = 1000


def _persist_graph(factory: sessionmaker[Session]) -> None:
    with factory.begin() as session:
        dataset = Dataset(
            id="dataset-1",
            tenant_id="workspace-1",
            name="Dataset",
            description="",
            provider="vendor",
            permission="all_team_members",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            created_by="account-1",
            maintainer="account-1",
            embedding_model_provider="embedding-provider-a",
            embedding_model="embedding-model-a",
            summary_index_setting={
                "enable": True,
                "model_provider_name": "summary-provider-a",
                "model_name": "summary-model-a",
            },
            index_struct='{"type":"qdrant"}',
        )
        document = Document(
            id="document-1",
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info="{}",
            batch="batch-1",
            name="Document",
            created_from=DocumentCreatedFrom.API,
            created_by="account-1",
            indexing_status=IndexingStatus.COMPLETED,
            enabled=True,
            archived=False,
            doc_form="text_model",
            word_count=8,
            indexing_generation="document-generation-a",
        )
        segment = DocumentSegment(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="old text",
            word_count=8,
            tokens=8,
            index_node_id="segment-node-1",
            index_node_hash=generate_text_hash("old text"),
            created_by="account-1",
            enabled=True,
            status=SegmentStatus.COMPLETED,
            indexing_generation="segment-generation-a",
        )
        segment.id = "segment-1"
        summary = DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content="current summary",
            summary_index_node_id="summary-node-1",
            summary_index_node_hash=generate_text_hash("current summary"),
            status=SummaryStatus.COMPLETED,
        )
        session.add_all([dataset, document, segment, summary])


def _application(
    factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> tuple[DatasetSegmentApplicationService, _VectorProbe]:
    probe = _VectorProbe()

    def vector(_dataset: Dataset, *, session: Session | None, vector_type: str) -> _VectorProbe:
        assert session is None
        assert vector_type == "qdrant"
        return probe

    monkeypatch.setattr(indexing_module, "Vector", vector)
    monkeypatch.setattr(ModelManager, "for_tenant", lambda **_kwargs: _ModelLookup())
    datasets = SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=factory,
        wake_after_commit=lambda _session: None,
    )
    segments = SQLAlchemySegmentRepository(session_factory=factory, wake_after_commit=lambda _session: None)
    indexing = SegmentIndexingGateway(
        segments=segments,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=factory),
        redis=_RedisStub(),
        new_session=factory,
    )
    state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    state.is_segment_indexing.return_value = False
    state.is_document_indexing.return_value = False
    state.lock.return_value = nullcontext()
    app = DatasetSegmentApplicationService(
        dataset_access=DatasetAccessService(
            datasets=datasets,
            workspace_roles=create_autospec(WorkspaceRoleReader, instance=True, spec_set=True),
            legacy_permissions_enabled=False,
        ),
        scopes=datasets,
        store=segments,
        presenter=SegmentPresentationAdapter(),
        limits=_SegmentLimits(),
        text_hash=generate_text_hash,
        index=indexing,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=factory),
        model_guard=create_autospec(SegmentModelGuard, instance=True, spec_set=True),
        indexing_state=state,
        batch_dispatcher=create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True),
        job_id_factory=lambda: "job-1",
    )
    return app, probe


@pytest.mark.parametrize(
    "changed_owner",
    ["summary_configuration", "embedding_configuration", "document_generation", "segment_generation"],
)
def test_segment_patch_rejects_summary_generated_for_stale_owner_snapshot(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    changed_owner: str,
) -> None:
    _persist_graph(sqlite_session_factory)
    app, vectors = _application(sqlite_session_factory, monkeypatch)

    def generate(*_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
        with sqlite_session_factory.begin() as session:
            dataset = session.get_one(Dataset, "dataset-1")
            document = session.get_one(Document, "document-1")
            segment = session.get_one(DocumentSegment, "segment-1")
            if changed_owner == "summary_configuration":
                dataset.summary_index_setting = {
                    "enable": True,
                    "model_provider_name": "summary-provider-b",
                    "model_name": "summary-model-b",
                }
            elif changed_owner == "embedding_configuration":
                dataset.embedding_model_provider = "embedding-provider-b"
                dataset.embedding_model = "embedding-model-b"
            elif changed_owner == "document_generation":
                document.indexing_generation = "document-generation-b"
            else:
                segment.indexing_generation = "segment-generation-b"
        return "stale generated summary", LLMUsage.empty_usage()

    monkeypatch.setattr(ParagraphIndexProcessor, "generate_summary_from_inputs", staticmethod(generate))

    updated = app.update_segment(
        RequestContext("request-1", None, "account-1", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        values={"content": "new text"},
    )

    assert updated.data.content == "new text"
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary).where(DocumentSegmentSummary.chunk_id == "segment-1"))
        assert summary is not None
        assert summary.summary_content == "current summary"
        assert summary.summary_index_node_id == "summary-node-1"
        assert summary.status == SummaryStatus.GENERATING
    # The content PATCH updates the segment vector once; the stale summary never reaches vector I/O.
    assert vectors.writes == 1

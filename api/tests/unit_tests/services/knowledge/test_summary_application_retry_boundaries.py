from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus, SummaryStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.summary_checkpoints import (
    SUMMARY_COMPLETED_CHECKPOINT_KEY,
    SUMMARY_GENERATED_CHECKPOINT_KEY,
    parse_summary_checkpoints,
)
from repositories.knowledge.summary_repository import SQLAlchemySummaryRepository
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.summaries.application import (
    SummaryCompletionAckError,
    SummaryIndexService,
    SummaryVectorInput,
    SummaryVectorResult,
    SummaryWriteFence,
    SummaryWriteFenceLostError,
)


@dataclass
class _VectorProbe:
    failures_remaining: int = 0
    write_attempts: int = 0
    successful_writes: list[SummaryVectorResult] = field(default_factory=list)
    deleted_node_ids: list[str] = field(default_factory=list)

    def delete(self, node_id: str) -> None:
        self.deleted_node_ids.append(node_id)

    def count_tokens(self, content: str) -> int:
        assert content == "generated summary"
        return 7

    def write(self, command: SummaryVectorInput, result: SummaryVectorResult) -> None:
        assert command.content == "generated summary"
        self.write_attempts += 1
        if self.failures_remaining:
            self.failures_remaining -= 1
            raise ConnectionError("provider connection lost")
        self.successful_writes.append(result)


def _command_with_durable_checkpoint(
    factory: sessionmaker[Session],
) -> tuple[SummaryVectorInput, SQLAlchemySummaryRepository, str]:
    summary_setting: dict[str, object] = {
        "enable": True,
        "model_name": "summary-model",
        "model_provider_name": "provider",
    }
    with factory.begin() as session:
        dataset = Dataset(
            id="dataset-1",
            tenant_id="tenant-1",
            name="Dataset",
            description="",
            provider="vendor",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            created_by="account-1",
            embedding_model_provider="embedding-provider",
            embedding_model="embedding-model",
            chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
            summary_index_setting=summary_setting,
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
            created_from=DocumentCreatedFrom.WEB,
            created_by="account-1",
            indexing_status="completed",
            indexing_generation="document-generation",
            enabled=True,
            archived=False,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        segment = DocumentSegment(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="source content",
            word_count=2,
            tokens=2,
            created_by="account-1",
            enabled=True,
            status=SegmentStatus.COMPLETED,
            indexing_generation="segment-generation",
        )
        segment.id = "segment-1"
        summary = DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content="generated summary",
            summary_index_node_id="previous-node",
            status=SummaryStatus.GENERATING,
            enabled=True,
        )
        summary.id = "summary-1"
        intent = KnowledgeTaskOutbox(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            resource_id=document.id,
            task_kind="document_summary_index",
            payload={},
            status="executing",
            claim_id="execution-1",
            available_at=naive_utc_now() + timedelta(minutes=10),
        )
        session.add_all([dataset, document, segment, summary, intent])
        session.flush()
        intent_id = intent.id

    command = SummaryVectorInput(
        DatasetRef("tenant-1", "dataset-1").document("document-1").segment("segment-1"),
        "summary-1",
        "generated summary",
        "previous-node",
        SummaryWriteFence(
            expected_document_generation="document-generation",
            enforce_document_generation=True,
            expected_segment_generation="segment-generation",
            enforce_segment_generation=True,
            task_intent_id=intent_id,
            task_execution_id="execution-1",
            expected_indexing_technique=str(IndexTechniqueType.HIGH_QUALITY),
            expected_embedding_model_provider="embedding-provider",
            expected_embedding_model="embedding-model",
            expected_summary_index_setting=summary_setting,
            enforce_summary_index_setting=True,
        ),
    )
    store = SQLAlchemySummaryRepository(new_session=factory)
    store.generated(command)
    return command, store, intent_id


def _service(
    *,
    store: SQLAlchemySummaryRepository,
    vectors: _VectorProbe,
    delays: list[float],
) -> SummaryIndexService:
    return SummaryIndexService(
        store=store,
        vectors=vectors,
        new_id=lambda: "fresh-node",
        text_hash=lambda _content: "content-hash",
        sleep=delays.append,
    )


def test_completed_ack_retries_do_not_repeat_llm_or_vector_provider_success(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    llm_successes = 0

    def generate_summary() -> str:
        nonlocal llm_successes
        llm_successes += 1
        return "generated summary"

    command, store, intent_id = _command_with_durable_checkpoint(sqlite_session_factory)
    assert command.content == generate_summary()
    vectors = _VectorProbe()
    delays: list[float] = []
    ack_attempts = 0

    def fail_first_two_completed_commits(_session: Session) -> None:
        nonlocal ack_attempts
        ack_attempts += 1
        if ack_attempts < 3:
            raise ConnectionError("connection lost before completion commit")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_first_two_completed_commits)
    try:
        result = _service(store=store, vectors=vectors, delays=delays).vectorize(command)
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_first_two_completed_commits)

    assert result.node_id == "fresh-node"
    assert llm_successes == 1
    assert vectors.write_attempts == 1
    assert len(vectors.successful_writes) == 1
    assert ack_attempts == 3
    assert delays == [2.0, 4.0]
    assert vectors.deleted_node_ids == ["previous-node"]
    with sqlite_session_factory() as session:
        summary = session.get_one(DocumentSegmentSummary, "summary-1")
        assert summary.status == SummaryStatus.COMPLETED
        assert summary.summary_index_node_id == "fresh-node"
        intent = session.get_one(KnowledgeTaskOutbox, intent_id)
        assert "segment-1" in parse_summary_checkpoints(intent.payload[SUMMARY_GENERATED_CHECKPOINT_KEY])
        assert "segment-1" in parse_summary_checkpoints(intent.payload[SUMMARY_COMPLETED_CHECKPOINT_KEY])


def test_permanent_completed_ack_failure_preserves_recoverable_generated_checkpoint(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command, store, intent_id = _command_with_durable_checkpoint(sqlite_session_factory)
    vectors = _VectorProbe()
    delays: list[float] = []
    ack_attempts = 0

    def fail_completed_commit(_session: Session) -> None:
        nonlocal ack_attempts
        ack_attempts += 1
        raise ConnectionError("connection lost before completion commit")

    event.listen(sqlite_session_factory.class_, "before_commit", fail_completed_commit)
    try:
        with pytest.raises(SummaryCompletionAckError, match="Failed to persist completed summary vector"):
            _service(store=store, vectors=vectors, delays=delays).vectorize(command)
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_completed_commit)

    assert vectors.write_attempts == 1
    assert len(vectors.successful_writes) == 1
    assert ack_attempts == 3
    assert delays == [2.0, 4.0]
    assert vectors.deleted_node_ids == []
    with sqlite_session_factory() as session:
        summary = session.get_one(DocumentSegmentSummary, "summary-1")
        assert summary.status == SummaryStatus.GENERATING
        assert summary.summary_index_node_id == "previous-node"
        intent = session.get_one(KnowledgeTaskOutbox, intent_id)
        assert intent.status == "executing"
        assert intent.claim_id == "execution-1"
        assert "segment-1" in parse_summary_checkpoints(intent.payload[SUMMARY_GENERATED_CHECKPOINT_KEY])
        assert SUMMARY_COMPLETED_CHECKPOINT_KEY not in intent.payload


def test_transient_provider_failures_keep_the_existing_retry_budget(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command, store, _intent_id = _command_with_durable_checkpoint(sqlite_session_factory)
    vectors = _VectorProbe(failures_remaining=2)
    delays: list[float] = []

    result = _service(store=store, vectors=vectors, delays=delays).vectorize(command)

    assert result.node_id == "fresh-node"
    assert vectors.write_attempts == 3
    assert len(vectors.successful_writes) == 1
    assert delays == [2.0, 4.0]
    assert vectors.deleted_node_ids == ["previous-node"]


def test_definite_completion_fence_rejection_deletes_only_the_fresh_vector(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command, store, _intent_id = _command_with_durable_checkpoint(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        segment = session.get_one(DocumentSegment, "segment-1")
        segment.indexing_generation = "successor-generation"
    vectors = _VectorProbe()

    with pytest.raises(SummaryWriteFenceLostError):
        _service(store=store, vectors=vectors, delays=[]).vectorize(command)

    assert vectors.write_attempts == 1
    assert len(vectors.successful_writes) == 1
    assert vectors.deleted_node_ids == ["fresh-node"]
    with sqlite_session_factory() as session:
        summary = session.get_one(DocumentSegmentSummary, "summary-1")
        assert summary.status == SummaryStatus.GENERATING
        assert summary.summary_index_node_id == "previous-node"

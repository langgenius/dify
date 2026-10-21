from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timedelta
from importlib import import_module
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db.session_factory import session_factory
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.summary_checkpoints import SummaryCheckpointIdentity, summary_content_fingerprint
from repositories.knowledge.summary_repository import SQLAlchemySummaryRepository
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.summaries.application import SummaryVectorInput, SummaryVectorResult, SummaryWriteFence
from services.knowledge.task_outbox.contracts import KnowledgeTaskKind, KnowledgeTaskRequeuedError
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease

summary_task_module = import_module("tasks.regenerate_summary_index_task")
outbox_task_module = import_module("tasks.knowledge_task_outbox_task")


def _checkpoint_identity(
    dataset: Dataset,
    document: Document,
    segment: DocumentSegment,
    summary: DocumentSegmentSummary,
) -> dict[str, object]:
    return SummaryCheckpointIdentity(
        document_id=document.id,
        document_generation=document.indexing_generation,
        segment_generation=segment.indexing_generation,
        indexing_technique=str(dataset.indexing_technique),
        embedding_model_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        summary_index_setting=(
            dict(dataset.summary_index_setting) if dataset.summary_index_setting is not None else None
        ),
        summary_id=summary.id,
        summary_content_fingerprint=summary_content_fingerprint(summary.summary_content or ""),
        vector_node_id=summary.summary_index_node_id,
        vector_content_hash=summary.summary_index_node_hash,
    ).to_payload()


def _recovered_execution() -> KnowledgeTaskExecutionLease:
    return KnowledgeTaskExecutionLease(
        intent_id=None,
        execution_id=None,
        store=None,
        clock=datetime.now,
        lease_seconds=300,
        assert_admitted=None,
        recovered_execution=True,
    )


def test_unversioned_dataset_summary_delivery_converts_before_provider_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repairs: list[tuple[str, str, bool]] = []

    class SummaryRepository:
        def enqueue_current_summary_repair(
            self,
            dataset_id: str,
            *,
            regenerate_reason: str,
            regenerate_vectors_only: bool,
        ) -> bool:
            repairs.append((dataset_id, regenerate_reason, regenerate_vectors_only))
            return True

    monkeypatch.setattr(summary_task_module, "_dataset_repository", SummaryRepository)
    monkeypatch.setattr(
        summary_task_module,
        "_regenerate_summary_index",
        lambda **kwargs: pytest.fail(f"legacy delivery reached summary provider: {kwargs}"),
    )

    summary_task_module.regenerate_summary_index_task.run("dataset-1", "summary_model_changed", False)

    assert repairs == [("dataset-1", "summary_model_changed", False)]


def test_unversioned_dataset_summary_conversion_failure_is_not_acknowledged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingRepository:
        def enqueue_current_summary_repair(self, *_args: object, **_kwargs: object) -> bool:
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(summary_task_module, "_dataset_repository", FailingRepository)

    with pytest.raises(RuntimeError, match="database unavailable"):
        summary_task_module.regenerate_summary_index_task.run("dataset-1")


def test_modern_dataset_summary_delivery_runs_exact_target(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    @contextmanager
    def execution(outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        assert outbox_id == "outbox-1"
        yield KnowledgeTaskExecutionLease.untracked()

    monkeypatch.setattr(summary_task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(
        summary_task_module,
        "_dataset_repository",
        lambda: pytest.fail("modern delivery was treated as legacy"),
    )
    monkeypatch.setattr(summary_task_module, "_run_summary_index_task", lambda **kwargs: calls.append(kwargs))

    summary_task_module.regenerate_summary_index_task.run(
        "dataset-1",
        "embedding_model_changed",
        True,
        "high_quality",
        "provider-1",
        "model-1",
        "outbox-1",
    )

    assert len(calls) == 1
    call = calls[0]
    assert isinstance(call.pop("execution"), KnowledgeTaskExecutionLease)
    assert call == {
        "dataset_id": "dataset-1",
        "regenerate_reason": "embedding_model_changed",
        "regenerate_vectors_only": True,
        "expected_indexing_technique": "high_quality",
        "expected_embedding_model_provider": "provider-1",
        "expected_embedding_model": "model-1",
        "expected_summary_index_setting": None,
    }


def test_partial_summary_retry_reuses_llm_checkpoint_and_skips_completed_segments(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="Summary dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=actor_id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        summary_index_setting={"enable": True, "model": "summary-v2"},
    )
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=actor_id,
        indexing_status=IndexingStatus.COMPLETED,
        indexing_generation=str(uuid4()),
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    document.id = str(uuid4())
    segments = [
        DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=position,
            content=f"content-{position}",
            word_count=1,
            tokens=1,
            created_by=actor_id,
            index_node_id=f"node-{position}",
            index_node_hash=f"hash-{position}",
            status=SegmentStatus.COMPLETED,
            enabled=True,
            indexing_generation=str(uuid4()),
        )
        for position in (1, 2)
    ]
    summaries = [
        DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content=f"old-summary-{segment.position}",
            status=SummaryStatus.COMPLETED,
            enabled=True,
        )
        for segment in segments
    ]
    intent = KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        resource_id=dataset.id,
        task_kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
        payload={},
        status="dispatched",
    )
    sqlite_session.add_all([dataset, document, *segments, *summaries, intent])
    sqlite_session.commit()

    monkeypatch.setattr(outbox_task_module, "wake_knowledge_task_dispatcher", lambda: True)
    llm_calls: list[str] = []
    vector_calls: list[str] = []
    fail_segment_id = segments[1].id
    fail_vector = True

    def generate(
        segment: DocumentSegment,
        _dataset: Dataset,
        _setting: object,
        *,
        session: Session,
    ) -> tuple[str, None]:
        del session
        llm_calls.append(segment.id)
        return f"new-summary-{segment.position}", None

    def vectorize(
        summary: DocumentSegmentSummary,
        segment: DocumentSegment,
        owned_dataset: Dataset,
        session: Session | None = None,
        *,
        fence: SummaryWriteFence | None = None,
        **_kwargs: object,
    ) -> None:
        del session
        nonlocal fail_vector
        vector_calls.append(segment.id)
        if segment.id == fail_segment_id and fail_vector:
            raise RuntimeError("embedding provider unavailable")
        assert fence is not None
        command = SummaryVectorInput(
            DatasetRef(owned_dataset.tenant_id, owned_dataset.id).document(segment.document_id).segment(segment.id),
            summary.id,
            summary.summary_content or "",
            summary.summary_index_node_id,
            fence,
        )
        SQLAlchemySummaryRepository(new_session=session_factory.create_session).completed(
            command,
            SummaryVectorResult(f"summary-node-{segment.position}", f"hash-{segment.position}", 1),
        )

    monkeypatch.setattr(summary_task_module.SummaryIndexAdapter, "generate_summary_for_segment", generate)
    monkeypatch.setattr(summary_task_module.SummaryIndexAdapter, "vectorize_summary", vectorize)

    task_args = (
        dataset.id,
        "summary_model_changed",
        False,
        "high_quality",
        dataset.embedding_model_provider,
        dataset.embedding_model,
        intent.id,
        dict(dataset.summary_index_setting),
    )
    with pytest.raises(KnowledgeTaskRequeuedError):
        summary_task_module.regenerate_summary_index_task.run(*task_args)

    sqlite_session.expire_all()
    persisted = sqlite_session.get_one(KnowledgeTaskOutbox, intent.id)
    persisted_summaries = {
        summary.chunk_id: summary for summary in sqlite_session.scalars(select(DocumentSegmentSummary))
    }
    assert persisted.status == "pending"
    assert persisted.payload["summary_completed_segments"] == {
        segments[0].id: _checkpoint_identity(dataset, document, segments[0], persisted_summaries[segments[0].id])
    }
    assert persisted.payload["summary_generated_segments"] == {
        segments[0].id: _checkpoint_identity(dataset, document, segments[0], persisted_summaries[segments[0].id]),
        segments[1].id: _checkpoint_identity(dataset, document, segments[1], persisted_summaries[segments[1].id]),
    }
    assert (persisted_summaries[segments[0].id].summary_content, persisted_summaries[segments[0].id].status) == (
        "new-summary-1",
        SummaryStatus.COMPLETED,
    )
    assert (persisted_summaries[segments[1].id].summary_content, persisted_summaries[segments[1].id].status) == (
        "new-summary-2",
        SummaryStatus.ERROR,
    )

    persisted.status = "dispatched"
    sqlite_session.commit()
    fail_vector = False
    summary_task_module.regenerate_summary_index_task.run(*task_args)

    sqlite_session.expire_all()
    assert sqlite_session.get_one(KnowledgeTaskOutbox, intent.id).status == "completed"
    assert llm_calls == [segments[0].id, segments[1].id]
    assert vector_calls == [segments[0].id, segments[1].id, segments[1].id]
    assert {summary.status for summary in sqlite_session.scalars(select(DocumentSegmentSummary))} == {
        SummaryStatus.COMPLETED
    }


def test_summary_regeneration_has_no_dataset_aggregate_lock() -> None:
    assert not hasattr(summary_task_module, "RedisKnowledgeIndexingLock")


def test_recovered_dataset_summary_execution_persists_current_successor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repairs: list[tuple[str, str, bool, str | None]] = []

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield _recovered_execution()

    def record_repair(
        *,
        dataset_id: str,
        regenerate_reason: str,
        regenerate_vectors_only: bool,
        checkpoint_source_intent_id: str | None = None,
    ) -> None:
        repairs.append((dataset_id, regenerate_reason, regenerate_vectors_only, checkpoint_source_intent_id))

    monkeypatch.setattr(summary_task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(summary_task_module, "_enqueue_current_summary_repair", record_repair)
    monkeypatch.setattr(
        summary_task_module,
        "_run_summary_index_task",
        lambda **kwargs: pytest.fail(f"recovered execution reached summary provider: {kwargs}"),
    )

    summary_task_module.regenerate_summary_index_task.run(
        "dataset-1",
        "embedding_model_changed",
        True,
        "high_quality",
        "provider-1",
        "model-1",
        "outbox-1",
    )

    assert repairs == [("dataset-1", "embedding_model_changed", True, "outbox-1")]


def test_expired_summary_takeover_successor_inherits_matching_checkpoints(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    dataset = Dataset(
        tenant_id=tenant_id,
        name="Summary dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=actor_id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        embedding_model_provider="provider-1",
        embedding_model="embedding-model-1",
        summary_index_setting={"enable": True, "model": "summary-model-a"},
    )
    document = Document(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=actor_id,
        indexing_status=IndexingStatus.COMPLETED,
        indexing_generation=str(uuid4()),
        enabled=True,
        archived=False,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    document.id = str(uuid4())
    segments = [
        DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=position,
            content=f"content-{position}",
            word_count=1,
            tokens=1,
            created_by=actor_id,
            index_node_id=f"node-{position}",
            index_node_hash=f"hash-{position}",
            status=SegmentStatus.COMPLETED,
            enabled=True,
            indexing_generation=str(uuid4()),
        )
        for position in (1, 2)
    ]
    summaries = [
        DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content=f"new-summary-{segment.position}",
            summary_index_node_id=f"summary-node-{segment.position}" if segment.position == 1 else None,
            summary_index_node_hash=f"summary-hash-{segment.position}" if segment.position == 1 else None,
            status=SummaryStatus.COMPLETED if segment.position == 1 else SummaryStatus.ERROR,
            enabled=True,
        )
        for segment in segments
    ]
    checkpoint_payload = {
        "summary_generated_segments": {
            segment.id: _checkpoint_identity(dataset, document, segment, summary)
            for segment, summary in zip(segments, summaries, strict=True)
        },
        "summary_completed_segments": {
            segments[0].id: _checkpoint_identity(dataset, document, segments[0], summaries[0])
        },
    }
    source = KnowledgeTaskOutbox(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        resource_id=dataset.id,
        task_kind=KnowledgeTaskKind.DATASET_SUMMARY_INDEX_REGENERATE.value,
        payload={
            "tenant_id": tenant_id,
            "dataset_id": dataset.id,
            "regenerate_reason": "summary_model_changed",
            "regenerate_vectors_only": False,
            "expected_indexing_technique": "high_quality",
            "expected_embedding_model_provider": "provider-1",
            "expected_embedding_model": "embedding-model-1",
            "expected_summary_index_setting": dict(dataset.summary_index_setting),
            **checkpoint_payload,
        },
        status="executing",
        claim_id="dead-execution",
        claimed_at=naive_utc_now() - timedelta(minutes=2),
        available_at=naive_utc_now() - timedelta(minutes=1),
        execution_attempts=1,
    )
    sqlite_session.add_all([dataset, document, *segments, *summaries, source])
    sqlite_session.commit()

    monkeypatch.setattr(outbox_task_module, "wake_knowledge_task_dispatcher", lambda: True)
    monkeypatch.setattr(summary_task_module, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)
    summary_task_module.regenerate_summary_index_task.run(
        dataset.id,
        "summary_model_changed",
        False,
        "high_quality",
        "provider-1",
        "embedding-model-1",
        source.id,
        dict(dataset.summary_index_setting),
    )

    sqlite_session.expire_all()
    intents = sqlite_session.scalars(
        select(KnowledgeTaskOutbox)
        .where(KnowledgeTaskOutbox.dataset_id == dataset.id)
        .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
    ).all()
    assert len(intents) == 2
    persisted_source = next(intent for intent in intents if intent.id == source.id)
    successor = next(intent for intent in intents if intent.id != source.id)
    assert persisted_source.status == "completed"
    assert successor.status == "pending"
    assert successor.payload["recovery_source_intent_id"] == source.id
    assert successor.payload["summary_generated_segments"] == checkpoint_payload["summary_generated_segments"]
    assert successor.payload["summary_completed_segments"] == checkpoint_payload["summary_completed_segments"]

    llm_calls: list[str] = []
    vector_calls: list[str] = []
    monkeypatch.setattr(
        summary_task_module.SummaryIndexAdapter,
        "generate_summary_for_segment",
        lambda segment, *_args, **_kwargs: llm_calls.append(segment.id) or ("unexpected", None),
    )

    def vectorize(
        summary: DocumentSegmentSummary,
        segment: DocumentSegment,
        owned_dataset: Dataset,
        session: Session | None = None,
        *,
        fence: SummaryWriteFence | None = None,
        **_kwargs: object,
    ) -> None:
        del session
        assert fence is not None
        vector_calls.append(segment.id)
        command = SummaryVectorInput(
            DatasetRef(owned_dataset.tenant_id, owned_dataset.id).document(segment.document_id).segment(segment.id),
            summary.id,
            summary.summary_content or "",
            summary.summary_index_node_id,
            fence,
        )
        SQLAlchemySummaryRepository(new_session=session_factory.create_session).completed(
            command,
            SummaryVectorResult("summary-node-2", "summary-hash-2", 1),
        )

    monkeypatch.setattr(summary_task_module.SummaryIndexAdapter, "vectorize_summary", vectorize)
    successor.status = "dispatched"
    sqlite_session.commit()
    summary_task_module.regenerate_summary_index_task.run(
        dataset.id,
        "summary_model_changed",
        False,
        "high_quality",
        "provider-1",
        "embedding-model-1",
        successor.id,
        dict(dataset.summary_index_setting),
    )

    sqlite_session.expire_all()
    assert sqlite_session.get_one(KnowledgeTaskOutbox, successor.id).status == "completed"
    assert llm_calls == []
    assert vector_calls == [segments[1].id]


def test_stale_summary_redelivery_schedules_current_state_repair(monkeypatch: pytest.MonkeyPatch) -> None:
    repairs: list[tuple[str, str, bool]] = []
    monkeypatch.setattr(summary_task_module, "_regenerate_summary_index", lambda **_kwargs: False)

    def record_repair(*, dataset_id: str, regenerate_reason: str, regenerate_vectors_only: bool) -> None:
        repairs.append((dataset_id, regenerate_reason, regenerate_vectors_only))

    monkeypatch.setattr(summary_task_module, "_enqueue_current_summary_repair", record_repair)

    summary_task_module.regenerate_summary_index_task.run(
        "dataset-1",
        "embedding_model_changed",
        True,
        "high_quality",
        "provider-1",
        "model-1",
    )

    assert repairs == [("dataset-1", "embedding_model_changed", True)]

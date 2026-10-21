from collections.abc import Generator
from contextlib import contextmanager
from datetime import datetime, timedelta
from importlib import import_module
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from libs.datetime_utils import naive_utc_now
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.summary_checkpoints import SummaryCheckpointIdentity, summary_content_fingerprint
from repositories.knowledge.summary_repository import SQLAlchemySummaryRepository
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.summaries.application import SummaryVectorInput, SummaryVectorResult, SummaryWriteFence
from services.knowledge.task_outbox.contracts import (
    KnowledgeTaskExecutionLeaseLostError,
    KnowledgeTaskKind,
    KnowledgeTaskRequeuedError,
)
from services.knowledge.task_outbox.execution import KnowledgeTaskExecutionLease

task_module = import_module("tasks.generate_summary_index_task")
outbox_task_module = import_module("tasks.knowledge_task_outbox_task")

SQLITE_MODELS = (Dataset, Document, DocumentSegment, DocumentSegmentSummary, KnowledgeTaskOutbox)
pytestmark = pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)


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


def _persist_document(session: Session) -> tuple[Dataset, Document, DocumentSegment]:
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
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
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
        need_summary=True,
    )
    document.id = str(uuid4())
    segment = DocumentSegment(
        tenant_id=tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="segment content",
        word_count=2,
        tokens=2,
        created_by=actor_id,
        index_node_id="node-1",
        index_node_hash="hash-1",
        status=SegmentStatus.COMPLETED,
        enabled=True,
    )
    session.add_all([dataset, document, segment])
    session.commit()
    return dataset, document, segment


def _summary_configuration(dataset: Dataset) -> tuple[str, str | None, str | None, dict[str, object] | None]:
    return (
        str(dataset.indexing_technique),
        dataset.embedding_model_provider,
        dataset.embedding_model,
        dict(dataset.summary_index_setting) if dataset.summary_index_setting is not None else None,
    )


@pytest.fixture
def bound_task_runtime(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    engine = sqlite_session.get_bind()
    task_session_factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        task_session_factory,
    )
    monkeypatch.setattr(task_module.session_factory, "get_session_maker", lambda: task_session_factory)
    monkeypatch.setattr(task_module, "wake_knowledge_task_dispatcher_after_commit", lambda _session: None)
    monkeypatch.setattr(outbox_task_module, "wake_knowledge_task_dispatcher", lambda: True)


@pytest.mark.usefixtures("bound_task_runtime")
def test_legacy_three_argument_delivery_persists_current_intent_before_provider_io(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "generate_summaries_for_document",
        lambda **kwargs: pytest.fail(f"legacy delivery reached summary provider: {kwargs}"),
    )

    task_module.generate_summary_index_task.run(dataset.id, document.id, [segment.id])

    sqlite_session.expire_all()
    intents = sqlite_session.query(KnowledgeTaskOutbox).all()
    assert len(intents) == 1
    assert intents[0].status == "pending"
    assert intents[0].payload == {
        "tenant_id": dataset.tenant_id,
        "dataset_id": dataset.id,
        "document_id": document.id,
        "expected_generation": document.indexing_generation,
        "segment_ids": None,
        "expected_indexing_technique": "high_quality",
        "expected_embedding_model_provider": "provider-1",
        "expected_embedding_model": "embedding-model-1",
        "expected_summary_index_setting": {"enable": True, "model": "summary-model-a"},
    }


def test_legacy_document_summary_conversion_failure_is_not_acknowledged(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del sqlite_session
    monkeypatch.setattr(
        task_module,
        "_enqueue_current_document_summary_repair",
        lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("database unavailable")),
    )
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "generate_summaries_for_document",
        lambda **kwargs: pytest.fail(f"failed conversion reached summary provider: {kwargs}"),
    )

    with pytest.raises(RuntimeError, match="database unavailable"):
        task_module.generate_summary_index_task.run("dataset-1", "document-1", ["segment-1"])


def test_recovered_document_summary_execution_persists_current_successor(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del sqlite_session
    repairs: list[tuple[str, str, str | None]] = []

    @contextmanager
    def execution(_outbox_id: str) -> Generator[KnowledgeTaskExecutionLease]:
        yield _recovered_execution()

    monkeypatch.setattr(task_module, "knowledge_task_execution", execution)
    monkeypatch.setattr(
        task_module,
        "_enqueue_current_document_summary_repair",
        lambda *, dataset_id, document_id, checkpoint_source_intent_id=None: (
            repairs.append((dataset_id, document_id, checkpoint_source_intent_id)) or 1
        ),
    )
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "generate_summaries_for_document",
        lambda **kwargs: pytest.fail(f"recovered execution reached summary provider: {kwargs}"),
    )

    task_module.generate_summary_index_task.run(
        "dataset-1",
        "document-1",
        ["segment-1"],
        "outbox-1",
        "stale-generation",
        False,
        "high_quality",
        "provider-1",
        "embedding-model-1",
        {"enable": True, "model": "summary-model-a"},
    )

    assert repairs == [("dataset-1", "document-1", "outbox-1")]


@pytest.mark.usefixtures("bound_task_runtime")
def test_expired_document_summary_takeover_reuses_generated_checkpoint(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="already billed summary",
        status=SummaryStatus.ERROR,
        enabled=True,
    )
    summary.id = str(uuid4())
    checkpoint = SummaryCheckpointIdentity(
        document_id=document.id,
        document_generation=document.indexing_generation,
        segment_generation=segment.indexing_generation,
        indexing_technique=str(dataset.indexing_technique),
        embedding_model_provider=dataset.embedding_model_provider,
        embedding_model=dataset.embedding_model,
        summary_index_setting=dict(dataset.summary_index_setting),
        summary_id=summary.id,
        summary_content_fingerprint=summary_content_fingerprint(summary.summary_content or ""),
    ).to_payload()
    source = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={
            "tenant_id": dataset.tenant_id,
            "dataset_id": dataset.id,
            "document_id": document.id,
            "expected_generation": document.indexing_generation,
            "segment_ids": None,
            "expected_indexing_technique": str(dataset.indexing_technique),
            "expected_embedding_model_provider": dataset.embedding_model_provider,
            "expected_embedding_model": dataset.embedding_model,
            "expected_summary_index_setting": dict(dataset.summary_index_setting),
            "summary_generated_segments": {segment.id: checkpoint},
        },
        status="executing",
        claim_id="dead-execution",
        claimed_at=naive_utc_now() - timedelta(minutes=2),
        available_at=naive_utc_now() - timedelta(minutes=1),
        execution_attempts=1,
    )
    sqlite_session.add_all([summary, source])
    sqlite_session.commit()

    task_module.generate_summary_index_task.run(
        dataset.id,
        document.id,
        None,
        source.id,
        document.indexing_generation,
        False,
        *_summary_configuration(dataset),
    )

    sqlite_session.expire_all()
    intents = sqlite_session.scalars(
        select(KnowledgeTaskOutbox)
        .where(KnowledgeTaskOutbox.document_id == document.id)
        .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
    ).all()
    assert len(intents) == 2
    persisted_source = next(intent for intent in intents if intent.id == source.id)
    successor = next(intent for intent in intents if intent.id != source.id)
    assert persisted_source.status == "completed"
    assert successor.status == "pending"
    assert successor.payload["recovery_source_intent_id"] == source.id
    assert successor.payload["summary_generated_segments"] == {segment.id: checkpoint}

    llm_calls: list[str] = []
    vector_calls: list[str] = []
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "generate_summary_for_segment",
        lambda owned_segment, *_args, **_kwargs: llm_calls.append(owned_segment.id) or ("unexpected", None),
    )

    def vectorize(
        owned_summary: DocumentSegmentSummary,
        owned_segment: DocumentSegment,
        owned_dataset: Dataset,
        session: Session | None = None,
        *,
        fence: SummaryWriteFence | None = None,
        **_kwargs: object,
    ) -> None:
        del session
        assert fence is not None
        vector_calls.append(owned_segment.id)
        command = SummaryVectorInput(
            DatasetRef(owned_dataset.tenant_id, owned_dataset.id)
            .document(owned_segment.document_id)
            .segment(owned_segment.id),
            owned_summary.id,
            owned_summary.summary_content or "",
            owned_summary.summary_index_node_id,
            fence,
        )
        SQLAlchemySummaryRepository(new_session=task_module.session_factory.create_session).completed(
            command,
            SummaryVectorResult("summary-node-1", "summary-hash-1", 1),
        )

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "vectorize_summary", vectorize)
    successor.status = "dispatched"
    sqlite_session.commit()
    task_module.generate_summary_index_task.run(
        dataset.id,
        document.id,
        None,
        successor.id,
        document.indexing_generation,
        False,
        *_summary_configuration(dataset),
    )

    sqlite_session.expire_all()
    assert sqlite_session.get_one(KnowledgeTaskOutbox, successor.id).status == "completed"
    assert llm_calls == []
    assert vector_calls == [segment.id]


@pytest.mark.usefixtures("bound_task_runtime")
def test_a_checkpoint_is_not_reused_after_model_b_overwrites_the_shared_summary(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    segment.indexing_generation = str(uuid4())
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="model B summary",
        summary_index_node_id="model-b-node",
        summary_index_node_hash="model-b-hash",
        status=SummaryStatus.COMPLETED,
        enabled=True,
    )
    summary.id = str(uuid4())
    checkpoint = SummaryCheckpointIdentity(
        document_id=document.id,
        document_generation=document.indexing_generation,
        segment_generation=segment.indexing_generation,
        indexing_technique="high_quality",
        embedding_model_provider="provider-1",
        embedding_model="embedding-model-1",
        summary_index_setting={"enable": True, "model": "summary-model-a"},
        summary_id=summary.id,
        summary_content_fingerprint=summary_content_fingerprint("model A summary"),
        vector_node_id="model-a-node",
        vector_content_hash="model-a-hash",
    ).to_payload()
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={
            "summary_generated_segments": {segment.id: checkpoint},
            "summary_completed_segments": {segment.id: checkpoint},
        },
        status="dispatched",
    )
    sqlite_session.add_all([summary, intent])
    sqlite_session.commit()

    llm_calls: list[str] = []
    vector_calls: list[str] = []
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "generate_summary_for_segment",
        lambda owned_segment, *_args, **_kwargs: (
            llm_calls.append(owned_segment.id) or "fresh model A summary",
            None,
        ),
    )

    def vectorize(
        owned_summary: DocumentSegmentSummary,
        owned_segment: DocumentSegment,
        owned_dataset: Dataset,
        session: Session | None = None,
        *,
        fence: SummaryWriteFence | None = None,
        **_kwargs: object,
    ) -> None:
        del session
        assert fence is not None
        vector_calls.append(owned_segment.id)
        command = SummaryVectorInput(
            DatasetRef(owned_dataset.tenant_id, owned_dataset.id)
            .document(owned_segment.document_id)
            .segment(owned_segment.id),
            owned_summary.id,
            owned_summary.summary_content or "",
            owned_summary.summary_index_node_id,
            fence,
        )
        SQLAlchemySummaryRepository(new_session=task_module.session_factory.create_session).completed(
            command,
            SummaryVectorResult("fresh-model-a-node", "fresh-model-a-hash", 1),
        )

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "vectorize_summary", vectorize)
    task_module.generate_summary_index_task.run(
        dataset.id,
        document.id,
        [segment.id],
        intent.id,
        document.indexing_generation,
        False,
        *_summary_configuration(dataset),
    )

    sqlite_session.expire_all()
    persisted_summary = sqlite_session.get_one(DocumentSegmentSummary, summary.id)
    assert sqlite_session.get_one(KnowledgeTaskOutbox, intent.id).status == "completed"
    assert llm_calls == [segment.id]
    assert vector_calls == [segment.id]
    assert persisted_summary.summary_content == "fresh model A summary"
    assert persisted_summary.summary_index_node_id == "fresh-model-a-node"


@pytest.mark.usefixtures("bound_task_runtime")
def test_stale_document_generation_completes_without_invoking_summary_adapter(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset, document, _ = _persist_document(sqlite_session)

    def unexpected_generation(**kwargs: object) -> list[object]:
        raise AssertionError(f"stale generation reached summary adapter: {kwargs}")

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summaries_for_document", unexpected_generation)

    task_module.generate_summary_index_task.run(dataset.id, document.id, None, None, str(uuid4()))


@pytest.mark.usefixtures("bound_task_runtime")
def test_explicit_null_generation_does_not_run_after_a_successor_generation_started(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset, document, _ = _persist_document(sqlite_session)

    def unexpected_generation(**kwargs: object) -> list[object]:
        raise AssertionError(f"superseded null generation reached summary adapter: {kwargs}")

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summaries_for_document", unexpected_generation)

    task_module.generate_summary_index_task.run(
        dataset.id,
        document.id,
        expected_generation=None,
        enforce_generation=True,
    )


@pytest.mark.usefixtures("bound_task_runtime")
def test_tracked_null_generation_does_not_run_after_a_successor_generation_started(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset, document, _ = _persist_document(sqlite_session)
    document.indexing_generation = None
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={"expected_generation": None},
        status="dispatched",
    )
    sqlite_session.add(intent)
    sqlite_session.commit()
    document.indexing_generation = str(uuid4())
    sqlite_session.commit()

    def unexpected_generation(**kwargs: object) -> list[object]:
        raise AssertionError(f"superseded null generation reached summary adapter: {kwargs}")

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summaries_for_document", unexpected_generation)

    task_module.generate_summary_index_task.run(
        dataset.id,
        document.id,
        None,
        intent.id,
        None,
        False,
        *_summary_configuration(dataset),
    )

    sqlite_session.expire_all()
    persisted_intent = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    assert persisted_intent is not None
    assert persisted_intent.status == "completed"


@pytest.mark.usefixtures("bound_task_runtime")
def test_tracked_partial_failure_is_requeued_without_leaving_a_segment_error(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={},
        status="dispatched",
    )
    sqlite_session.add(intent)
    sqlite_session.commit()

    def leave_failed_summary(**_kwargs: object) -> list[object]:
        with task_module.session_factory.create_session() as session, session.begin():
            session.add(
                DocumentSegmentSummary(
                    dataset_id=dataset.id,
                    document_id=document.id,
                    chunk_id=segment.id,
                    status=SummaryStatus.ERROR,
                    error="summary provider unavailable",
                    enabled=True,
                )
            )
        return []

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summaries_for_document", leave_failed_summary)

    with pytest.raises(KnowledgeTaskRequeuedError):
        task_module.generate_summary_index_task.run(
            dataset.id,
            document.id,
            [segment.id],
            intent.id,
            document.indexing_generation,
            False,
            *_summary_configuration(dataset),
        )

    sqlite_session.expire_all()
    persisted_intent = sqlite_session.get(KnowledgeTaskOutbox, intent.id)
    persisted_segment = sqlite_session.get(DocumentSegment, segment.id)
    assert persisted_intent is not None
    assert persisted_intent.status == "pending"
    assert persisted_segment is not None
    assert persisted_segment.error is None


def test_document_summary_generation_has_no_dataset_aggregate_lock(sqlite_session: Session) -> None:
    del sqlite_session
    assert not hasattr(task_module, "RedisKnowledgeIndexingLock")


@pytest.mark.usefixtures("bound_task_runtime")
@pytest.mark.parametrize("changed_resource", ["document", "segment"])
def test_generation_change_during_llm_prevents_stale_summary_commit(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    changed_resource: str,
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    segment.indexing_generation = str(uuid4())
    expected_document_generation = document.indexing_generation
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={},
        status="dispatched",
    )
    sqlite_session.add(intent)
    sqlite_session.commit()

    def change_generation(
        _segment: DocumentSegment,
        _dataset: Dataset,
        _setting: object,
        *,
        session: Session,
    ) -> tuple[str, None]:
        del session
        with task_module.session_factory.create_session() as write_session, write_session.begin():
            if changed_resource == "document":
                write_session.get_one(Document, document.id).indexing_generation = str(uuid4())
            else:
                write_session.get_one(DocumentSegment, segment.id).indexing_generation = str(uuid4())
        return "stale generated summary", None

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", change_generation)
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "vectorize_summary",
        lambda *_args, **_kwargs: pytest.fail("stale LLM output reached embedding provider"),
    )

    with pytest.raises(KnowledgeTaskRequeuedError):
        task_module.generate_summary_index_task.run(
            dataset.id,
            document.id,
            [segment.id],
            intent.id,
            expected_document_generation,
            False,
            *_summary_configuration(dataset),
        )

    sqlite_session.expire_all()
    persisted_intent = sqlite_session.get_one(KnowledgeTaskOutbox, intent.id)
    summary = sqlite_session.scalar(select(DocumentSegmentSummary).where(DocumentSegmentSummary.chunk_id == segment.id))
    assert persisted_intent.status == "pending"
    assert summary is not None
    assert summary.summary_content in {None, ""}


@pytest.mark.usefixtures("bound_task_runtime")
@pytest.mark.parametrize("changed_configuration", ["summary_model", "embedding_provider", "embedding_model"])
def test_model_configuration_change_during_llm_prevents_stale_summary_and_checkpoint(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    changed_configuration: str,
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    segment.indexing_generation = str(uuid4())
    expected_configuration = _summary_configuration(dataset)
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={},
        status="dispatched",
    )
    sqlite_session.add(intent)
    sqlite_session.commit()

    def change_configuration(
        _segment: DocumentSegment,
        _dataset: Dataset,
        _setting: object,
        *,
        session: Session,
    ) -> tuple[str, None]:
        del session
        with task_module.session_factory.create_session() as write_session, write_session.begin():
            persisted = write_session.get_one(Dataset, dataset.id)
            if changed_configuration == "summary_model":
                persisted.summary_index_setting = {"enable": True, "model": "summary-model-b"}
            elif changed_configuration == "embedding_provider":
                persisted.embedding_model_provider = "provider-2"
            else:
                persisted.embedding_model = "embedding-model-2"
        return "summary generated with stale configuration", None

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", change_configuration)
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "vectorize_summary",
        lambda *_args, **_kwargs: pytest.fail("stale summary reached the embedding provider"),
    )

    with pytest.raises(KnowledgeTaskRequeuedError):
        task_module.generate_summary_index_task.run(
            dataset.id,
            document.id,
            [segment.id],
            intent.id,
            document.indexing_generation,
            False,
            *expected_configuration,
        )

    sqlite_session.expire_all()
    persisted_intent = sqlite_session.get_one(KnowledgeTaskOutbox, intent.id)
    summary = sqlite_session.scalar(select(DocumentSegmentSummary).where(DocumentSegmentSummary.chunk_id == segment.id))
    assert persisted_intent.status == "pending"
    assert "summary_generated_segments" not in persisted_intent.payload
    assert "summary_completed_segments" not in persisted_intent.payload
    assert summary is not None
    assert summary.summary_content in {None, ""}


@pytest.mark.usefixtures("bound_task_runtime")
def test_summary_model_change_after_generation_keeps_checkpoint_but_fences_vector_commit(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    segment.indexing_generation = str(uuid4())
    expected_configuration = _summary_configuration(dataset)
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={},
        status="dispatched",
    )
    sqlite_session.add(intent)
    sqlite_session.commit()

    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "generate_summary_for_segment",
        lambda *_args, **_kwargs: ("summary generated with model A", None),
    )

    def change_model_before_vector_commit(
        summary: DocumentSegmentSummary,
        owned_segment: DocumentSegment,
        owned_dataset: Dataset,
        session: Session | None = None,
        *,
        fence: SummaryWriteFence | None = None,
        **_kwargs: object,
    ) -> None:
        del session
        assert fence is not None
        with task_module.session_factory.create_session() as write_session, write_session.begin():
            write_session.get_one(Dataset, owned_dataset.id).summary_index_setting = {
                "enable": True,
                "model": "summary-model-b",
            }
        command = SummaryVectorInput(
            DatasetRef(owned_dataset.tenant_id, owned_dataset.id)
            .document(owned_segment.document_id)
            .segment(owned_segment.id),
            summary.id,
            summary.summary_content or "",
            summary.summary_index_node_id,
            fence,
        )
        SQLAlchemySummaryRepository(new_session=task_module.session_factory.create_session).assert_current(command)

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "vectorize_summary", change_model_before_vector_commit)

    with pytest.raises(KnowledgeTaskRequeuedError):
        task_module.generate_summary_index_task.run(
            dataset.id,
            document.id,
            [segment.id],
            intent.id,
            document.indexing_generation,
            False,
            *expected_configuration,
        )

    sqlite_session.expire_all()
    persisted_intent = sqlite_session.get_one(KnowledgeTaskOutbox, intent.id)
    persisted_summary = sqlite_session.scalar(
        select(DocumentSegmentSummary).where(DocumentSegmentSummary.chunk_id == segment.id)
    )
    checkpoint = SummaryCheckpointIdentity(
        document_id=document.id,
        document_generation=document.indexing_generation,
        segment_generation=segment.indexing_generation,
        indexing_technique="high_quality",
        embedding_model_provider="provider-1",
        embedding_model="embedding-model-1",
        summary_index_setting={"enable": True, "model": "summary-model-a"},
        summary_id=persisted_summary.id if persisted_summary is not None else None,
        summary_content_fingerprint=summary_content_fingerprint("summary generated with model A"),
    ).to_payload()
    assert persisted_intent.status == "pending"
    assert persisted_intent.payload["summary_generated_segments"] == {segment.id: checkpoint}
    assert "summary_completed_segments" not in persisted_intent.payload
    assert persisted_summary is not None
    assert persisted_summary.summary_content == "summary generated with model A"
    assert persisted_summary.summary_index_node_id is None


@pytest.mark.usefixtures("bound_task_runtime")
def test_execution_claim_loss_during_llm_prevents_stale_summary_commit(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset, document, segment = _persist_document(sqlite_session)
    segment.indexing_generation = str(uuid4())
    intent = KnowledgeTaskOutbox(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        resource_id=document.id,
        task_kind=KnowledgeTaskKind.DOCUMENT_SUMMARY_INDEX,
        payload={},
        status="dispatched",
    )
    sqlite_session.add(intent)
    sqlite_session.commit()

    def lose_claim(
        _segment: DocumentSegment,
        _dataset: Dataset,
        _setting: object,
        *,
        session: Session,
    ) -> tuple[str, None]:
        del session
        with task_module.session_factory.create_session() as write_session, write_session.begin():
            persisted = write_session.get_one(KnowledgeTaskOutbox, intent.id)
            persisted.status = "pending"
            persisted.claim_id = None
        return "unowned generated summary", None

    monkeypatch.setattr(task_module.SummaryIndexAdapter, "generate_summary_for_segment", lose_claim)
    monkeypatch.setattr(
        task_module.SummaryIndexAdapter,
        "vectorize_summary",
        lambda *_args, **_kwargs: pytest.fail("unowned LLM output reached embedding provider"),
    )

    with pytest.raises(KnowledgeTaskExecutionLeaseLostError):
        task_module.generate_summary_index_task.run(
            dataset.id,
            document.id,
            [segment.id],
            intent.id,
            document.indexing_generation,
            False,
            *_summary_configuration(dataset),
        )

    sqlite_session.expire_all()
    summary = sqlite_session.scalar(select(DocumentSegmentSummary).where(DocumentSegmentSummary.chunk_id == segment.id))
    assert summary is not None
    assert summary.summary_content in {None, ""}

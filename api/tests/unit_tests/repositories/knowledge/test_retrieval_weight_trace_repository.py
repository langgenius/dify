from collections.abc import Sequence
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from core.rag.rerank.entity.weight import (
    CrossDatasetWeightedScoreStage,
    DatasetWeightedScoreStage,
    WeightedScoreCandidate,
    WeightedScoreObservation,
    WeightedScoreStage,
)
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating, RetrievalWeightTraceStage
from models.model import App, AppMode, Message, MessageFeedback
from models.retrieval_weight_trace import RetrievalWeightTrace
from repositories.knowledge.retrieval_weight_trace_repository import SQLAlchemyRetrievalWeightTraceRepository
from services.knowledge.retrieval.weighted_score_traces import WeightedScoreTraceDraft


def _draft(*, tenant_id: str, app_id: str, stage: WeightedScoreStage) -> WeightedScoreTraceDraft:
    return WeightedScoreTraceDraft(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id="00000000-0000-0000-0000-000000000001",
        workflow_run_id="00000000-0000-0000-0000-000000000002",
        node_id="knowledge",
        observation=WeightedScoreObservation(
            stage=stage,
            vector_weight=0.7,
            keyword_weight=0.3,
            embedding_provider_name="provider",
            embedding_model_name="embedding",
            score_threshold=0.2,
            top_n=4,
            candidates=(
                WeightedScoreCandidate("node-1", "doc-1", "ds-1", 0.9, 0.4, 0.75, 0),
                WeightedScoreCandidate("node-2", "doc-1", "ds-1", 0.1, 0.0, 0.07, None),
            ),
        ),
    )


TENANT = "10000000-0000-0000-0000-000000000000"
APP = "20000000-0000-0000-0000-000000000000"
OTHER_APP = "30000000-0000-0000-0000-000000000000"
DATASET = "40000000-0000-0000-0000-000000000000"


def test_save_traces_maps_both_stages(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyRetrievalWeightTraceRepository(session_factory=sqlite_session_factory)

    repository.save_traces(
        tenant_id=TENANT,
        app_id=APP,
        traces=[
            _draft(tenant_id=TENANT, app_id=APP, stage=DatasetWeightedScoreStage(dataset_id=DATASET)),
            _draft(tenant_id=TENANT, app_id=APP, stage=CrossDatasetWeightedScoreStage()),
        ],
    )

    with sqlite_session_factory() as session:
        rows = session.scalars(select(RetrievalWeightTrace).where(RetrievalWeightTrace.app_id == APP)).all()
    assert sorted((row.stage, row.dataset_id) for row in rows) == [
        (RetrievalWeightTraceStage.CROSS_DATASET, None),
        (RetrievalWeightTraceStage.DATASET, DATASET),
    ]
    assert rows[0].candidates[0] == {
        "index_node_id": "node-1",
        "document_id": "doc-1",
        "dataset_id": "ds-1",
        "vector_score": 0.9,
        "keyword_score": 0.4,
        "final_score": 0.75,
        "selected_rank": 0,
    }


def test_save_traces_rejects_drafts_of_another_owner(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyRetrievalWeightTraceRepository(session_factory=sqlite_session_factory)

    with pytest.raises(ValueError, match="tenant and app"):
        repository.save_traces(
            tenant_id=TENANT,
            app_id=APP,
            traces=[_draft(tenant_id=TENANT, app_id=OTHER_APP, stage=CrossDatasetWeightedScoreStage())],
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(RetrievalWeightTrace.id).where(RetrievalWeightTrace.app_id == OTHER_APP)) is None


def test_deletes_are_bounded_and_scoped(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyRetrievalWeightTraceRepository(session_factory=sqlite_session_factory)
    for app_id in (APP, APP, APP, OTHER_APP):
        repository.save_traces(
            tenant_id=TENANT,
            app_id=app_id,
            traces=[_draft(tenant_id=TENANT, app_id=app_id, stage=CrossDatasetWeightedScoreStage())],
        )
    with sqlite_session_factory() as session, session.begin():
        session.execute(
            update(RetrievalWeightTrace)
            .where(RetrievalWeightTrace.app_id == OTHER_APP)
            .values(created_at=datetime(2026, 1, 1))
        )

    assert repository.delete_app_traces(tenant_id=TENANT, app_id=APP, limit=2) == 2
    assert repository.delete_app_traces(tenant_id=TENANT, app_id=APP, limit=2) == 1
    assert repository.delete_app_traces(tenant_id=TENANT, app_id=APP, limit=2) == 0
    assert repository.delete_created_before(cutoff=datetime(2026, 1, 2), limit=10) == 1

    with sqlite_session_factory() as session:
        remaining = session.scalars(
            select(RetrievalWeightTrace.id).where(RetrievalWeightTrace.app_id.in_([APP, OTHER_APP]))
        ).all()
    assert remaining == []


def _persist_rated_message(
    session: Session,
    *,
    app_id: str,
    workflow_run_id: str | None,
    created_at: datetime,
    feedback: Sequence[tuple[FeedbackRating, FeedbackFromSource]],
) -> None:
    message = Message(
        id=str(uuid4()),
        app_id=app_id,
        conversation_id=str(uuid4()),
        query="hello",
        message={"role": "user", "content": "hello"},
        answer="world",
        message_tokens=1,
        message_unit_price=Decimal(0),
        answer_tokens=1,
        answer_unit_price=Decimal(0),
        provider_response_latency=0,
        currency="USD",
        from_source=ConversationFromSource.API,
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_run_id=workflow_run_id,
    )
    message.created_at = created_at
    session.add(message)
    session.flush()
    session.add_all(
        [
            MessageFeedback(
                app_id=app_id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=rating,
                from_source=source,
            )
            for rating, source in feedback
        ]
    )


EVIDENCE_TENANT = "50000000-0000-0000-0000-000000000000"
EVIDENCE_APP = "60000000-0000-0000-0000-000000000000"


def _persist_app(session: Session, *, app_id: str, tenant_id: str) -> None:
    session.add(
        App(
            id=app_id,
            tenant_id=tenant_id,
            name="Chatflow",
            description="",
            mode=AppMode.ADVANCED_CHAT,
            icon_type=None,
            icon=None,
            icon_background=None,
            enable_site=True,
            enable_api=True,
            is_public=False,
            max_active_requests=None,
        )
    )


def test_evidence_query_reads_rated_runs_and_their_traces(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyRetrievalWeightTraceRepository(session_factory=sqlite_session_factory)
    run_id = "70000000-0000-0000-0000-000000000001"
    with sqlite_session_factory() as session, session.begin():
        _persist_app(session, app_id=EVIDENCE_APP, tenant_id=EVIDENCE_TENANT)
        _persist_rated_message(
            session,
            app_id=EVIDENCE_APP,
            workflow_run_id=run_id,
            created_at=datetime(2026, 10, 29),
            feedback=[
                (FeedbackRating.LIKE, FeedbackFromSource.USER),
                (FeedbackRating.DISLIKE, FeedbackFromSource.ADMIN),
            ],
        )
        _persist_rated_message(
            session,
            app_id=EVIDENCE_APP,
            workflow_run_id="70000000-0000-0000-0000-000000000002",
            created_at=datetime(2026, 9, 1),
            feedback=[(FeedbackRating.LIKE, FeedbackFromSource.USER)],
        )
        _persist_rated_message(
            session,
            app_id=EVIDENCE_APP,
            workflow_run_id=None,
            created_at=datetime(2026, 10, 29),
            feedback=[(FeedbackRating.LIKE, FeedbackFromSource.USER)],
        )
    draft = _draft(tenant_id=EVIDENCE_TENANT, app_id=EVIDENCE_APP, stage=CrossDatasetWeightedScoreStage())
    repository.save_traces(
        tenant_id=EVIDENCE_TENANT,
        app_id=EVIDENCE_APP,
        traces=[
            WeightedScoreTraceDraft(
                tenant_id=draft.tenant_id,
                app_id=draft.app_id,
                workflow_id=draft.workflow_id,
                workflow_run_id=run_id,
                node_id=draft.node_id,
                observation=draft.observation,
            )
        ],
    )

    assert repository.app_exists(tenant_id=EVIDENCE_TENANT, app_id=EVIDENCE_APP)
    assert not repository.app_exists(tenant_id=TENANT, app_id=EVIDENCE_APP)
    feedback = repository.run_feedback(
        tenant_id=EVIDENCE_TENANT, app_id=EVIDENCE_APP, since=datetime(2026, 10, 1), limit=10
    )
    assert sorted((record.rating, record.from_source) for record in feedback) == [
        ("dislike", "admin"),
        ("like", "user"),
    ]
    assert {record.workflow_run_id for record in feedback} == {run_id}
    assert repository.run_feedback(tenant_id=TENANT, app_id=EVIDENCE_APP, since=datetime(2026, 1, 1), limit=10) == []

    [trace] = repository.traces_for_runs(tenant_id=EVIDENCE_TENANT, app_id=EVIDENCE_APP, workflow_run_ids=[run_id])
    assert (trace.stage, trace.vector_weight, trace.top_n) == ("cross_dataset", 0.7, 4)
    assert [candidate.selected for candidate in trace.candidates] == [True, False]

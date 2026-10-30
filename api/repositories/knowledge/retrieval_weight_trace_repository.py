"""SQLAlchemy persistence adapter for weighted-score retrieval traces."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, override

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.rerank.entity.weight import (
    CrossDatasetWeightedScoreStage,
    DatasetWeightedScoreStage,
    WeightedScoreCandidate,
    WeightedScoreStage,
)
from models.enums import FeedbackFromSource, FeedbackRating, RetrievalWeightTraceStage
from models.model import App, Message, MessageFeedback
from models.retrieval_weight_trace import RetrievalWeightTrace
from services.knowledge.retrieval.weight_recommendations import (
    RunFeedbackRecord,
    TraceCandidateRecord,
    WeightTraceRecord,
    WeightTuningEvidenceQuery,
)
from services.knowledge.retrieval.weighted_score_traces import (
    WeightedScoreTraceDraft,
    WeightedScoreTraceRetentionStore,
    WeightedScoreTraceStore,
)

_RUN_ID_CHUNK_SIZE = 500


class SQLAlchemyRetrievalWeightTraceRepository(
    WeightedScoreTraceStore, WeightedScoreTraceRetentionStore, WeightTuningEvidenceQuery
):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def save_traces(self, *, tenant_id: str, app_id: str, traces: Sequence[WeightedScoreTraceDraft]) -> None:
        if any(trace.tenant_id != tenant_id or trace.app_id != app_id for trace in traces):
            raise ValueError("every weighted-score trace must belong to the given tenant and app")
        with self._session_factory() as session, session.begin():
            session.add_all([_to_row(trace) for trace in traces])

    @override
    def delete_created_before(self, *, cutoff: datetime, limit: int) -> int:
        # Retention is time-based for every owner, so this sweep is intentionally not tenant-scoped.
        with self._session_factory() as session, session.begin():
            ids = session.scalars(
                select(RetrievalWeightTrace.id).where(RetrievalWeightTrace.created_at < cutoff).limit(limit)
            ).all()
            if ids:
                session.execute(delete(RetrievalWeightTrace).where(RetrievalWeightTrace.id.in_(ids)))
        return len(ids)

    @override
    def delete_app_traces(self, *, tenant_id: str, app_id: str, limit: int) -> int:
        with self._session_factory() as session, session.begin():
            ids = session.scalars(
                select(RetrievalWeightTrace.id)
                .where(RetrievalWeightTrace.tenant_id == tenant_id, RetrievalWeightTrace.app_id == app_id)
                .limit(limit)
            ).all()
            if ids:
                session.execute(
                    delete(RetrievalWeightTrace).where(
                        RetrievalWeightTrace.tenant_id == tenant_id,
                        RetrievalWeightTrace.app_id == app_id,
                        RetrievalWeightTrace.id.in_(ids),
                    )
                )
        return len(ids)

    @override
    def app_exists(self, *, tenant_id: str, app_id: str) -> bool:
        with self._session_factory() as session:
            found = session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id).limit(1))
        return found is not None

    @override
    def run_feedback(self, *, tenant_id: str, app_id: str, since: datetime, limit: int) -> Sequence[RunFeedbackRecord]:
        with self._session_factory() as session:
            rows = session.execute(
                select(Message.workflow_run_id, MessageFeedback.rating, MessageFeedback.from_source)
                .join(Message, Message.id == MessageFeedback.message_id)
                .join(App, App.id == Message.app_id)
                .where(
                    App.tenant_id == tenant_id,
                    MessageFeedback.app_id == app_id,
                    Message.app_id == app_id,
                    Message.workflow_run_id.is_not(None),
                    Message.created_at >= since,
                )
                .order_by(Message.created_at.desc(), Message.id)
                .limit(limit)
            ).all()
        return [
            RunFeedbackRecord(
                workflow_run_id=str(workflow_run_id),
                rating="like" if rating == FeedbackRating.LIKE else "dislike",
                from_source="admin" if from_source == FeedbackFromSource.ADMIN else "user",
            )
            for workflow_run_id, rating, from_source in rows
        ]

    @override
    def traces_for_runs(
        self, *, tenant_id: str, app_id: str, workflow_run_ids: Sequence[str]
    ) -> Sequence[WeightTraceRecord]:
        chunks = [
            workflow_run_ids[start : start + _RUN_ID_CHUNK_SIZE]
            for start in range(0, len(workflow_run_ids), _RUN_ID_CHUNK_SIZE)
        ]
        with self._session_factory() as session:
            rows = [
                row
                for chunk in chunks
                for row in session.scalars(
                    select(RetrievalWeightTrace).where(
                        RetrievalWeightTrace.tenant_id == tenant_id,
                        RetrievalWeightTrace.app_id == app_id,
                        RetrievalWeightTrace.workflow_run_id.in_(chunk),
                    )
                ).all()
            ]
            records = [_to_record(row) for row in rows]
        return sorted(records, key=lambda record: record.created_at)


def _to_record(row: RetrievalWeightTrace) -> WeightTraceRecord:
    return WeightTraceRecord(
        workflow_run_id=row.workflow_run_id,
        node_id=row.node_id,
        stage="dataset" if row.stage == RetrievalWeightTraceStage.DATASET else "cross_dataset",
        dataset_id=row.dataset_id,
        embedding_provider_name=row.embedding_provider_name,
        embedding_model_name=row.embedding_model_name,
        vector_weight=row.vector_weight,
        keyword_weight=row.keyword_weight,
        score_threshold=row.score_threshold,
        top_n=row.top_n,
        candidates=tuple(_candidate_record(candidate) for candidate in row.candidates),
        created_at=row.created_at,
    )


def _candidate_record(candidate: Mapping[str, Any]) -> TraceCandidateRecord:
    return TraceCandidateRecord(
        vector_score=float(candidate["vector_score"]),
        keyword_score=float(candidate["keyword_score"]),
        selected=candidate["selected_rank"] is not None,
    )


def _to_row(trace: WeightedScoreTraceDraft) -> RetrievalWeightTrace:
    observation = trace.observation
    stage, dataset_id = _stage_columns(observation.stage)
    return RetrievalWeightTrace(
        tenant_id=trace.tenant_id,
        app_id=trace.app_id,
        workflow_id=trace.workflow_id,
        workflow_run_id=trace.workflow_run_id,
        node_id=trace.node_id,
        stage=stage,
        dataset_id=dataset_id,
        vector_weight=observation.vector_weight,
        keyword_weight=observation.keyword_weight,
        embedding_provider_name=observation.embedding_provider_name,
        embedding_model_name=observation.embedding_model_name,
        score_threshold=observation.score_threshold,
        top_n=observation.top_n,
        candidates=[_candidate_to_json(candidate) for candidate in observation.candidates],
    )


def _stage_columns(stage: WeightedScoreStage) -> tuple[RetrievalWeightTraceStage, str | None]:
    """Map a stage to its column pair; the pair satisfies the table's stage/dataset check constraint."""
    match stage:
        case DatasetWeightedScoreStage(dataset_id=dataset_id):
            return RetrievalWeightTraceStage.DATASET, dataset_id
        case CrossDatasetWeightedScoreStage():
            return RetrievalWeightTraceStage.CROSS_DATASET, None


def _candidate_to_json(candidate: WeightedScoreCandidate) -> dict[str, str | float | int | None]:
    return {
        "index_node_id": candidate.index_node_id,
        "document_id": candidate.document_id,
        "dataset_id": candidate.dataset_id,
        "vector_score": candidate.vector_score,
        "keyword_score": candidate.keyword_score,
        "final_score": candidate.final_score,
        "selected_rank": candidate.selected_rank,
    }

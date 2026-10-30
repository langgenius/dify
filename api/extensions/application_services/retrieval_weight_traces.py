"""Composition root for weighted-score retrieval traces."""

import random

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from domain.retrieval_weight_tuning.weight_recommendation import TuningPolicy
from libs.datetime_utils import naive_utc_now
from repositories.knowledge.retrieval_weight_trace_repository import SQLAlchemyRetrievalWeightTraceRepository
from services.knowledge.retrieval.weight_recommendations import RetrievalWeightRecommendationService
from services.knowledge.retrieval.weighted_score_traces import (
    WeightedScoreTracePolicy,
    WeightedScoreTraceRecorder,
    WeightedScoreTraceRetentionService,
)

_RETENTION_BATCH_SIZE = 1000
# Recommend-only tuning: grid of vector weights in 0.05 steps; a change needs 30 liked and 30
# disliked runs, a move of at least 0.1, a 90% bootstrap interval above 0, and a best weight that
# 60% of 200 resamples place within 0.1 of it.
_TUNING_POLICY = TuningPolicy(
    grid_step=0.05,
    min_runs_per_rating=30,
    min_shift=0.1,
    stability_radius=0.1,
    min_stability=0.6,
    confidence=0.9,
    resamples=200,
)
_MAX_FEEDBACK_ROWS = 5000
# A fixed seed makes a report reproducible for the same evidence.
_RESAMPLING_SEED = 0


def build_weighted_score_trace_recorder(*, database_client: sessionmaker[Session]) -> WeightedScoreTraceRecorder:
    return WeightedScoreTraceRecorder(
        store=SQLAlchemyRetrievalWeightTraceRepository(session_factory=database_client),
        policy=WeightedScoreTracePolicy(
            enabled=dify_config.RETRIEVAL_WEIGHT_TRACE_ENABLED,
            sample_rate=dify_config.RETRIEVAL_WEIGHT_TRACE_SAMPLE_RATE,
        ),
        draw=random.random,  # noqa: S311 - sampling, not security
    )


def build_weighted_score_trace_retention_service(
    *, database_client: sessionmaker[Session]
) -> WeightedScoreTraceRetentionService:
    return WeightedScoreTraceRetentionService(
        store=SQLAlchemyRetrievalWeightTraceRepository(session_factory=database_client),
        retention_days=dify_config.RETRIEVAL_WEIGHT_TRACE_RETENTION_DAYS,
        now=naive_utc_now,
        batch_size=_RETENTION_BATCH_SIZE,
    )


def build_retrieval_weight_recommendation_service(
    *, database_client: sessionmaker[Session]
) -> RetrievalWeightRecommendationService:
    return RetrievalWeightRecommendationService(
        evidence=SQLAlchemyRetrievalWeightTraceRepository(session_factory=database_client),
        policy=_TUNING_POLICY,
        window_days=dify_config.RETRIEVAL_WEIGHT_TRACE_RETENTION_DAYS,
        max_feedback=_MAX_FEEDBACK_ROWS,
        now=naive_utc_now,
        new_sampler=lambda: random.Random(_RESAMPLING_SEED).randrange,  # noqa: S311 - resampling, not security
    )

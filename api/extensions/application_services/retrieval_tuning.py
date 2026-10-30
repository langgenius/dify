"""Composition of retrieval tuning use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from repositories.retrieval_tuning_repository import RetrievalTuningRepository
from services.retrieval_tuning.feedback_volume import FeedbackVolumeService
from services.retrieval_tuning.node_eligibility import NodeEligibilityService


@dataclass(frozen=True, slots=True)
class RetrievalTuningServices:
    feedback_volume: FeedbackVolumeService
    node_eligibility: NodeEligibilityService


def build_retrieval_tuning_services(*, database_client: sessionmaker[Session]) -> RetrievalTuningServices:
    repository = RetrievalTuningRepository(session_factory=database_client)
    return RetrievalTuningServices(
        feedback_volume=FeedbackVolumeService(query=repository),
        node_eligibility=NodeEligibilityService(query=repository),
    )

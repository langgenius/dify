"""
LLM Generation Detail Service.

Provides methods to query and attach generation details to workflow node executions
and messages, avoiding N+1 query problems.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.llm_generation_entities import LLMGenerationDetailData
from models import LLMGenerationDetail


class LLMGenerationService:
    """Service for handling LLM generation details."""

    def __init__(self, session: Session):
        self._session = session

    def get_generation_detail_for_message(self, message_id: str) -> LLMGenerationDetailData | None:
        """Query generation detail for a specific message."""
        stmt = select(LLMGenerationDetail).where(LLMGenerationDetail.message_id == message_id)
        detail = self._session.scalars(stmt).first()
        return detail.to_domain_model() if detail else None

    def get_generation_details_for_messages(
        self,
        message_ids: list[str],
    ) -> dict[str, LLMGenerationDetailData]:
        """Batch query generation details for multiple messages."""
        if not message_ids:
            return {}

        stmt = select(LLMGenerationDetail).where(LLMGenerationDetail.message_id.in_(message_ids))
        details = self._session.scalars(stmt).all()
        return {detail.message_id: detail.to_domain_model() for detail in details if detail.message_id}

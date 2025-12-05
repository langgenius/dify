"""
LLM Generation Detail Service.

Provides methods to query and attach generation details to workflow node executions
and messages, avoiding N+1 query problems.
"""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.entities.llm_generation_entities import LLMGenerationDetailData
from models import LLMGenerationDetail, WorkflowNodeExecutionModel


class LLMGenerationService:
    """Service for handling LLM generation details."""

    def __init__(self, session: Session):
        self._session = session

    def get_generation_details_for_workflow_run(
        self,
        workflow_run_id: str,
    ) -> dict[str, LLMGenerationDetailData]:
        """
        Batch query generation details for all LLM nodes in a workflow run.

        Returns dict mapping node_id to LLMGenerationDetailData.
        """
        stmt = select(LLMGenerationDetail).where(LLMGenerationDetail.workflow_run_id == workflow_run_id)
        details = self._session.scalars(stmt).all()
        return {detail.node_id: detail.to_domain_model() for detail in details if detail.node_id}

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

    def attach_generation_details_to_node_executions(
        self,
        node_executions: Sequence[WorkflowNodeExecutionModel],
        workflow_run_id: str,
    ) -> list[dict]:
        """
        Attach generation details to node executions and return as dicts.

        Queries generation details in batch and attaches them to the corresponding
        node executions, avoiding N+1 queries.
        """
        generation_details = self.get_generation_details_for_workflow_run(workflow_run_id)

        return [
            {
                "id": node.id,
                "index": node.index,
                "predecessor_node_id": node.predecessor_node_id,
                "node_id": node.node_id,
                "node_type": node.node_type,
                "title": node.title,
                "inputs": node.inputs_dict,
                "process_data": node.process_data_dict,
                "outputs": node.outputs_dict,
                "status": node.status,
                "error": node.error,
                "elapsed_time": node.elapsed_time,
                "execution_metadata": node.execution_metadata_dict,
                "extras": node.extras,
                "created_at": int(node.created_at.timestamp()) if node.created_at else None,
                "created_by_role": node.created_by_role,
                "created_by_account": _serialize_account(node.created_by_account),
                "created_by_end_user": _serialize_end_user(node.created_by_end_user),
                "finished_at": int(node.finished_at.timestamp()) if node.finished_at else None,
                "inputs_truncated": node.inputs_truncated,
                "outputs_truncated": node.outputs_truncated,
                "process_data_truncated": node.process_data_truncated,
                "generation_detail": generation_details[node.node_id].to_response_dict()
                if node.node_id in generation_details
                else None,
            }
            for node in node_executions
        ]


def _serialize_account(account) -> dict | None:
    """Serialize Account to dict for API response."""
    if not account:
        return None
    return {
        "id": account.id,
        "name": account.name,
        "email": account.email,
    }


def _serialize_end_user(end_user) -> dict | None:
    """Serialize EndUser to dict for API response."""
    if not end_user:
        return None
    return {
        "id": end_user.id,
        "type": end_user.type,
        "is_anonymous": end_user.is_anonymous,
        "session_id": end_user.session_id,
    }

"""Compose Agent binding operations within an existing workflow transaction."""

from sqlalchemy.orm import Session

from repositories.agent.workflow_binding_repository import WorkflowAgentBindingRepository
from services.agent.workflow_publish_service import WorkflowAgentPublishService


def build_workflow_agent_service(session: Session) -> WorkflowAgentPublishService:
    return WorkflowAgentPublishService(repository=WorkflowAgentBindingRepository(session))

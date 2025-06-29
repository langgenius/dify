"""
Factory for creating workflow execution repositories.
"""

import logging
from typing import Optional, Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import DifyConfig
from core.repositories.in_memory_workflow_execution_repository import InMemoryWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.workflow_execution_repo_mode import WorkflowExecRepoMode
from core.workflow.repositories.workflow_execution_repository import WorkflowExecutionRepository
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


def create_workflow_execution_repository(
    session_factory: sessionmaker | Engine,
    user: Union[Account, EndUser],
    app_id: Optional[str],
    triggered_from: Optional[WorkflowRunTriggeredFrom],
) -> WorkflowExecutionRepository:
    """
    Create a workflow execution repository based on configuration.

    Args:
        session_factory: SQLAlchemy sessionmaker or engine for creating sessions
        user: Account or EndUser object containing tenant_id, user ID, and role information
        app_id: App ID for filtering by application (can be None)
        triggered_from: Source of the execution trigger (DEBUGGING or APP_RUN)

    Returns:
        A WorkflowExecutionRepository implementation
    """
    config = DifyConfig()
    repo_mode = config.WORKFLOW_NODE_EXECUTION_REPO_MODE.lower()

    if repo_mode == WorkflowExecRepoMode.MEMORY:
        logger.info("Using in-memory workflow execution repository")
        return InMemoryWorkflowExecutionRepository(
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
        )
    else:
        logger.info("Using SQLAlchemy workflow execution repository")
        return SQLAlchemyWorkflowExecutionRepository(
            session_factory=session_factory,
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
        )

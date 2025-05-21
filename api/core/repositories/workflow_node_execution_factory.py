"""
Factory for creating workflow node execution repositories.
"""

import logging
from typing import Optional, Union

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import DifyConfig
from core.repositories import (
    InMemoryWorkflowNodeExecutionRepository,
    SQLAlchemyWorkflowNodeExecutionRepository,
)
from core.workflow.repository.workflow_node_execution_repository import (
    ExecRepoMode,
    WorkflowNodeExecutionRepository,
)
from models import Account, EndUser, WorkflowNodeExecutionTriggeredFrom

logger = logging.getLogger(__name__)


def create_workflow_node_execution_repository(
    session_factory: sessionmaker | Engine,
    user: Union[Account, EndUser],
    app_id: Optional[str],
    triggered_from: Optional[WorkflowNodeExecutionTriggeredFrom],
) -> WorkflowNodeExecutionRepository:
    """
    Create a workflow node execution repository based on configuration.

    Args:
        session_factory: SQLAlchemy sessionmaker or engine for creating sessions
        user: Account or EndUser object containing tenant_id, user ID, and role information
        app_id: App ID for filtering by application (can be None)
        triggered_from: Source of the execution trigger (SINGLE_STEP or WORKFLOW_RUN)

    Returns:
        A WorkflowNodeExecutionRepository implementation
    """
    config = DifyConfig()
    repo_mode = config.WORKFLOW_NODE_EXECUTION_REPO_MODE.lower()

    if repo_mode == ExecRepoMode.MEMORY:
        logger.info("Using in-memory workflow node execution repository")
        return InMemoryWorkflowNodeExecutionRepository(
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
        )
    else:
        logger.info("Using SQLAlchemy workflow node execution repository")
        return SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
        ) 
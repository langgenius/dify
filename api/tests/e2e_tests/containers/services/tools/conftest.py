"""Tool metadata and management use the test database through explicit ports."""

import pytest
from sqlalchemy.orm import Session, sessionmaker

from repositories.tools.workflow_repository import WorkflowToolRepository
from services.tools.workflow_tools_manage_service import WorkflowToolManageService


@pytest.fixture
def workflow_queries(db_session_with_containers: Session) -> WorkflowToolRepository:
    return WorkflowToolRepository(sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False))


@pytest.fixture
def workflow_tools(workflow_queries: WorkflowToolRepository) -> WorkflowToolManageService:
    return WorkflowToolManageService(workflow_queries)

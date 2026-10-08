"""Composition for tool metadata and management; execution is composed separately."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from models.tool_runtime_contracts import WorkflowToolQueries
from repositories.tools.provider_repository import ToolProviderRepository
from repositories.tools.workflow_repository import WorkflowToolRepository
from services.tools.provider_queries import ToolProviders
from services.tools.workflow_tools_manage_service import WorkflowToolManageService


@dataclass(frozen=True)
class ToolServices:
    workflow_queries: WorkflowToolQueries
    tool_providers: ToolProviders
    workflows: WorkflowToolManageService


def build_tool_services(database_client: sessionmaker[Session]) -> ToolServices:
    repository = WorkflowToolRepository(database_client)
    return ToolServices(
        workflow_queries=repository,
        tool_providers=ToolProviderRepository(database_client),
        workflows=WorkflowToolManageService(repository),
    )

"""Compose service-side workflow queries, pause management, and retention storage."""

from __future__ import annotations

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from repositories.workflow.logstore.node_execution_repository import LogstoreWorkflowNodeExecutionRepository
from repositories.workflow.logstore.run_repository import LogstoreWorkflowRunRepository
from repositories.workflow.node_execution_repository import DifyAPISQLAlchemyWorkflowNodeExecutionRepository
from repositories.workflow.run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from services.workflow.node_execution_queries import DifyAPIWorkflowNodeExecutionRepository
from services.workflow.run_repository import APIWorkflowRunRepository


def create_api_workflow_node_execution_repository(
    session_maker: sessionmaker[Session],
) -> DifyAPIWorkflowNodeExecutionRepository:
    if dify_config.WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND == "logstore":
        return LogstoreWorkflowNodeExecutionRepository(session_maker=session_maker)

    return DifyAPISQLAlchemyWorkflowNodeExecutionRepository(session_maker=session_maker)


def create_api_workflow_run_repository(session_maker: sessionmaker[Session]) -> APIWorkflowRunRepository:
    if dify_config.WORKFLOW_RUN_STORAGE_BACKEND == "logstore":
        return LogstoreWorkflowRunRepository(session_maker=session_maker)

    return DifyAPISQLAlchemyWorkflowRunRepository(session_maker=session_maker)

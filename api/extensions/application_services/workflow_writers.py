"""Compose runtime workflow writers and execution-data uploads."""

from __future__ import annotations

from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.workflow.persistence_ports import WorkflowExecutionRepository, WorkflowNodeExecutionRepository
from models import Account, EndUser
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import WorkflowNodeExecutionTriggeredFrom
from repositories.workflow.celery_execution_writer import CeleryWorkflowExecutionRepository
from repositories.workflow.celery_node_execution_writer import CeleryWorkflowNodeExecutionRepository
from repositories.workflow.execution_writer import SQLAlchemyWorkflowExecutionRepository
from repositories.workflow.logstore.execution_writer import LogstoreWorkflowExecutionWriter
from repositories.workflow.logstore.node_execution_writer import LogstoreWorkflowNodeExecutionWriter
from repositories.workflow.node_execution_writer import SQLAlchemyWorkflowNodeExecutionRepository
from repositories.workflow.offload import WorkflowOffloadUploader


def build_workflow_offload_uploader(
    *, session_factory: sessionmaker | Engine, tenant_id: str, user: Account | EndUser
) -> WorkflowOffloadUploader:
    # File extraction still depends on tracing through the generation entities.
    from services.file_service import FileService

    files = FileService(session_factory)

    def upload(*, filename: str, content: bytes):
        return files.upload_file(
            filename=filename, content=content, mimetype="application/json", user=user, tenant_id=tenant_id
        )

    return upload


def create_workflow_execution_repository(
    session_factory: sessionmaker | Engine,
    tenant_id: str,
    user: Account | EndUser,
    app_id: str,
    triggered_from: WorkflowRunTriggeredFrom,
) -> WorkflowExecutionRepository:
    match dify_config.WORKFLOW_RUN_STORAGE_BACKEND:
        case "logstore":
            repository_class = LogstoreWorkflowExecutionWriter
        case "celery":
            repository_class = CeleryWorkflowExecutionRepository
        case "rdbms":
            repository_class = SQLAlchemyWorkflowExecutionRepository
    return repository_class(
        session_factory=session_factory, tenant_id=tenant_id, user=user, app_id=app_id, triggered_from=triggered_from
    )


def create_workflow_node_execution_repository(
    session_factory: sessionmaker | Engine,
    tenant_id: str,
    user: Account | EndUser,
    app_id: str,
    triggered_from: WorkflowNodeExecutionTriggeredFrom,
) -> WorkflowNodeExecutionRepository:
    match dify_config.WORKFLOW_NODE_EXECUTION_STORAGE_BACKEND:
        case "logstore":
            repository_class = LogstoreWorkflowNodeExecutionWriter
        case "celery":
            repository_class = CeleryWorkflowNodeExecutionRepository
        case "rdbms":
            repository_class = SQLAlchemyWorkflowNodeExecutionRepository
    return repository_class(
        session_factory=session_factory,
        tenant_id=tenant_id,
        user=user,
        app_id=app_id,
        triggered_from=triggered_from,
        upload_file=build_workflow_offload_uploader(session_factory=session_factory, tenant_id=tenant_id, user=user),
    )

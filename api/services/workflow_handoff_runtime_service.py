import os
import socket

from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.app.layers.workflow_handoff_persist_layer import (
    ResumableWorkflowGenerateEntity,
    WorkflowHandoffLayerConfig,
    WorkflowHandoffPersistenceLayer,
    create_workflow_handoff_persistence_layer,
)
from extensions.ext_database import db
from extensions.ext_storage import storage
from graphon.filters import ResponseStreamFilter
from models.workflow_handoff import WorkflowHandoffResumeRoute
from repositories.sqlalchemy_workflow_handoff_repository import SQLAlchemyWorkflowRunHandoffRepository
from services.workflow_handoff_service import WorkflowHandoffService


def build_workflow_handoff_persistence_layer(
    *,
    generate_entity: ResumableWorkflowGenerateEntity,
    response_stream_filter: ResponseStreamFilter,
    resume_route: WorkflowHandoffResumeRoute | None = None,
) -> WorkflowHandoffPersistenceLayer | None:
    """Build the durable maintenance layer for a top-level workflow segment.

    Nested Workflow-as-Tool calls are deliberately excluded. Their return value
    is part of the parent node's in-memory execution, so independently handing
    off the child would sever the result from its caller. The parent graph drains
    that node and checkpoints at the next safe scheduling boundary instead.
    """
    if not dify_config.WORKFLOW_HANDOFF_ENABLED or generate_entity.call_depth > 0:
        return None

    repository = SQLAlchemyWorkflowRunHandoffRepository(
        sessionmaker(bind=db.engine, expire_on_commit=False),
    )
    handoff_service = WorkflowHandoffService(repository=repository, storage=storage)

    source_worker_id = f"{socket.gethostname()}:{os.getpid()}"[:255]
    return create_workflow_handoff_persistence_layer(
        config=WorkflowHandoffLayerConfig(
            handoff_service=handoff_service,
            source_worker_id=source_worker_id,
            resume_route=resume_route,
        ),
        generate_entity=generate_entity,
        response_stream_filter=response_stream_filter,
    )


def infer_initial_handoff_resume_route(
    generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
    *,
    triggered: bool = False,
) -> WorkflowHandoffResumeRoute:
    if isinstance(generate_entity, RagPipelineGenerateEntity):
        return WorkflowHandoffResumeRoute.RAG_PIPELINE
    if isinstance(generate_entity, AdvancedChatAppGenerateEntity):
        return WorkflowHandoffResumeRoute.ADVANCED_CHAT
    if triggered:
        return WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW
    return WorkflowHandoffResumeRoute.WORKFLOW


__all__ = [
    "build_workflow_handoff_persistence_layer",
    "infer_initial_handoff_resume_route",
]

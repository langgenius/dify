import contextvars
import json
import logging
import time
import uuid
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import click
from celery import Task, shared_task  # type: ignore
from flask import current_app, g
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from core.rag.pipeline.queue import TenantIsolatedTaskQueue, TenantTaskDispatchClaimOutcome
from core.repositories.factory import DifyCoreRepositoryFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.datetime_utils import naive_utc_now
from models import Account, Tenant
from models.dataset import Pipeline
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom
from models.workflow_handoff import RagPipelineHandoffGroupIdentity, RagPipelineQueueKind
from repositories.rag_pipeline_handoff_group_repository import SQLAlchemyRagPipelineHandoffGroupRepository
from services.file_service import FileService
from services.rag_pipeline.rag_pipeline_handoff_group_service import RagPipelineHandoffGroupService
from tasks.rag_pipeline.rag_pipeline_task_support import (
    RAG_PIPELINE_DISPATCH_RETRY_SECONDS,
    RAG_PIPELINE_DISPATCH_TOKEN_HEADER,
    RagPipelineDispatchLease,
    attach_rag_handoff_group_metadata,
    build_rag_pipeline_dispatch_owner,
    mark_rag_document_permanently_failed,
    rag_pipeline_failure_is_owned_by_handoff,
    refresh_rag_pipeline_batch_heartbeat,
    resolve_rag_batch_tenant_isolation,
    resolve_rag_pipeline_dispatch_token,
    response_created_workflow_handoff,
    wait_for_rag_pipeline_futures,
)

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    queue="priority_pipeline",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=None,
)
def priority_rag_pipeline_run_task(
    task: Task,
    rag_pipeline_invoke_entities_file_id: str,
    tenant_id: str,
    dispatch_token: str | None = None,
):
    """
    Async Run rag pipeline task using high priority queue.

    :param rag_pipeline_invoke_entities_file_id: File ID containing serialized RAG pipeline invoke entities
    :param tenant_id: Tenant ID for the pipeline execution
    """
    # run with threading, thread pool size is 10

    request = task.request
    dispatch_token = resolve_rag_pipeline_dispatch_token(
        explicit_token=dispatch_token,
        request_headers=getattr(request, "headers", None),
    )
    dispatch_lease: RagPipelineDispatchLease | None = None
    if dispatch_token is not None:
        owner = build_rag_pipeline_dispatch_owner(
            task_id=getattr(request, "id", None),
            hostname=getattr(request, "hostname", None),
        )
        dispatch_outcome, dispatch_lease = RagPipelineDispatchLease.acquire(
            tenant_id=tenant_id,
            dispatch_token=dispatch_token,
            owner=owner,
        )
        if dispatch_outcome == TenantTaskDispatchClaimOutcome.DONE:
            logger.info("Skipping completed priority RAG pipeline dispatch %s", dispatch_token)
            return {"status": "already_completed", "dispatch_token": dispatch_token}
        if dispatch_outcome == TenantTaskDispatchClaimOutcome.BUSY:
            logger.info("Priority RAG pipeline dispatch %s is owned by another worker; retrying", dispatch_token)
            raise task.retry(countdown=RAG_PIPELINE_DISPATCH_RETRY_SECONDS)

    batch_has_handoff = False
    tenant_isolated = True
    group_identity = RagPipelineHandoffGroupIdentity(
        source_batch_id=rag_pipeline_invoke_entities_file_id,
        tenant_id=tenant_id,
        queue_kind=RagPipelineQueueKind.PRIORITY,
    )
    heartbeat_key = RagPipelineHandoffGroupService.batch_heartbeat_key(group_identity)
    try:
        start_at = time.perf_counter()
        rag_pipeline_invoke_entities_content = FileService(db.engine).get_file_content(
            rag_pipeline_invoke_entities_file_id
        )
        rag_pipeline_invoke_entities = json.loads(rag_pipeline_invoke_entities_content)
        tenant_isolated = resolve_rag_batch_tenant_isolation(rag_pipeline_invoke_entities)
        refresh_rag_pipeline_batch_heartbeat(heartbeat_key)

        logger.info("tenant %s received %d rag pipeline invoke entities", tenant_id, len(rag_pipeline_invoke_entities))

        # Get Flask app object for thread context
        flask_app = current_app._get_current_object()  # type: ignore

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for rag_pipeline_invoke_entity in rag_pipeline_invoke_entities:
                # Submit task to thread pool with Flask app
                future = executor.submit(
                    run_single_rag_pipeline_task,
                    rag_pipeline_invoke_entity,
                    flask_app,
                    source_batch_id=rag_pipeline_invoke_entities_file_id,
                    queue_kind=RagPipelineQueueKind.PRIORITY,
                    tenant_isolated=tenant_isolated,
                    expected_tenant_id=tenant_id,
                )
                futures.append(future)

            batch_has_handoff = wait_for_rag_pipeline_futures(futures=futures, heartbeat_key=heartbeat_key)
        end_at = time.perf_counter()
        logging.info(
            click.style(
                f"tenant_id: {tenant_id}, Rag pipeline run completed. Latency: {end_at - start_at}s", fg="green"
            )
        )
    except Exception:
        logging.exception(click.style(f"Error running rag pipeline, tenant_id: {tenant_id}", fg="red"))
        raise
    finally:
        delete_source_file = dispatch_lease is None
        try:
            try:
                redis_client.delete(heartbeat_key)
            except Exception:
                logger.warning("Failed to clear RAG batch heartbeat %s", heartbeat_key, exc_info=True)
            handoff_group_service = _create_handoff_group_service()
            sealed_handoffs = handoff_group_service.seal_group(identity=group_identity, sealed_at=naive_utc_now())
            if sealed_handoffs:
                handoff_group_service.reconcile_group(identity=group_identity, now=naive_utc_now())
            elif batch_has_handoff:
                raise RuntimeError(f"RAG maintenance response has no durable handoff group: {group_identity}")
            elif tenant_isolated:
                _release_legacy_tenant_slot(tenant_id, source_batch_id=rag_pipeline_invoke_entities_file_id)
            if dispatch_lease is not None:
                dispatch_lease.complete()
            delete_source_file = True
        finally:
            if dispatch_lease is not None and not delete_source_file:
                dispatch_lease.abandon()
            if delete_source_file:
                file_service = FileService(db.engine)
                file_service.delete_file(rag_pipeline_invoke_entities_file_id)
            db.session.close()


def run_single_rag_pipeline_task(
    rag_pipeline_invoke_entity: Mapping[str, Any],
    flask_app,
    *,
    source_batch_id: str = "legacy",
    queue_kind: RagPipelineQueueKind = RagPipelineQueueKind.PRIORITY,
    tenant_isolated: bool = True,
    expected_tenant_id: str | None = None,
) -> bool:
    """Run a single RAG pipeline task within Flask app context."""
    # Create Flask application context for this thread
    with flask_app.app_context():
        entity: RagPipelineGenerateEntity | None = None
        tenant_id = ""
        application_generate_entity: Mapping[str, Any] | None = None
        try:
            rag_pipeline_invoke_entity_model = RagPipelineInvokeEntity.model_validate(rag_pipeline_invoke_entity)
            user_id = rag_pipeline_invoke_entity_model.user_id
            tenant_id = rag_pipeline_invoke_entity_model.tenant_id
            if expected_tenant_id is not None and tenant_id != expected_tenant_id:
                raise ValueError(
                    f"RAG pipeline batch tenant {expected_tenant_id} does not own invoke entity tenant {tenant_id}"
                )
            pipeline_id = rag_pipeline_invoke_entity_model.pipeline_id
            workflow_id = rag_pipeline_invoke_entity_model.workflow_id
            workflow_execution_id = rag_pipeline_invoke_entity_model.workflow_execution_id
            workflow_thread_pool_id = rag_pipeline_invoke_entity_model.workflow_thread_pool_id
            application_generate_entity = rag_pipeline_invoke_entity_model.application_generate_entity

            with Session(db.engine, expire_on_commit=False) as session:
                # Load required entities
                account = session.scalar(select(Account).where(Account.id == user_id).limit(1))
                if not account:
                    raise ValueError(f"Account {user_id} not found")

                tenant = session.scalar(select(Tenant).where(Tenant.id == tenant_id).limit(1))
                if not tenant:
                    raise ValueError(f"Tenant {tenant_id} not found")
                account.set_current_tenant_with_session(tenant, session=session)

                pipeline = session.scalar(
                    select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id).limit(1)
                )
                if not pipeline:
                    raise ValueError(f"Pipeline {pipeline_id} not found")
                if workflow_id != pipeline.workflow_id:
                    raise ValueError("RAG pipeline invoke entity workflow ownership is inconsistent")

                workflow = session.scalar(
                    select(Workflow)
                    .where(Workflow.id == pipeline.workflow_id, Workflow.tenant_id == tenant_id)
                    .limit(1)
                )
                if not workflow:
                    raise ValueError(f"Workflow {pipeline.workflow_id} not found")

                if workflow_execution_id is None:
                    workflow_execution_id = str(uuid.uuid4())

                entity = attach_rag_handoff_group_metadata(
                    RagPipelineGenerateEntity.model_validate(application_generate_entity),
                    source_batch_id=source_batch_id,
                    tenant_id=tenant_id,
                    queue_kind=queue_kind,
                    tenant_isolated=tenant_isolated,
                )
                if (
                    entity.app_config.tenant_id != tenant_id
                    or entity.pipeline_config.tenant_id != tenant_id
                    or entity.app_config.workflow_id != workflow.id
                    or entity.pipeline_config.workflow_id != workflow.id
                ):
                    raise ValueError("RAG pipeline generate entity ownership metadata is inconsistent")

                # Create workflow repositories
                session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
                workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                    session_factory=session_factory,
                    tenant_id=pipeline.tenant_id,
                    user=account,
                    app_id=entity.app_config.app_id,
                    triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
                )

                workflow_node_execution_repository = (
                    DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                        session_factory=session_factory,
                        tenant_id=pipeline.tenant_id,
                        user=account,
                        app_id=entity.app_config.app_id,
                        triggered_from=WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN,
                    )
                )

            # Set the user directly in g for preserve_flask_contexts
            g._login_user = account

            # Copy context for passing to pipeline generator
            context = contextvars.copy_context()

            # Direct execution without creating another thread
            # Since we're already in a thread pool, no need for nested threading
            from core.app.apps.pipeline.pipeline_generator import PipelineGenerator

            pipeline_generator = PipelineGenerator()
            # Using protected method intentionally for async execution
            with Session(db.engine, expire_on_commit=False) as session:
                response = pipeline_generator._generate(  # type: ignore[attr-defined]
                    session=session,
                    flask_app=flask_app,
                    context=context,
                    pipeline=pipeline,
                    workflow_id=workflow_id,
                    user=account,
                    application_generate_entity=entity,
                    invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
                    workflow_execution_repository=workflow_execution_repository,
                    workflow_node_execution_repository=workflow_node_execution_repository,
                    streaming=False,
                    workflow_thread_pool_id=workflow_thread_pool_id,
                )
                return response_created_workflow_handoff(response)
        except Exception as error:
            if entity is None and tenant_id and application_generate_entity is not None:
                try:
                    entity = attach_rag_handoff_group_metadata(
                        RagPipelineGenerateEntity.model_validate(application_generate_entity),
                        source_batch_id=source_batch_id,
                        tenant_id=tenant_id,
                        queue_kind=queue_kind,
                        tenant_isolated=tenant_isolated,
                    )
                except Exception:
                    entity = None
            identity = RagPipelineHandoffGroupIdentity(
                source_batch_id=source_batch_id,
                tenant_id=tenant_id,
                queue_kind=queue_kind,
            )
            if (
                entity is not None
                and tenant_id
                and not rag_pipeline_failure_is_owned_by_handoff(
                    workflow_run_id=entity.workflow_execution_id,
                    identity=identity,
                )
            ):
                mark_rag_document_permanently_failed(entity=entity, tenant_id=tenant_id, error=error)
            logging.exception("Error in priority pipeline task")
            raise


def _release_legacy_tenant_slot(tenant_id: str, *, source_batch_id: str) -> None:
    released_key = f"rag_pipeline_batch_released:{source_batch_id}"
    if redis_client.get(released_key):
        return
    tenant_isolated_task_queue = TenantIsolatedTaskQueue(tenant_id, "pipeline")
    has_next, next_file_id = tenant_isolated_task_queue.claim_task_once(
        claim_key=f"priority_rag_pipeline_batch_release_claim:{source_batch_id}",
        ttl=7 * 24 * 60 * 60,
    )
    logger.info("priority rag pipeline tenant isolation queue %s next file: %s", tenant_id, next_file_id)
    if not has_next:
        redis_client.setex(released_key, 7 * 24 * 60 * 60, 1)
        return
    file_id = next_file_id.decode("utf-8") if isinstance(next_file_id, bytes) else next_file_id
    if not isinstance(file_id, str) or not file_id:
        raise ValueError(f"Invalid queued RAG pipeline source batch: {next_file_id!r}")
    priority_rag_pipeline_run_task.delay(  # type: ignore
        rag_pipeline_invoke_entities_file_id=file_id,
        tenant_id=tenant_id,
    )
    redis_client.setex(released_key, 7 * 24 * 60 * 60, 1)


def _create_handoff_group_service() -> RagPipelineHandoffGroupService:
    def _enqueue_regular(file_id: str, tenant_id: str, dispatch_token: str) -> None:
        from tasks.rag_pipeline.rag_pipeline_run_task import rag_pipeline_run_task

        rag_pipeline_run_task.apply_async(
            kwargs={
                "rag_pipeline_invoke_entities_file_id": file_id,
                "tenant_id": tenant_id,
            },
            headers={RAG_PIPELINE_DISPATCH_TOKEN_HEADER: dispatch_token},
            queue=dify_config.WORKFLOW_HANDOFF_QUEUE,
        )

    def _enqueue_priority(file_id: str, tenant_id: str, dispatch_token: str) -> None:
        priority_rag_pipeline_run_task.apply_async(
            kwargs={
                "rag_pipeline_invoke_entities_file_id": file_id,
                "tenant_id": tenant_id,
            },
            headers={RAG_PIPELINE_DISPATCH_TOKEN_HEADER: dispatch_token},
            queue=dify_config.WORKFLOW_HANDOFF_QUEUE,
        )

    return RagPipelineHandoffGroupService(
        repository=SQLAlchemyRagPipelineHandoffGroupRepository(sessionmaker(bind=db.engine, expire_on_commit=False)),
        regular_enqueue=_enqueue_regular,
        priority_enqueue=_enqueue_priority,
    )

import contextvars
import logging
import time
import uuid
from collections.abc import Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from functools import partial
from typing import Any

import click
from celery import shared_task  # type: ignore
from flask import current_app, g
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.db.session_factory import get_session_maker
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from core.repositories.factory import DifyCoreRepositoryFactory
from extensions.application_services.data_sources import build_data_source_credentials
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Account, Tenant
from models.dataset import Pipeline
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentAttachmentWriter
from services.file_service import FileService
from services.knowledge.documents.contracts import DocumentIndexingExecutionClaimLostError
from services.knowledge.indexing.adapters.execution import PipelineIndexProcessor, PipelineSummaryIndexDispatcher
from services.knowledge.indexing.adapters.redis_lock import RedisKnowledgeIndexingLock
from services.knowledge.indexing.contracts import DocumentIndexingExecution
from services.knowledge.indexing.errors import DocumentIndexingGenerationChangedError
from services.knowledge.indexing.locks import (
    KnowledgeIndexingLease,
    KnowledgeIndexingLeaseLostError,
    KnowledgeIndexingLockBusyError,
    dataset_index_lock_name,
    document_index_lock_name,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit
from services.rag_pipeline.entities import (
    RagPipelineInvokeBatch,
    RagPipelineInvokeEntity,
    RagPipelineWorkflowSnapshot,
)
from services.rag_pipeline.payload_recovery import (
    PipelinePayloadRecoveryMetadataMissingError,
    persist_pipeline_payload_recovery,
)
from services.rag_pipeline.tenant_task_queue import (
    RAG_PIPELINE_PRIORITY_V2_QUEUE,
    RagPipelinePermanentTaskError,
    RagPipelineTaskClaimAlreadyActiveError,
    RagPipelineTaskClaimLostError,
    RagPipelineTaskCompletion,
    RagPipelineTaskExecutionBudgetExhaustedError,
    RagPipelineTenantTaskQueue,
    dispatch_rag_pipeline_claims,
)
from services.rag_pipeline.workflow_snapshot import restore_workflow
from services.workflow_run_agg import WorkflowRunAgg

logger = logging.getLogger(__name__)

# Each entry is validated into RagPipelineInvokeEntity inside the worker.
_INVOKE_ENTITIES_ADAPTER = TypeAdapter(list[dict[str, Any]])
_LOCK_RETRY_DELAY_SECONDS = 10
_RECOVERY_RETRY_DELAY_SECONDS = 60


def _persist_claim_recovery(queue: RagPipelineTenantTaskQueue, receipt: str, tenant_id: str) -> None:
    documents = SQLAlchemyDocumentRepository(
        session_factory=sessionmaker(bind=db.engine, expire_on_commit=False),
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
    )
    persist_pipeline_payload_recovery(
        queue=queue,
        receipt=receipt,
        tenant_id=tenant_id,
        documents=documents,
    )


def _dispatch_priority_rag_pipeline_batch(
    rag_pipeline_invoke_entities_file_id: str,
    tenant_id: str,
    tenant_queue_receipt: str | None = None,
) -> None:
    if tenant_queue_receipt is None:
        _run_priority_rag_pipeline_batch(rag_pipeline_invoke_entities_file_id, tenant_id, tenant_queue_receipt=None)
        return

    queue = RagPipelineTenantTaskQueue(tenant_id)
    try:
        with queue.maintain(tenant_queue_receipt):
            _run_priority_rag_pipeline_batch(
                rag_pipeline_invoke_entities_file_id,
                tenant_id,
                tenant_queue_receipt=tenant_queue_receipt,
            )
    except (RagPipelineTaskClaimAlreadyActiveError, RagPipelineTaskClaimLostError):
        logger.info("Skipping inactive or duplicate RAG pipeline queue claim: %s", tenant_queue_receipt)
    except RagPipelineTaskExecutionBudgetExhaustedError:
        try:
            _persist_claim_recovery(queue, tenant_queue_receipt, tenant_id)
        except PipelinePayloadRecoveryMetadataMissingError as error:
            if not queue.defer_exhausted(
                tenant_queue_receipt,
                delay_seconds=_RECOVERY_RETRY_DELAY_SECONDS,
                error=f"legacy pipeline payload retry pending: {error}",
                refund_attempt=True,
            ):
                raise RagPipelineTaskClaimLostError(
                    "RAG pipeline queue claim was lost while deferring legacy priority payload retry: "
                    f"{tenant_queue_receipt}"
                ) from error
            logger.info("Deferred exhausted legacy priority RAG pipeline claim for another payload read")
            db.session.close()
            return
        except Exception as error:
            if not queue.defer_exhausted(
                tenant_queue_receipt,
                delay_seconds=_RECOVERY_RETRY_DELAY_SECONDS,
                error=f"pipeline payload recovery pending: {error}",
            ):
                raise RagPipelineTaskClaimLostError(
                    f"RAG pipeline queue claim was lost while deferring terminal recovery: {tenant_queue_receipt}"
                ) from error
            logger.exception("Deferred exhausted priority RAG pipeline claim until document recovery is durable")
            db.session.close()
            return
        completion = queue.dead_letter(
            tenant_queue_receipt,
            concurrency=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY,
            error="execution budget exhausted",
        )
        dispatch_rag_pipeline_claims(tenant_id=tenant_id, queue=queue, claims=completion.next_claims)
        if completion.owned:
            FileService(db.engine).delete_file(rag_pipeline_invoke_entities_file_id)
        db.session.close()
    except KnowledgeIndexingLockBusyError:
        logger.info("Requeued busy priority RAG pipeline claim: %s", tenant_queue_receipt)


@shared_task(
    queue="priority_pipeline",
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(KnowledgeIndexingLockBusyError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def priority_rag_pipeline_run_task(
    rag_pipeline_invoke_entities_file_id: str,
    tenant_id: str,
    tenant_queue_receipt: str | None = None,
) -> None:
    """Consume the legacy list payload from the rolling-upgrade queue."""

    _dispatch_priority_rag_pipeline_batch(rag_pipeline_invoke_entities_file_id, tenant_id, tenant_queue_receipt)


@shared_task(
    queue=RAG_PIPELINE_PRIORITY_V2_QUEUE,
    acks_late=True,
    reject_on_worker_lost=True,
    autoretry_for=(KnowledgeIndexingLockBusyError,),
    retry_backoff=True,
    retry_kwargs={"max_retries": 10},
)
def priority_rag_pipeline_run_task_v2(
    rag_pipeline_invoke_entities_file_id: str,
    tenant_id: str,
    tenant_queue_receipt: str | None = None,
) -> None:
    """Consume the snapshot-batch payload from the version-isolated queue."""

    _dispatch_priority_rag_pipeline_batch(rag_pipeline_invoke_entities_file_id, tenant_id, tenant_queue_receipt)


def _run_priority_rag_pipeline_batch(
    rag_pipeline_invoke_entities_file_id: str,
    tenant_id: str,
    *,
    tenant_queue_receipt: str | None,
) -> None:
    """
    Async Run rag pipeline task using high priority queue.

    :param rag_pipeline_invoke_entities_file_id: File ID containing serialized RAG pipeline invoke entities
    :param tenant_id: Tenant ID for the pipeline execution
    """
    # run with threading, thread pool size is 10

    succeeded = False
    permanent_error: RagPipelinePermanentTaskError | None = None
    deferred = False
    try:
        start_at = time.perf_counter()
        rag_pipeline_invoke_entities_content = FileService(db.engine).get_file_content(
            rag_pipeline_invoke_entities_file_id
        )
        try:
            invoke_batch = RagPipelineInvokeBatch.model_validate_json(rag_pipeline_invoke_entities_content)
        except ValidationError:
            try:
                rag_pipeline_invoke_entities = _INVOKE_ENTITIES_ADAPTER.validate_json(
                    rag_pipeline_invoke_entities_content
                )
            except ValidationError as error:
                raise RagPipelinePermanentTaskError("RAG pipeline batch payload is invalid") from error
            workflow_snapshot = None
        else:
            rag_pipeline_invoke_entities = [entity.model_dump() for entity in invoke_batch.invoke_entities]
            workflow_snapshot = invoke_batch.workflow_snapshot
        pipeline_execution_id = tenant_queue_receipt or str(uuid.uuid4())

        logger.info("tenant %s received %d rag pipeline invoke entities", tenant_id, len(rag_pipeline_invoke_entities))

        # Get Flask app object for thread context
        flask_app = current_app._get_current_object()  # type: ignore

        try:
            parsed_entities = [RagPipelineInvokeEntity.model_validate(item) for item in rag_pipeline_invoke_entities]
            dataset_ids = {
                RagPipelineGenerateEntity.model_validate(item.application_generate_entity).dataset_id
                for item in parsed_entities
            }
        except ValidationError as error:
            raise RagPipelinePermanentTaskError("RAG pipeline invoke entity is invalid") from error
        locks = RedisKnowledgeIndexingLock(redis=redis_client)
        with ExitStack() as dataset_lock_stack:
            dataset_leases = {
                dataset_id: dataset_lock_stack.enter_context(
                    locks.hold(dataset_index_lock_name(dataset_id), timeout=600, blocking_timeout=30)
                )
                for dataset_id in sorted(dataset_ids)
            }
            with ThreadPoolExecutor(max_workers=10) as executor:
                futures = []
                for rag_pipeline_invoke_entity, parsed_entity in zip(
                    rag_pipeline_invoke_entities, parsed_entities, strict=True
                ):
                    entity = RagPipelineGenerateEntity.model_validate(parsed_entity.application_generate_entity)
                    future = executor.submit(
                        run_single_rag_pipeline_task,
                        rag_pipeline_invoke_entity,
                        flask_app,
                        workflow_snapshot,
                        dataset_leases[entity.dataset_id],
                        pipeline_execution_id,
                    )
                    futures.append(future)

                failures: list[Exception] = []
                for future in futures:
                    try:
                        future.result()
                    except Exception as error:
                        logging.exception("Error in pipeline task")
                        failures.append(error)
                if failures:
                    lock_busy = next(
                        (error for error in failures if isinstance(error, KnowledgeIndexingLockBusyError)),
                        None,
                    )
                    if lock_busy is not None:
                        raise lock_busy
                    if all(isinstance(error, RagPipelinePermanentTaskError) for error in failures):
                        raise RagPipelinePermanentTaskError(
                            "Every failed RAG pipeline item is permanently invalid"
                        ) from ExceptionGroup("Permanent RAG pipeline item failures", failures)
                    raise ExceptionGroup("One or more RAG pipeline runs failed", failures)
        succeeded = True
        end_at = time.perf_counter()
        logging.info(
            click.style(
                f"tenant_id: {tenant_id}, Rag pipeline run completed. Latency: {end_at - start_at}s", fg="green"
            )
        )
    except RagPipelinePermanentTaskError as error:
        permanent_error = error
        logging.exception(
            click.style(f"Permanently invalid priority rag pipeline batch, tenant_id: {tenant_id}", fg="red")
        )
    except KnowledgeIndexingLockBusyError as error:
        if tenant_queue_receipt is not None:
            deferred = True
            tenant_task_queue = RagPipelineTenantTaskQueue(tenant_id)
            if not tenant_task_queue.defer(
                tenant_queue_receipt,
                delay_seconds=_LOCK_RETRY_DELAY_SECONDS,
            ):
                raise RagPipelineTaskClaimLostError(
                    f"RAG pipeline queue claim was lost while deferring: {tenant_queue_receipt}"
                ) from error
        raise
    except Exception:
        logging.exception(click.style(f"Error running rag pipeline, tenant_id: {tenant_id}", fg="red"))
        raise
    finally:
        acknowledged = tenant_queue_receipt is None
        if tenant_queue_receipt is not None:
            tenant_task_queue = RagPipelineTenantTaskQueue(tenant_id)
            if succeeded or permanent_error is not None:
                if succeeded:
                    completion = tenant_task_queue.complete(
                        tenant_queue_receipt,
                        concurrency=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY,
                    )
                else:
                    assert permanent_error is not None
                    try:
                        _persist_claim_recovery(tenant_task_queue, tenant_queue_receipt, tenant_id)
                    except Exception as error:
                        if not tenant_task_queue.defer(
                            tenant_queue_receipt,
                            delay_seconds=_RECOVERY_RETRY_DELAY_SECONDS,
                        ):
                            raise RagPipelineTaskClaimLostError(
                                "RAG pipeline queue claim was lost while deferring permanent-failure recovery: "
                                f"{tenant_queue_receipt}"
                            ) from error
                        deferred = True
                        completion = RagPipelineTaskCompletion(owned=False, next_claims=())
                        logger.exception(
                            "Deferred permanently invalid priority RAG pipeline claim pending document recovery"
                        )
                    else:
                        completion = tenant_task_queue.dead_letter(
                            tenant_queue_receipt,
                            concurrency=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY,
                            error=str(permanent_error),
                        )
                acknowledged = completion.owned
                dispatch_rag_pipeline_claims(
                    tenant_id=tenant_id,
                    queue=tenant_task_queue,
                    claims=completion.next_claims,
                )
            elif not deferred:
                tenant_task_queue.release(tenant_queue_receipt)
        else:
            # Drain entries accepted by workers running the pre-acknowledgement protocol.
            tenant_isolated_task_queue = TenantIsolatedTaskQueue(tenant_id, "pipeline")
            next_file_ids = tenant_isolated_task_queue.pull_tasks(count=dify_config.TENANT_ISOLATED_TASK_CONCURRENCY)
            logger.info("legacy priority rag pipeline tenant queue %s next files: %s", tenant_id, next_file_ids)
            if next_file_ids:
                for next_file_id in next_file_ids:
                    tenant_isolated_task_queue.set_task_waiting_time()
                    priority_rag_pipeline_run_task.delay(  # type: ignore
                        rag_pipeline_invoke_entities_file_id=(
                            next_file_id.decode("utf-8") if isinstance(next_file_id, bytes) else next_file_id
                        ),
                        tenant_id=tenant_id,
                    )
            else:
                tenant_isolated_task_queue.delete_task_key()
        if (succeeded or permanent_error is not None) and acknowledged:
            file_service = FileService(db.engine)
            file_service.delete_file(rag_pipeline_invoke_entities_file_id)
        db.session.close()


def run_single_rag_pipeline_task(
    rag_pipeline_invoke_entity: Mapping[str, Any],
    flask_app,
    workflow_snapshot: RagPipelineWorkflowSnapshot | None = None,
    dataset_lease: KnowledgeIndexingLease | None = None,
    execution_id: str | None = None,
):
    """Run a single RAG pipeline task within Flask app context."""
    # Create Flask application context for this thread
    with flask_app.app_context():
        document_lock_stack = ExitStack()
        permanent_failure_handler: Callable[[str], None] | None = None
        try:
            rag_pipeline_invoke_entity_model = RagPipelineInvokeEntity.model_validate(rag_pipeline_invoke_entity)
            user_id = rag_pipeline_invoke_entity_model.user_id
            tenant_id = rag_pipeline_invoke_entity_model.tenant_id
            pipeline_id = rag_pipeline_invoke_entity_model.pipeline_id
            workflow_execution_id = rag_pipeline_invoke_entity_model.workflow_execution_id
            workflow_thread_pool_id = rag_pipeline_invoke_entity_model.workflow_thread_pool_id
            workflow_id = rag_pipeline_invoke_entity_model.workflow_id
            workflow_snapshot = workflow_snapshot or rag_pipeline_invoke_entity_model.workflow_snapshot
            application_generate_entity = rag_pipeline_invoke_entity_model.application_generate_entity
            if dataset_lease is None:
                raise RagPipelinePermanentTaskError("Dataset indexing lease is required")

            queued_entity = RagPipelineGenerateEntity.model_validate(application_generate_entity)
            queued_document_id = queued_entity.document_id
            if queued_document_id is None:
                raise RagPipelinePermanentTaskError("Published pipeline document ID is required")
            document_lease = document_lock_stack.enter_context(
                RedisKnowledgeIndexingLock(redis=redis_client).hold(
                    document_index_lock_name(queued_document_id),
                    timeout=600,
                    blocking_timeout=30,
                )
            )
            session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
            documents = SQLAlchemyDocumentRepository(
                session_factory=session_factory,
                wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
            )
            document_ref = DatasetRef(tenant_id, queued_entity.dataset_id).document(queued_document_id)
            execution_id = execution_id or str(uuid.uuid4())
            if not documents.claim_pipeline_indexing_execution(
                document_ref,
                execution_id=execution_id,
                expected_generation=rag_pipeline_invoke_entity_model.indexing_generation,
            ):
                logger.info("Skipping stale or completed priority pipeline document generation: %s", queued_document_id)
                return

            def assert_owned() -> None:
                dataset_lease.assert_owned()
                document_lease.assert_owned()
                documents.assert_pipeline_indexing_execution(
                    document_ref,
                    execution_id=execution_id,
                    expected_generation=rag_pipeline_invoke_entity_model.indexing_generation,
                )

            execution = DocumentIndexingExecution(
                expected_generation=rag_pipeline_invoke_entity_model.indexing_generation,
                assert_owned=assert_owned,
                execution_id=execution_id,
            )
            permanent_failure_handler = partial(documents.fail_indexing, document_ref, execution=execution)

            with Session(db.engine, expire_on_commit=False) as session:
                # Load required entities
                account = session.scalar(select(Account).where(Account.id == user_id).limit(1))
                if not account:
                    raise RagPipelinePermanentTaskError(f"Account {user_id} not found")

                tenant = session.scalar(select(Tenant).where(Tenant.id == tenant_id).limit(1))
                if not tenant:
                    raise RagPipelinePermanentTaskError(f"Tenant {tenant_id} not found")
                account.set_current_tenant_with_session(tenant, session=session)

                pipeline = session.scalar(
                    select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.tenant_id == tenant_id).limit(1)
                )
                if not pipeline:
                    raise RagPipelinePermanentTaskError(f"Pipeline {pipeline_id} not found")

                if workflow_snapshot is None:
                    workflow = session.scalar(
                        select(Workflow)
                        .where(
                            Workflow.id == workflow_id,
                            Workflow.app_id == pipeline.id,
                            Workflow.tenant_id == tenant_id,
                        )
                        .limit(1)
                    )
                    if not workflow:
                        raise RagPipelinePermanentTaskError(f"Workflow {workflow_id} not found")
                else:
                    if (
                        workflow_snapshot.id != workflow_id
                        or workflow_snapshot.app_id != pipeline.id
                        or workflow_snapshot.tenant_id != tenant_id
                    ):
                        raise RagPipelinePermanentTaskError("Workflow snapshot does not belong to this pipeline")
                    workflow = restore_workflow(workflow_snapshot)

                if workflow_execution_id is None:
                    workflow_execution_id = str(uuid.uuid4())

                # Create application generate entity from dict
                entity = queued_entity

                # Create workflow repositories
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

            attachment_writer = SQLAlchemySegmentAttachmentWriter()
            dataset_lease.assert_owned()
            document_lease.assert_owned()
            assert_owned()
            repair_stale_execution = partial(
                documents.enqueue_current_indexing_repairs,
                document_ref.dataset,
                [queued_document_id],
                actor_id=account.id,
            )
            pipeline_generator = PipelineGenerator(
                execution_driver=WorkflowRunAgg.run,
                documents=documents,
                datasource_providers=build_data_source_credentials(database_client=get_session_maker()).providers,
                attachment_writer=attachment_writer,
            )
            pipeline_generator.run(
                flask_app=flask_app,
                context=context,
                pipeline=pipeline,
                workflow=workflow,
                user=account,
                application_generate_entity=entity,
                invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
                workflow_execution_repository=workflow_execution_repository,
                workflow_node_execution_repository=workflow_node_execution_repository,
                streaming=False,
                workflow_thread_pool_id=workflow_thread_pool_id,
                index_processor=PipelineIndexProcessor(
                    attachment_writer=attachment_writer,
                    execution=execution,
                    repair_stale_execution=repair_stale_execution,
                    documents=documents,
                ),
                summary_index_service=PipelineSummaryIndexDispatcher(
                    documents=documents,
                    ref=document_ref,
                    execution=execution,
                ),
                document_failure_handler=permanent_failure_handler,
            )
        except RagPipelinePermanentTaskError as error:
            if permanent_failure_handler is not None:
                try:
                    permanent_failure_handler(str(error))
                except (
                    DocumentIndexingExecutionClaimLostError,
                    DocumentIndexingGenerationChangedError,
                    KnowledgeIndexingLeaseLostError,
                ):
                    logger.info("Skipping stale permanent priority pipeline failure result")
            logging.exception("Permanently invalid priority pipeline task")
            raise
        except Exception:
            logging.exception("Error in priority pipeline task")
            raise
        finally:
            document_lock_stack.close()

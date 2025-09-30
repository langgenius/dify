import contextvars
import json
import logging
import time
import uuid
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import click
from celery import shared_task  # type: ignore
from flask import current_app, g
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.app.entities.rag_pipeline_invoke_entities import RagPipelineInvokeEntity
from core.repositories.factory import DifyCoreRepositoryFactory
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, Tenant
from models.dataset import Pipeline
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom
from services.file_service import FileService


@shared_task(queue="pipeline")
def rag_pipeline_run_task(
    rag_pipeline_invoke_entities_file_id: str,
    tenant_id: str,
):
    """
    Async Run rag pipeline
    :param rag_pipeline_invoke_entities: Rag pipeline invoke entities
    rag_pipeline_invoke_entities include:
    :param pipeline_id: Pipeline ID
    :param user_id: User ID
    :param tenant_id: Tenant ID
    :param workflow_id: Workflow ID
    :param invoke_from: Invoke source (debugger, published, etc.)
    :param streaming: Whether to stream results
    :param datasource_type: Type of datasource
    :param datasource_info: Datasource information dict
    :param batch: Batch identifier
    :param document_id: Document ID (optional)
    :param start_node_id: Starting node ID
    :param inputs: Input parameters dict
    :param workflow_execution_id: Workflow execution ID
    :param workflow_thread_pool_id: Thread pool ID for workflow execution
    """
    # run with threading, thread pool size is 10

    try:
        start_at = time.perf_counter()
        rag_pipeline_invoke_entities_content = FileService(db.engine).get_file_content(
            rag_pipeline_invoke_entities_file_id
        )
        rag_pipeline_invoke_entities = json.loads(rag_pipeline_invoke_entities_content)

        # Get Flask app object for thread context
        flask_app = current_app._get_current_object()  # type: ignore

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for rag_pipeline_invoke_entity in rag_pipeline_invoke_entities:
                # Submit task to thread pool with Flask app
                future = executor.submit(run_single_rag_pipeline_task, rag_pipeline_invoke_entity, flask_app)
                futures.append(future)

            # Wait for all tasks to complete
            for future in futures:
                try:
                    future.result()  # This will raise any exceptions that occurred in the thread
                except Exception:
                    logging.exception("Error in pipeline task")
        end_at = time.perf_counter()
        logging.info(
            click.style(
                f"tenant_id: {tenant_id} , Rag pipeline run completed. Latency: {end_at - start_at}s", fg="green"
            )
        )
    except Exception:
        logging.exception(click.style(f"Error running rag pipeline, tenant_id: {tenant_id}", fg="red"))
        raise
    finally:
        tenant_self_pipeline_task_queue = f"tenant_self_pipeline_task_queue:{tenant_id}"
        tenant_pipeline_task_key = f"tenant_pipeline_task:{tenant_id}"

        # Check if there are waiting tasks in the queue
        # Use rpop to get the next task from the queue (FIFO order)
        next_file_id = redis_client.rpop(tenant_self_pipeline_task_queue)

        if next_file_id:
            # Process the next waiting task
            # Keep the flag set to indicate a task is running
            redis_client.setex(tenant_pipeline_task_key, 60 * 60, 1)
            rag_pipeline_run_task.delay(  # type: ignore
                rag_pipeline_invoke_entities_file_id=next_file_id.decode("utf-8")
                if isinstance(next_file_id, bytes)
                else next_file_id,
                tenant_id=tenant_id,
            )
        else:
            # No more waiting tasks, clear the flag
            redis_client.delete(tenant_pipeline_task_key)
        file_service = FileService(db.engine)
        file_service.delete_file(rag_pipeline_invoke_entities_file_id)
        db.session.close()


def run_single_rag_pipeline_task(rag_pipeline_invoke_entity: Mapping[str, Any], flask_app):
    """Run a single RAG pipeline task within Flask app context."""
    # Create Flask application context for this thread
    with flask_app.app_context():
        try:
            rag_pipeline_invoke_entity_model = RagPipelineInvokeEntity(**rag_pipeline_invoke_entity)
            user_id = rag_pipeline_invoke_entity_model.user_id
            tenant_id = rag_pipeline_invoke_entity_model.tenant_id
            pipeline_id = rag_pipeline_invoke_entity_model.pipeline_id
            workflow_id = rag_pipeline_invoke_entity_model.workflow_id
            streaming = rag_pipeline_invoke_entity_model.streaming
            workflow_execution_id = rag_pipeline_invoke_entity_model.workflow_execution_id
            workflow_thread_pool_id = rag_pipeline_invoke_entity_model.workflow_thread_pool_id
            application_generate_entity = rag_pipeline_invoke_entity_model.application_generate_entity

            with Session(db.engine) as session:
                # Load required entities
                account = session.query(Account).where(Account.id == user_id).first()
                if not account:
                    raise ValueError(f"Account {user_id} not found")

                tenant = session.query(Tenant).where(Tenant.id == tenant_id).first()
                if not tenant:
                    raise ValueError(f"Tenant {tenant_id} not found")
                account.current_tenant = tenant

                pipeline = session.query(Pipeline).where(Pipeline.id == pipeline_id).first()
                if not pipeline:
                    raise ValueError(f"Pipeline {pipeline_id} not found")

                workflow = session.query(Workflow).where(Workflow.id == pipeline.workflow_id).first()
                if not workflow:
                    raise ValueError(f"Workflow {pipeline.workflow_id} not found")

                if workflow_execution_id is None:
                    workflow_execution_id = str(uuid.uuid4())

                # Create application generate entity from dict
                entity = RagPipelineGenerateEntity(**application_generate_entity)

                # Create workflow repositories
                session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
                workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
                    session_factory=session_factory,
                    user=account,
                    app_id=entity.app_config.app_id,
                    triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
                )

                workflow_node_execution_repository = (
                    DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
                        session_factory=session_factory,
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
                pipeline_generator._generate(  # type: ignore[attr-defined]
                    flask_app=flask_app,
                    context=context,
                    pipeline=pipeline,
                    workflow_id=workflow_id,
                    user=account,
                    application_generate_entity=entity,
                    invoke_from=InvokeFrom.PUBLISHED,
                    workflow_execution_repository=workflow_execution_repository,
                    workflow_node_execution_repository=workflow_node_execution_repository,
                    streaming=streaming,
                    workflow_thread_pool_id=workflow_thread_pool_id,
                )
        except Exception:
            logging.exception("Error in pipeline task")
            raise

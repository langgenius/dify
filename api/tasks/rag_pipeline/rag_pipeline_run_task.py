import contextvars
import logging
import threading
import time
import uuid

import click
from celery import shared_task  # type: ignore
from flask import current_app, g
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, RagPipelineGenerateEntity
from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, Tenant
from models.dataset import Pipeline
from models.enums import WorkflowRunTriggeredFrom
from models.workflow import Workflow, WorkflowNodeExecutionTriggeredFrom


@shared_task(queue="pipeline")
def rag_pipeline_run_task(
    pipeline_id: str,
    application_generate_entity: dict,
    user_id: str,
    tenant_id: str,
    workflow_id: str,
    streaming: bool,
    workflow_execution_id: str | None = None,
    workflow_thread_pool_id: str | None = None,
):
    """
    Async Run rag pipeline
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
    logging.info(click.style(f"Start run rag pipeline: {pipeline_id}", fg="green"))
    start_at = time.perf_counter()
    indexing_cache_key = f"rag_pipeline_run_{pipeline_id}_{user_id}"

    try:
        with Session(db.engine) as session:
            account = session.query(Account).filter(Account.id == user_id).first()
            if not account:
                raise ValueError(f"Account {user_id} not found")
            tenant = session.query(Tenant).filter(Tenant.id == tenant_id).first()
            if not tenant:
                raise ValueError(f"Tenant {tenant_id} not found")
            account.current_tenant = tenant

            pipeline = session.query(Pipeline).filter(Pipeline.id == pipeline_id).first()
            if not pipeline:
                raise ValueError(f"Pipeline {pipeline_id} not found")

            workflow = session.query(Workflow).filter(Workflow.id == pipeline.workflow_id).first()

            if not workflow:
                raise ValueError(f"Workflow {pipeline.workflow_id} not found")

            if workflow_execution_id is None:
                workflow_execution_id = str(uuid.uuid4())

            # Create application generate entity from dict
            entity = RagPipelineGenerateEntity(**application_generate_entity)

            # Create workflow node execution repository
            session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
            workflow_execution_repository = SQLAlchemyWorkflowExecutionRepository(
                session_factory=session_factory,
                user=account,
                app_id=entity.app_config.app_id,
                triggered_from=WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
            )

            workflow_node_execution_repository = SQLAlchemyWorkflowNodeExecutionRepository(
                session_factory=session_factory,
                user=account,
                app_id=entity.app_config.app_id,
                triggered_from=WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN,
            )
            # Use app context to ensure Flask globals work properly
            with current_app.app_context():
                # Set the user directly in g for preserve_flask_contexts
                g._login_user = account

                # Copy context for thread (after setting user)
                context = contextvars.copy_context()

                # Get Flask app object in the main thread where app context exists
                flask_app = current_app._get_current_object()  # type: ignore

                # Create a wrapper function that passes user context
                def _run_with_user_context():
                    # Don't create a new app context here - let _generate handle it
                    # Just ensure the user is available in contextvars
                    from core.app.apps.pipeline.pipeline_generator import PipelineGenerator

                    pipeline_generator = PipelineGenerator()
                    pipeline_generator._generate(
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

                # Create and start worker thread
                worker_thread = threading.Thread(target=_run_with_user_context)
                worker_thread.start()
                worker_thread.join()  # Wait for worker thread to complete

        end_at = time.perf_counter()
        logging.info(
            click.style(f"Rag pipeline run: {pipeline_id} completed. Latency: {end_at - start_at}s", fg="green")
        )
    except Exception:
        logging.exception(click.style(f"Error running rag pipeline {pipeline_id}", fg="red"))
        raise
    finally:
        redis_client.delete(indexing_cache_key)
        db.session.close()

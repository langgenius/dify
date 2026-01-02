"""
Celery tasks for asynchronous workflow execution storage operations.

These tasks provide asynchronous storage capabilities for workflow execution data,
improving performance by offloading storage operations to background workers.
"""

import json
import logging

from celery import Task, shared_task
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from core.workflow.entities.workflow_execution import WorkflowExecution
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter
from extensions.ext_database import db
from models import CreatorUserRole, WorkflowRun
from models.enums import WorkflowRunTriggeredFrom

logger = logging.getLogger(__name__)


@shared_task(queue="workflow_storage", bind=True, max_retries=3, default_retry_delay=60)
def save_workflow_execution_task(
    self,
    execution_data: dict,
    tenant_id: str,
    app_id: str,
    triggered_from: str,
    creator_user_id: str,
    creator_user_role: str,
) -> bool:
    """
    Asynchronously save or update a workflow execution to the database.

    Args:
        execution_data: Serialized WorkflowExecution data
        tenant_id: Tenant ID for multi-tenancy
        app_id: Application ID
        triggered_from: Source of the execution trigger
        creator_user_id: ID of the user who created the execution
        creator_user_role: Role of the user who created the execution

    Returns:
        True if successful, False otherwise
    """
    try:
        # Create a new session for this task
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

        with session_factory() as session:
            # Deserialize execution data
            execution = WorkflowExecution.model_validate(execution_data)

            # Check if workflow run already exists
            existing_run = session.scalar(select(WorkflowRun).where(WorkflowRun.id == execution.id_))

            if existing_run:
                # Update existing workflow run
                _update_workflow_run_from_execution(existing_run, execution)
                logger.debug("Updated existing workflow run: %s", execution.id_)
            else:
                # Create new workflow run
                workflow_run = _create_workflow_run_from_execution(
                    execution=execution,
                    tenant_id=tenant_id,
                    app_id=app_id,
                    triggered_from=WorkflowRunTriggeredFrom(triggered_from),
                    creator_user_id=creator_user_id,
                    creator_user_role=CreatorUserRole(creator_user_role),
                )
                session.add(workflow_run)
                logger.debug("Created new workflow run: %s", execution.id_)

            session.commit()
            return True

    except Exception as e:
        logger.exception("Failed to save workflow execution %s", execution_data.get("id_", "unknown"))
        # Retry the task with exponential backoff
        raise self.retry(exc=e, countdown=60 * (2**self.request.retries))


def _create_workflow_run_from_execution(
    execution: WorkflowExecution,
    tenant_id: str,
    app_id: str,
    triggered_from: WorkflowRunTriggeredFrom,
    creator_user_id: str,
    creator_user_role: CreatorUserRole,
) -> WorkflowRun:
    """
    Create a WorkflowRun database model from a WorkflowExecution domain entity.
    """
    workflow_run = WorkflowRun()
    workflow_run.id = execution.id_
    workflow_run.tenant_id = tenant_id
    workflow_run.app_id = app_id
    workflow_run.workflow_id = execution.workflow_id
    workflow_run.type = execution.workflow_type.value
    workflow_run.triggered_from = triggered_from.value
    workflow_run.version = execution.workflow_version
    json_converter = WorkflowRuntimeTypeConverter()
    workflow_run.graph = json.dumps(json_converter.to_json_encodable(execution.graph))
    workflow_run.inputs = json.dumps(json_converter.to_json_encodable(execution.inputs))
    workflow_run.status = execution.status.value
    workflow_run.outputs = (
        json.dumps(json_converter.to_json_encodable(execution.outputs)) if execution.outputs else "{}"
    )
    workflow_run.error = execution.error_message
    workflow_run.elapsed_time = execution.elapsed_time
    workflow_run.total_tokens = execution.total_tokens
    workflow_run.total_steps = execution.total_steps
    workflow_run.created_by_role = creator_user_role.value
    workflow_run.created_by = creator_user_id
    workflow_run.created_at = execution.started_at
    workflow_run.finished_at = execution.finished_at

    return workflow_run


def _update_workflow_run_from_execution(workflow_run: WorkflowRun, execution: WorkflowExecution):
    """
    Update a WorkflowRun database model from a WorkflowExecution domain entity.
    """
    json_converter = WorkflowRuntimeTypeConverter()
    workflow_run.status = execution.status.value
    workflow_run.outputs = (
        json.dumps(json_converter.to_json_encodable(execution.outputs)) if execution.outputs else "{}"
    )
    workflow_run.error = execution.error_message
    workflow_run.elapsed_time = execution.elapsed_time
    workflow_run.total_tokens = execution.total_tokens
    workflow_run.total_steps = execution.total_steps
    workflow_run.finished_at = execution.finished_at


@shared_task(queue="workflow", bind=True, max_retries=3, rate_limit="10")  # Max 10 tasks/minute
def workflow_resume_task(
    self: Task,
    app_id: str,
    workflow_id: str,
    workflow_run_id: str,
    state_json: str,
    resume_reason: str,
    user_id: str,
    action: str,
    paused_node_id: str,
) -> dict[str, str | None]:
    """
    Resume a paused workflow execution in the background.

    This task loads the saved workflow state and resumes execution
    from where it was paused.

    Args:
        app_id: Application ID
        workflow_id: Workflow ID
        workflow_run_id: Workflow run ID
        state_json: Serialized workflow state (JSON string)
        resume_reason: Reason for resuming
        user_id: User ID who triggered the resume
        action: Action to take (approve or reject)
        paused_node_id: ID of the paused HumanInput node

    Returns:
        Dict with resumption result

    Note:
        Rate limit is set to 10 tasks/minute to prevent overwhelming the system
        with concurrent resume operations.
    """
    from datetime import UTC, datetime

    from dataclasses import dataclass
    from sqlalchemy import select
    from sqlalchemy.orm import sessionmaker

    from core.app.apps.workflow.workflow_resumption_service import WorkflowResumptionService
    from core.workflow.enums import WorkflowExecutionStatus
    from core.workflow.graph_events.graph import (
        GraphRunFailedEvent,
        GraphRunPartialSucceededEvent,
        GraphRunPausedEvent,
        GraphRunSucceededEvent,
    )
    from extensions.ext_redis import redis_client
    from models import Account, App, EndUser, Workflow, WorkflowRun
    from models.engine import db
    from models.enums import WorkflowRunTriggeredFrom

    # Create a simple signal-like object for the service
    @dataclass
    class _CeleryResumeSignal:
        """Adapter for Celery task parameters to ResumeSignal interface."""
        action: str
        reason: str
        user_id: str
        paused_node_id: str

    signal = _CeleryResumeSignal(
        action=action,
        reason=resume_reason,
        user_id=user_id,
        paused_node_id=paused_node_id,
    )

    try:
        logger.info("Starting workflow resumption for run %s", workflow_run_id)

        # Create session factory for this task
        session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)

        # Idempotency check: verify workflow run is still in a resumable state
        with session_factory() as session:
            workflow_run_check = session.get(WorkflowRun, workflow_run_id)
            if not workflow_run_check:
                logger.error("Workflow run %s not found", workflow_run_id)
                return {
                    "result": "error",
                    "workflow_run_id": workflow_run_id,
                    "error": "Workflow run not found",
                }

            # Check if already in a final state (idempotency)
            if workflow_run_check.status in {
                WorkflowExecutionStatus.SUCCEEDED.value,
                WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
                WorkflowExecutionStatus.FAILED.value,
            }:
                logger.info(
                    "Workflow run %s already in final state %s, skipping resume",
                    workflow_run_id,
                    workflow_run_check.status,
                )
                return {
                    "result": "skipped",
                    "workflow_run_id": workflow_run_id,
                    "message": "Workflow already completed",
                    "final_status": workflow_run_check.status,
                }

            # Log current state for debugging
            logger.info(
                "Workflow run %s is in state %s, proceeding with resume",
                workflow_run_id,
                workflow_run_check.status,
            )
            # Expected states: PAUSED (normal case) or RUNNING (if resume already started)
            # This allows idempotency if the resume task is retried

        # Load workflow and app from database
        with session_factory() as session:
            workflow = session.execute(select(Workflow).where(Workflow.id == workflow_id)).scalar_one()
            _ = session.execute(select(App).where(App.id == app_id)).scalar_one()
            workflow_run = session.execute(select(WorkflowRun).where(WorkflowRun.id == workflow_run_id)).scalar_one()
            # Detach objects from session to use outside
            session.expunge_all()

        # Create resumption service
        resumption_service = WorkflowResumptionService(
            session_factory=session_factory,
            workflow=workflow,
        )

        # Parse resumption context
        from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext

        resumption_context = WorkflowResumptionContext.loads(state_json)

        # Restore graph runtime state
        from core.workflow.runtime import GraphRuntimeState

        graph_runtime_state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)

        # Get the original generate entity
        generate_entity = resumption_context.get_generate_entity()

        # Create graph components using service
        graph, command_channel, user_from, _ = resumption_service.create_graph_components(
            resumption_context=resumption_context,
            graph_runtime_state=graph_runtime_state,
            user_id=user_id,
        )

        # Apply resume signal using service
        resumption_service.apply_resume_signal(
            graph_runtime_state=graph_runtime_state,
            signal=signal,
        )

        # Get user for repository initialization
        user: Account | EndUser
        with session_factory() as session:
            account = session.execute(select(Account).where(Account.id == user_id)).scalar_one_or_none()
            if account:
                user = account
                session.expunge(account)
                # Set tenant_id for the account so extract_tenant_id can get it
                user.set_tenant_id(workflow.tenant_id)
            else:
                end_user = session.execute(select(EndUser).where(EndUser.id == user_id)).scalar_one_or_none()
                if end_user:
                    user = end_user
                    session.expunge(end_user)
                else:
                    raise ValueError(f"User not found: {user_id}")

        # Determine triggered_from based on workflow_run
        triggered_from = WorkflowRunTriggeredFrom(workflow_run.triggered_from)

        # Add persistence layer for resume
        # We need to persist workflow and node execution events to the database
        from core.app.layers.pause_state_persist_layer import PauseStatePersistenceLayer
        from core.repositories.sqlalchemy_workflow_execution_repository import (
            SQLAlchemyWorkflowExecutionRepository,
        )
        from core.repositories.sqlalchemy_workflow_node_execution_repository import (
            SQLAlchemyWorkflowNodeExecutionRepository,
        )
        from core.workflow.enums import WorkflowType
        from core.workflow.graph_engine.layers.persistence import (
            PersistenceWorkflowInfo,
            WorkflowResumePersistenceLayer,
        )
        from core.workflow.workflow_entry import WorkflowEntry
        from models import WorkflowNodeExecutionTriggeredFrom

        workflow_execution_repository = SQLAlchemyWorkflowExecutionRepository(
            session_factory=session_factory,
            user=user,
            app_id=app_id,
            triggered_from=triggered_from,
        )

        workflow_node_execution_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            user=user,
            app_id=app_id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Get the paused node execution record to update instead of creating a new one
        paused_node_execution = None
        if paused_node_id:
            from core.workflow.entities import WorkflowNodeExecution
            from core.workflow.enums import NodeType, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
            from models import WorkflowNodeExecutionModel

            logger.info(
                "Searching for paused node execution: workflow_run_id=%s, node_id=%s, expected_status=%s",
                workflow_run_id,
                paused_node_id,
                WorkflowNodeExecutionStatus.PAUSED.value,
            )

            with session_factory() as session:
                # Find the paused node execution by node_id and workflow_run_id with status PAUSED
                # Order by created_at DESC to get the most recent one if multiple exist
                paused_node_model = session.execute(
                    select(WorkflowNodeExecutionModel)
                    .where(
                        WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                        WorkflowNodeExecutionModel.node_id == paused_node_id,
                        WorkflowNodeExecutionModel.status == WorkflowNodeExecutionStatus.PAUSED.value,
                    )
                    .order_by(WorkflowNodeExecutionModel.created_at.desc())
                    .limit(1)
                ).scalar_one_or_none()

                if paused_node_model:
                    logger.info(
                        "Found paused node model: id=%s, node_id=%s, status=%s",
                        paused_node_model.id,
                        paused_node_model.node_id,
                        paused_node_model.status,
                    )
                    # Convert to domain model
                    metadata = {}
                    if paused_node_model.execution_metadata:
                        raw_metadata = json.loads(paused_node_model.execution_metadata)
                        for k, v in raw_metadata.items():
                            try:
                                metadata[WorkflowNodeExecutionMetadataKey(k)] = v
                            except ValueError:
                                logger.warning("Invalid metadata key: %s", k)
                                continue

                    paused_node_execution = WorkflowNodeExecution(
                        id=paused_node_model.id,
                        node_execution_id=paused_node_model.node_execution_id,
                        workflow_id=paused_node_model.workflow_id,
                        workflow_execution_id=paused_node_model.workflow_run_id,
                        predecessor_node_id=paused_node_model.predecessor_node_id,
                        index=paused_node_model.index,
                        node_id=paused_node_model.node_id,
                        node_type=NodeType(paused_node_model.node_type),
                        title=paused_node_model.title,
                        status=WorkflowNodeExecutionStatus(paused_node_model.status),
                        metadata=metadata,
                        created_at=paused_node_model.created_at,
                        inputs=json.loads(paused_node_model.inputs) if paused_node_model.inputs else None,
                        process_data=json.loads(paused_node_model.process_data)
                        if paused_node_model.process_data
                        else None,
                        outputs=json.loads(paused_node_model.outputs) if paused_node_model.outputs else None,
                        error=paused_node_model.error,
                    )
                    logger.info(
                        "Created paused_node_execution domain object: id=%s, node_id=%s",
                        paused_node_execution.id,
                        paused_node_execution.node_id,
                    )
                else:
                    logger.warning(
                        "Could not find paused node execution: workflow_run_id=%s, node_id=%s",
                        workflow_run_id,
                        paused_node_id,
                    )
                    # Log all node executions for this workflow run to debug (only in debug mode)
                    if logger.isEnabledFor(logging.DEBUG):
                        all_executions = (
                            session.execute(
                                select(WorkflowNodeExecutionModel).where(
                                    WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                                )
                            )
                            .scalars()
                            .all()
                        )
                        for exec_model in all_executions:
                            logger.debug(
                                "  Existing node execution: id=%s, node_id=%s, status=%s, node_type=%s",
                                exec_model.id,
                                exec_model.node_id,
                                exec_model.status,
                                exec_model.node_type,
                            )

                    # Raise error to fail fast instead of continuing with None
                    raise ValueError(
                        f"Paused node execution not found: workflow_run_id={workflow_run_id}, "
                        f"node_id={paused_node_id}, expected_status={WorkflowNodeExecutionStatus.PAUSED.value}"
                    )

        # Create workflow entry for resumption using service
        workflow_entry = resumption_service.create_workflow_entry(
            graph=graph,
            command_channel=command_channel,
            user_from=user_from,
            generate_entity=generate_entity,
            graph_runtime_state=graph_runtime_state,
            signal=signal,
            add_pause_state_layer=False,  # Will use WorkflowResumePersistenceLayer instead
        )

        persistence_layer = WorkflowResumePersistenceLayer(
            application_generate_entity=generate_entity,
            workflow_info=PersistenceWorkflowInfo(
                workflow_id=workflow.id,
                workflow_type=WorkflowType(workflow.type),
                version=workflow.version,
                graph_data=workflow.graph_dict,
            ),
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            existing_execution_id=workflow_run_id,
            existing_started_at=workflow_run.created_at,
            existing_inputs=workflow_run.inputs_dict or {},
            paused_node_id=paused_node_id,
            paused_node_execution=paused_node_execution,
            trace_manager=None,  # Trace manager not available in background task
        )

        # Add PauseStatePersistenceLayer to handle pauses during resume
        # This ensures that if the workflow pauses again (e.g., second human-input node),
        # a new WorkflowPause record is created with resumed_at=NULL
        pause_state_persist_layer = PauseStatePersistenceLayer(
            session_factory=session_factory,
            generate_entity=generate_entity,
            state_owner_user_id=user_id,
        )

        # Add both layers to the graph engine
        workflow_entry.graph_engine.layer(persistence_layer)
        workflow_entry.graph_engine.layer(pause_state_persist_layer)

        # Execute workflow from paused state
        # The GraphEngine will detect that execution.started is True
        # and will resume from paused nodes
        final_status = None
        final_outputs = None
        final_error = None

        for event in workflow_entry.run():
            logger.debug("Resume event: %s", type(event).__name__)
            if isinstance(event, GraphRunSucceededEvent):
                final_status = WorkflowExecutionStatus.SUCCEEDED
                final_outputs = event.outputs
            elif isinstance(event, GraphRunPartialSucceededEvent):
                final_status = WorkflowExecutionStatus.PARTIAL_SUCCEEDED
                final_outputs = event.outputs
            elif isinstance(event, GraphRunFailedEvent):
                final_status = WorkflowExecutionStatus.FAILED
                final_error = event.error
            elif isinstance(event, GraphRunPausedEvent):
                # Workflow paused again during resume (e.g., second human_input node)
                # The WorkflowResumePersistenceLayer has already saved the PAUSED status
                # Mark this as a paused state so we don't override it
                final_status = WorkflowExecutionStatus.PAUSED
                logger.info(
                    "Workflow run %s paused again during resume at node %s",
                    workflow_run_id,
                    event.reasons[0].node_id if event.reasons else "unknown",
                )
                # Break the loop since workflow is paused
                break

        # Update workflow run status in database
        with session_factory() as session:
            workflow_run = session.get(WorkflowRun, workflow_run_id)
            if workflow_run:
                if final_status:
                    # Only update status if it's different from current status
                    # This avoids unnecessary database writes and potential race conditions
                    if workflow_run.status != final_status.value:
                        workflow_run.status = final_status.value

                    # For final states (SUCCEEDED, FAILED, PARTIAL_SUCCEEDED), set completion metadata
                    if final_status in {
                        WorkflowExecutionStatus.SUCCEEDED,
                        WorkflowExecutionStatus.FAILED,
                        WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
                    }:
                        if final_outputs:
                            workflow_run.outputs = json.dumps(final_outputs)
                        if final_error:
                            workflow_run.error = final_error
                        finished_at = datetime.now(UTC).replace(tzinfo=None)
                        workflow_run.finished_at = finished_at
                        # created_at is non-nullable in the model
                        created_at = workflow_run.created_at
                        if created_at is not None:
                            workflow_run.elapsed_time = (finished_at - created_at).total_seconds()
                session.commit()

        logger.info("Workflow run %s finished resume task with status %s", workflow_run_id, final_status)

        # Determine appropriate message based on final status
        if final_status == WorkflowExecutionStatus.PAUSED:
            message = "Workflow paused again during resume"
        elif final_status:
            message = "Workflow resumed successfully"
        else:
            message = "Workflow resume completed"

        return {
            "result": "success",
            "workflow_run_id": workflow_run_id,
            "message": message,
            "final_status": final_status.value if final_status else None,
        }

    except Exception as e:
        logger.error("Failed to resume workflow %s: %s", workflow_run_id, str(e), exc_info=True)

        # Update workflow run status to failed
        try:
            error_session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
            with error_session_factory() as session:
                workflow_run = session.get(WorkflowRun, workflow_run_id)
                if workflow_run:
                    # Only update if not already in a final state
                    if workflow_run.status in {
                        WorkflowExecutionStatus.SUCCEEDED.value,
                        WorkflowExecutionStatus.PARTIAL_SUCCEEDED.value,
                        WorkflowExecutionStatus.FAILED.value,
                    }:
                        logger.info(
                            "Workflow %s already in final state %s, not updating error",
                            workflow_run_id,
                            workflow_run.status,
                        )
                    else:
                        workflow_run.status = WorkflowExecutionStatus.FAILED.value
                        workflow_run.error = f"Resume failed: {str(e)}"
                        workflow_run.finished_at = datetime.now(UTC).replace(tzinfo=None)
                        session.commit()
        except Exception:
            logger.exception("Failed to update workflow run status for %s", workflow_run_id)

        # Retry the task with exponential backoff if retries are available
        max_retries = self.max_retries if self.max_retries is not None else 3
        if self.request.retries < max_retries:
            # Use exponential backoff: 60s, 120s, 240s
            countdown = 60 * (2**self.request.retries)
            logger.info("Retrying workflow resume task for %s in %d seconds", workflow_run_id, countdown)
            raise self.retry(exc=e, countdown=countdown)

        return {
            "result": "error",
            "workflow_run_id": workflow_run_id,
            "error": str(e),
        }

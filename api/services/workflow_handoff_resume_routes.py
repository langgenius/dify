from __future__ import annotations

from collections.abc import Generator
from datetime import UTC, datetime

from flask import g
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig, WorkflowResumptionContext
from core.app.layers.trigger_post_layer import TriggerPostLayer
from core.app.layers.workflow_handoff_resume_layer import WorkflowHandoffResumeAcknowledgementLayer
from core.repositories import DifyCoreRepositoryFactory
from extensions.ext_database import db
from extensions.ext_storage import storage
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import GraphRuntimeState
from graphon.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader
from libs.datetime_utils import naive_utc_now
from libs.flask_utils import set_login_user
from models.account import Account
from models.dataset import Document, Pipeline
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.model import App, AppMode, Conversation, EndUser, Message, Tenant
from models.snippet import CustomizedSnippet
from models.trigger import WorkflowTriggerLog
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from models.workflow_handoff import WorkflowHandoffResumeRoute
from repositories.workflow_handoff_repository import WorkflowHandoffTerminalScope
from services.snippet_generate_service import SnippetGenerateService
from services.workflow_draft_variable_service import DraftVarLoader
from services.workflow_handoff_resume_coordinator import (
    MappingWorkflowHandoffResumeDispatcher,
    PermanentWorkflowHandoffResumeError,
    WorkflowHandoffResumeRequest,
)
from services.workflow_handoff_terminal_service import WorkflowHandoffTerminalService
from tasks.app_generate.workflow_execute_task import (
    WorkflowStreamTerminalFailure,
    WorkflowStreamTerminalFailureHandler,
    _publish_streaming_response,
)
from tasks.workflow_cfs_scheduler.cfs_scheduler import AsyncWorkflowCFSPlanEntity
from tasks.workflow_cfs_scheduler.entities import AsyncWorkflowQueue, AsyncWorkflowSystemStrategy


def create_workflow_handoff_resume_dispatcher() -> MappingWorkflowHandoffResumeDispatcher:
    """Build the business resumers behind the generic fenced claim task."""
    return MappingWorkflowHandoffResumeDispatcher(
        {
            WorkflowHandoffResumeRoute.WORKFLOW: _resume_workflow_handoff,
            WorkflowHandoffResumeRoute.SNIPPET: _resume_snippet_handoff,
            WorkflowHandoffResumeRoute.ADVANCED_CHAT: _resume_advanced_chat_handoff,
            WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW: _resume_triggered_workflow_handoff,
            WorkflowHandoffResumeRoute.RAG_PIPELINE: _resume_rag_pipeline_handoff,
        }
    )


def _load_context(
    request: WorkflowHandoffResumeRequest,
) -> tuple[
    WorkflowResumptionContext,
    WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
    GraphRuntimeState,
]:
    # Creation can be disabled independently during a rollout, but an already
    # durable handoff must never resume onto a lossy event transport. Without
    # Redis Streams, reconnecting clients could silently miss the resumed
    # segment, so treat this as an incompatible runtime and fail closed.
    if dify_config.PUBSUB_REDIS_CHANNEL_TYPE != "streams":
        raise PermanentWorkflowHandoffResumeError(
            "Workflow handoff resumption requires EVENT_BUS_REDIS_CHANNEL_TYPE=streams"
        )
    try:
        context = WorkflowResumptionContext.loads(request.serialized_state.decode())
        generate_entity = context.get_generate_entity()
        graph_runtime_state = GraphRuntimeState.from_snapshot(context.serialized_graph_runtime_state)
    except Exception as error:
        raise PermanentWorkflowHandoffResumeError("Invalid workflow handoff resumption context") from error

    if generate_entity.task_id != request.handoff.task_id:
        raise PermanentWorkflowHandoffResumeError("Workflow handoff task identity does not match its checkpoint")

    entity_run_id = (
        generate_entity.workflow_run_id
        if isinstance(generate_entity, AdvancedChatAppGenerateEntity)
        else generate_entity.workflow_execution_id
    )
    if entity_run_id != request.handoff.workflow_run_id:
        raise PermanentWorkflowHandoffResumeError("Workflow handoff run identity does not match its checkpoint")
    # A resumed segment has no original blocking HTTP request to return to.
    # Always expose its events through the durable per-run continuation stream;
    # the original response mode remains relevant only to the source segment's
    # public 202/streaming response contract.
    generate_entity = generate_entity.model_copy(update={"stream": True})
    context.apply_handoff_execution_timing()
    return context, generate_entity, graph_runtime_state


def _load_run_dependencies(
    session: Session,
    request: WorkflowHandoffResumeRequest,
) -> tuple[WorkflowRun, Workflow, Account | EndUser]:
    workflow_run = session.get(WorkflowRun, request.handoff.workflow_run_id)
    if workflow_run is None:
        raise PermanentWorkflowHandoffResumeError("Workflow run no longer exists")
    if workflow_run.status != WorkflowExecutionStatus.RUNNING:
        raise PermanentWorkflowHandoffResumeError(f"Workflow run is no longer resumable: status={workflow_run.status}")

    workflow = session.get(Workflow, workflow_run.workflow_id)
    if workflow is None:
        raise PermanentWorkflowHandoffResumeError("Workflow definition no longer exists")
    _validate_owned_resource(
        "Workflow definition",
        {
            "tenant": (workflow.tenant_id, workflow_run.tenant_id),
            "app": (workflow.app_id, workflow_run.app_id),
            "workflow": (workflow.id, workflow_run.workflow_id),
        },
    )
    user = _resolve_user(session, workflow_run)
    return workflow_run, workflow, user


def _validate_entity_identity(
    *,
    generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
    workflow_run: WorkflowRun,
    workflow: Workflow,
) -> None:
    app_config = generate_entity.app_config
    mismatches = {
        "tenant": (app_config.tenant_id, workflow_run.tenant_id),
        "app": (app_config.app_id, workflow_run.app_id),
        "workflow": (app_config.workflow_id, workflow_run.workflow_id),
        "user": (generate_entity.user_id, workflow_run.created_by),
        "workflow_definition": (workflow.id, workflow_run.workflow_id),
    }
    invalid = [name for name, (snapshot_value, run_value) in mismatches.items() if snapshot_value != run_value]
    if invalid:
        raise PermanentWorkflowHandoffResumeError(f"Workflow handoff identity mismatch: {', '.join(sorted(invalid))}")


def _validate_owned_resource(resource: str, identities: dict[str, tuple[object, object]]) -> None:
    invalid = [name for name, (resource_value, run_value) in identities.items() if resource_value != run_value]
    if invalid:
        raise PermanentWorkflowHandoffResumeError(f"{resource} ownership mismatch: {', '.join(sorted(invalid))}")


def _validate_app_ownership(app: App, workflow_run: WorkflowRun) -> None:
    _validate_owned_resource(
        "Workflow app",
        {
            "app": (app.id, workflow_run.app_id),
            "tenant": (app.tenant_id, workflow_run.tenant_id),
        },
    )


def _validate_chat_records(
    *,
    conversation: Conversation,
    message: Message,
    workflow_run: WorkflowRun,
) -> None:
    conversation_identities: dict[str, tuple[object, object]] = {
        "app": (conversation.app_id, workflow_run.app_id),
    }
    # Conversation has no tenant column in current schemas. Keep this check
    # forward-compatible for deployments that expose one without inferring
    # tenant ownership from unrelated fields.
    conversation_tenant_id = getattr(  # guard-ignore: no-new-getattr -- optional forward-schema tenant column
        conversation, "tenant_id", None
    )
    if conversation_tenant_id is not None:
        conversation_identities["tenant"] = (conversation_tenant_id, workflow_run.tenant_id)
    _validate_owned_resource("Chatflow conversation", conversation_identities)
    _validate_owned_resource(
        "Chatflow message",
        {
            "app": (message.app_id, workflow_run.app_id),
            "conversation": (message.conversation_id, conversation.id),
            "workflow_run": (message.workflow_run_id, workflow_run.id),
        },
    )


def _resolve_user(session: Session, workflow_run: WorkflowRun) -> Account | EndUser:
    tenant = session.get(Tenant, workflow_run.tenant_id)
    if tenant is None:
        raise PermanentWorkflowHandoffResumeError("Workflow tenant no longer exists")

    if workflow_run.created_by_role == CreatorUserRole.ACCOUNT:
        account = session.get(Account, workflow_run.created_by)
        if account is None:
            raise PermanentWorkflowHandoffResumeError("Workflow account no longer exists")
        account.set_current_tenant_with_session(tenant, session=session)
        return account

    end_user = session.get(EndUser, workflow_run.created_by)
    if end_user is None:
        raise PermanentWorkflowHandoffResumeError("Workflow end user no longer exists")
    return end_user


def _acknowledgement_layer(request: WorkflowHandoffResumeRequest) -> WorkflowHandoffResumeAcknowledgementLayer:
    return WorkflowHandoffResumeAcknowledgementLayer(
        repository=request.lease.repository,
        claimed_handoff=request.handoff,
    )


def _resumed_terminal_failure_handler(
    request: WorkflowHandoffResumeRequest,
    workflow_run: WorkflowRun,
) -> WorkflowStreamTerminalFailureHandler:
    service = WorkflowHandoffTerminalService(repository=request.lease.repository, storage=storage)
    scope = WorkflowHandoffTerminalScope(
        workflow_run_id=workflow_run.id,
        task_id=request.handoff.task_id,
        tenant_id=workflow_run.tenant_id,
        app_id=workflow_run.app_id,
        workflow_id=workflow_run.workflow_id,
        resume_route=request.handoff.resume_route,
    )

    def reconcile(failure: WorkflowStreamTerminalFailure) -> None:
        service.reconcile_resumed_failure(
            handoff_id=request.handoff.id,
            generation=request.handoff.generation,
            scope=scope,
            error=failure.error,
            failed_at=naive_utc_now(),
            message_answer_delta=failure.message_answer_delta,
            message_answer_replacement=failure.message_answer_replacement,
        )

    return reconcile


def _build_repositories(
    *,
    session_factory: sessionmaker[Session],
    workflow_run: WorkflowRun,
    user: Account | EndUser,
    generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
):
    triggered_from = WorkflowRunTriggeredFrom(workflow_run.triggered_from)
    workflow_execution_repository = DifyCoreRepositoryFactory.create_workflow_execution_repository(
        session_factory=session_factory,
        tenant_id=workflow_run.tenant_id,
        user=user,
        app_id=workflow_run.app_id,
        triggered_from=triggered_from,
    )
    if generate_entity.single_iteration_run is not None or generate_entity.single_loop_run is not None:
        node_triggered_from = WorkflowNodeExecutionTriggeredFrom.SINGLE_STEP
    elif triggered_from in {
        WorkflowRunTriggeredFrom.RAG_PIPELINE_RUN,
        WorkflowRunTriggeredFrom.RAG_PIPELINE_DEBUGGING,
    }:
        node_triggered_from = WorkflowNodeExecutionTriggeredFrom.RAG_PIPELINE_RUN
    else:
        node_triggered_from = WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    workflow_node_execution_repository = DifyCoreRepositoryFactory.create_workflow_node_execution_repository(
        session_factory=session_factory,
        tenant_id=workflow_run.tenant_id,
        user=user,
        app_id=workflow_run.app_id,
        triggered_from=node_triggered_from,
    )
    return workflow_execution_repository, workflow_node_execution_repository


def _trigger_layers(
    session: Session,
    workflow_run: WorkflowRun,
) -> list[TriggerPostLayer]:
    trigger_log = session.scalar(
        select(WorkflowTriggerLog).where(WorkflowTriggerLog.workflow_run_id == workflow_run.id).limit(1)
    )
    if trigger_log is None:
        return []

    _validate_owned_resource(
        "Workflow trigger log",
        {
            "tenant": (trigger_log.tenant_id, workflow_run.tenant_id),
            "app": (trigger_log.app_id, workflow_run.app_id),
            "workflow": (trigger_log.workflow_id, workflow_run.workflow_id),
            "workflow_run": (trigger_log.workflow_run_id, workflow_run.id),
        },
    )

    scheduler_entity = AsyncWorkflowCFSPlanEntity(
        queue=AsyncWorkflowQueue(trigger_log.queue_name),
        schedule_strategy=AsyncWorkflowSystemStrategy,
        granularity=dify_config.ASYNC_WORKFLOW_SCHEDULER_GRANULARITY,
    )
    # Match initial triggered execution exactly: time slicing remains disabled
    # there, so a maintenance handoff must not silently enable it on resume.
    return [TriggerPostLayer(scheduler_entity, datetime.now(UTC), trigger_log.id)]


def _resume_workflow_handoff(request: WorkflowHandoffResumeRequest) -> None:
    _resume_workflow_route(request, require_trigger_log=False)


def _resume_triggered_workflow_handoff(request: WorkflowHandoffResumeRequest) -> None:
    _resume_workflow_route(request, require_trigger_log=True)


def _resume_snippet_handoff(request: WorkflowHandoffResumeRequest) -> None:
    context, generate_entity, graph_runtime_state = _load_context(request)
    if not isinstance(generate_entity, WorkflowAppGenerateEntity) or isinstance(
        generate_entity, RagPipelineGenerateEntity
    ):
        raise PermanentWorkflowHandoffResumeError("Snippet handoff contains an incompatible generate entity")

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_factory() as session:
        workflow_run, workflow, user = _load_run_dependencies(session, request)
        _validate_entity_identity(
            generate_entity=generate_entity,
            workflow_run=workflow_run,
            workflow=workflow,
        )
        snippet = session.get(CustomizedSnippet, workflow_run.app_id)
        if snippet is None:
            raise PermanentWorkflowHandoffResumeError("Snippet no longer exists")
        _validate_owned_resource(
            "Snippet",
            {
                "snippet": (snippet.id, workflow_run.app_id),
                "tenant": (snippet.tenant_id, workflow_run.tenant_id),
            },
        )
        if workflow.kind_or_standard != WorkflowKind.SNIPPET.value:
            raise PermanentWorkflowHandoffResumeError("Workflow definition is not owned by a Snippet")

        app_model = SnippetGenerateService.build_app_model(snippet)
        workflow_execution_repository, workflow_node_execution_repository = _build_repositories(
            session_factory=session_factory,
            workflow_run=workflow_run,
            user=user,
            generate_entity=generate_entity,
        )
        variable_loader: VariableLoader = DUMMY_VARIABLE_LOADER
        if generate_entity.single_iteration_run is not None or generate_entity.single_loop_run is not None:
            variable_loader = DraftVarLoader(
                engine=db.engine,
                app_id=workflow_run.app_id,
                tenant_id=workflow_run.tenant_id,
                user_id=user.id,
            )

    set_login_user(user)
    response = WorkflowAppGenerator().resume(
        app_model=app_model,
        workflow=workflow,
        user=user,
        application_generate_entity=generate_entity,
        graph_runtime_state=graph_runtime_state,
        workflow_execution_repository=workflow_execution_repository,
        workflow_node_execution_repository=workflow_node_execution_repository,
        graph_engine_layers=[_acknowledgement_layer(request)],
        pause_state_config=PauseStateLayerConfig(
            session_factory=session_factory,
            state_owner_user_id=workflow.created_by,
        ),
        variable_loader=variable_loader,
        response_stream_filter=context.get_response_stream_filter(),
        handoff_resume_route=request.handoff.resume_route,
        graph_config=workflow_run.graph_dict,
        workflow_version=workflow_run.version,
        root_node_id=context.root_node_id,
    )
    if isinstance(response, Generator):
        _publish_streaming_response(
            SnippetGenerateService.filter_virtual_start_events(response),
            workflow_run.id,
            AppMode.WORKFLOW,
            workflow.id,
            generate_entity.inputs,
            started_reason=_resumption_reason(),
            terminal_failure_handler=_resumed_terminal_failure_handler(request, workflow_run),
        )


def _resume_workflow_route(request: WorkflowHandoffResumeRequest, *, require_trigger_log: bool) -> None:
    context, generate_entity, graph_runtime_state = _load_context(request)
    if not isinstance(generate_entity, WorkflowAppGenerateEntity) or isinstance(
        generate_entity, RagPipelineGenerateEntity
    ):
        raise PermanentWorkflowHandoffResumeError("Workflow handoff contains an incompatible generate entity")

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_factory() as session:
        workflow_run, workflow, user = _load_run_dependencies(session, request)
        _validate_entity_identity(
            generate_entity=generate_entity,
            workflow_run=workflow_run,
            workflow=workflow,
        )
        triggered_sources = {
            WorkflowRunTriggeredFrom.WEBHOOK,
            WorkflowRunTriggeredFrom.SCHEDULE,
            WorkflowRunTriggeredFrom.PLUGIN,
        }
        if (workflow_run.triggered_from in triggered_sources) != require_trigger_log:
            raise PermanentWorkflowHandoffResumeError("Workflow handoff trigger route does not match the run source")
        app_model = session.get(App, workflow_run.app_id)
        if app_model is None:
            raise PermanentWorkflowHandoffResumeError("Workflow app no longer exists")
        _validate_app_ownership(app_model, workflow_run)
        trigger_layers = _trigger_layers(session, workflow_run) if require_trigger_log else []
    if require_trigger_log and not trigger_layers:
        raise PermanentWorkflowHandoffResumeError("Triggered workflow handoff has no trigger log")

    set_login_user(user)
    workflow_execution_repository, workflow_node_execution_repository = _build_repositories(
        session_factory=session_factory,
        workflow_run=workflow_run,
        user=user,
        generate_entity=generate_entity,
    )
    layers = [_acknowledgement_layer(request), *trigger_layers]
    response = WorkflowAppGenerator().resume(
        app_model=app_model,
        workflow=workflow,
        user=user,
        application_generate_entity=generate_entity,
        graph_runtime_state=graph_runtime_state,
        workflow_execution_repository=workflow_execution_repository,
        workflow_node_execution_repository=workflow_node_execution_repository,
        graph_engine_layers=layers,
        pause_state_config=PauseStateLayerConfig(
            session_factory=session_factory,
            state_owner_user_id=workflow.created_by,
        ),
        response_stream_filter=context.get_response_stream_filter(),
        handoff_resume_route=request.handoff.resume_route,
        graph_config=workflow_run.graph_dict,
        workflow_version=workflow_run.version,
        root_node_id=context.root_node_id,
    )
    if isinstance(response, Generator):
        _publish_streaming_response(
            response,
            workflow_run.id,
            AppMode.WORKFLOW,
            workflow.id,
            generate_entity.inputs,
            started_reason=_resumption_reason(),
            terminal_failure_handler=_resumed_terminal_failure_handler(request, workflow_run),
        )


def _resume_advanced_chat_handoff(request: WorkflowHandoffResumeRequest) -> None:
    context, generate_entity, graph_runtime_state = _load_context(request)
    if not isinstance(generate_entity, AdvancedChatAppGenerateEntity):
        raise PermanentWorkflowHandoffResumeError("Chatflow handoff contains an incompatible generate entity")
    if generate_entity.conversation_id is None:
        raise PermanentWorkflowHandoffResumeError("Chatflow handoff has no conversation identity")

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_factory() as session:
        workflow_run, workflow, user = _load_run_dependencies(session, request)
        _validate_entity_identity(
            generate_entity=generate_entity,
            workflow_run=workflow_run,
            workflow=workflow,
        )
        app_model = session.get(App, workflow_run.app_id)
        conversation = session.get(Conversation, generate_entity.conversation_id)
        message = session.scalar(
            select(Message)
            .where(
                Message.conversation_id == generate_entity.conversation_id,
                Message.workflow_run_id == workflow_run.id,
            )
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        if app_model is None or conversation is None or message is None:
            raise PermanentWorkflowHandoffResumeError("Chatflow records required for resumption no longer exist")
        _validate_app_ownership(app_model, workflow_run)
        _validate_chat_records(conversation=conversation, message=message, workflow_run=workflow_run)

        set_login_user(user)
        workflow_execution_repository, workflow_node_execution_repository = _build_repositories(
            session_factory=session_factory,
            workflow_run=workflow_run,
            user=user,
            generate_entity=generate_entity,
        )
        response = AdvancedChatAppGenerator().resume(
            app_model=app_model,
            workflow=workflow,
            user=user,
            conversation=conversation,
            message=message,
            session=session,
            application_generate_entity=generate_entity,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            graph_runtime_state=graph_runtime_state,
            graph_engine_layers=[_acknowledgement_layer(request)],
            pause_state_config=PauseStateLayerConfig(
                session_factory=session_factory,
                state_owner_user_id=workflow.created_by,
            ),
            response_stream_filter=context.get_response_stream_filter(),
            handoff_resume_route=request.handoff.resume_route,
            graph_config=workflow_run.graph_dict,
            workflow_version=workflow_run.version,
            root_node_id=context.root_node_id,
        )

    if isinstance(response, Generator):
        _publish_streaming_response(
            response,
            workflow_run.id,
            AppMode.ADVANCED_CHAT,
            workflow.id,
            generate_entity.inputs,
            started_reason=_resumption_reason(),
            terminal_failure_handler=_resumed_terminal_failure_handler(request, workflow_run),
        )


def _resume_rag_pipeline_handoff(request: WorkflowHandoffResumeRequest) -> None:
    context, generate_entity, graph_runtime_state = _load_context(request)
    if not isinstance(generate_entity, RagPipelineGenerateEntity):
        raise PermanentWorkflowHandoffResumeError("RAG pipeline handoff contains an incompatible generate entity")

    session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
    with session_factory() as session:
        workflow_run, workflow, user = _load_run_dependencies(session, request)
        _validate_entity_identity(
            generate_entity=generate_entity,
            workflow_run=workflow_run,
            workflow=workflow,
        )
        pipeline = session.get(Pipeline, workflow_run.app_id)
        if pipeline is None or pipeline.tenant_id != workflow_run.tenant_id:
            raise PermanentWorkflowHandoffResumeError("RAG pipeline no longer exists")
        dataset = pipeline.retrieve_dataset(session)
        if dataset is None or dataset.id != generate_entity.dataset_id or dataset.tenant_id != workflow_run.tenant_id:
            raise PermanentWorkflowHandoffResumeError("RAG pipeline dataset identity does not match the checkpoint")
        if generate_entity.document_id is not None:
            document = session.get(Document, generate_entity.document_id)
            if (
                document is None
                or document.dataset_id != generate_entity.dataset_id
                or document.tenant_id != workflow_run.tenant_id
            ):
                raise PermanentWorkflowHandoffResumeError(
                    "RAG pipeline document identity does not match the checkpoint"
                )

        set_login_user(user)
        g._login_user = user
        workflow_execution_repository, workflow_node_execution_repository = _build_repositories(
            session_factory=session_factory,
            workflow_run=workflow_run,
            user=user,
            generate_entity=generate_entity,
        )
        response = PipelineGenerator().resume(
            session=session,
            pipeline=pipeline,
            workflow=workflow,
            user=user,
            application_generate_entity=generate_entity,
            graph_runtime_state=graph_runtime_state,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            graph_engine_layers=[_acknowledgement_layer(request)],
            pause_state_config=PauseStateLayerConfig(
                session_factory=session_factory,
                state_owner_user_id=workflow.created_by,
            ),
            response_stream_filter=context.get_response_stream_filter(),
            handoff_resume_route=request.handoff.resume_route,
            graph_config=workflow_run.graph_dict,
            workflow_version=workflow_run.version,
            root_node_id=context.root_node_id,
        )
        if isinstance(response, Generator):
            _publish_streaming_response(
                response,
                workflow_run.id,
                AppMode.RAG_PIPELINE,
                workflow.id,
                generate_entity.inputs,
                started_reason=_resumption_reason(),
                terminal_failure_handler=_resumed_terminal_failure_handler(request, workflow_run),
            )


def _resumption_reason():
    # Lazy import keeps this module's public surface focused on Dify route
    # reconstruction while preserving Graphon's strongly typed event reason.
    from graphon.entities import WorkflowStartReason

    return WorkflowStartReason.RESUMPTION


__all__ = ["create_workflow_handoff_resume_dispatcher"]

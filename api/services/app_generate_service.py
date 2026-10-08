from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable, Generator, Mapping
from typing import Any

from sqlalchemy.orm import Session

from configs import dify_config
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting import RateLimit
from core.app.features.rate_limiting.rate_limit import rate_limit_context
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.db import session_factory
from core.trigger.constants import is_trigger_node_type
from enums import DeploymentEdition, QuotaType
from extensions.otel import AppGenerateHandler, trace_span
from models.annotation_reply import AnnotationReplies
from models.model import Account, App, AppMode, EndUser
from models.workflow import Workflow
from repositories.workflow.definition_repository import WorkflowDefinitionStore
from services.app.generation.adapters.agent_app import AgentAppGenerator
from services.app.generation.adapters.agent_chat import AgentChatAppGenerator
from services.app.generation.adapters.chat import ChatAppGenerator
from services.app.generation.adapters.completion import CompletionAppGenerator
from services.app.generation.ports import ChatRecords
from services.app.generation.response import convert_to_event_stream
from services.app.generation.runtime import AppGenerationRuntime
from services.errors.app import (
    QuotaExceededError,
    TriggerWorkflowServiceModeUnavailableError,
)
from services.errors.llm import InvokeRateLimitError
from services.knowledge.retrieval.ports import DatasetRetrievalFactory
from services.quota_service import QuotaService, unlimited
from services.workflow.contracts import WorkflowSnapshot
from services.workflow.execution.adapters.chatflow.app_generator import AdvancedChatAppGenerator
from services.workflow.execution.adapters.response_stream import WorkflowEventStream
from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator
from services.workflow.stream_reservation import WorkflowStreamReservation
from services.workflow.variable_contracts import WorkflowExecutionVariables
from tasks.app_generate.workflow_execute_task import AppExecutionParams, workflow_based_app_execution_task

logger = logging.getLogger(__name__)

SSE_TASK_START_FALLBACK_MS = 200
_MANUAL_WORKFLOW_INVOKE_SOURCES = frozenset(
    {
        InvokeFrom.OPENAPI,
        InvokeFrom.SERVICE_API,
        InvokeFrom.WEB_APP,
    }
)


class AppGenerateService:
    @staticmethod
    def _build_streaming_task_on_subscribe(
        start_task: Callable[[], None],
    ) -> Callable[[], None]:
        """
        Build a subscription callback that starts the background task on first subscribe.

        Pub/Sub transports also use a short fallback timer so the task still runs if the
        client never connects. Streams rely on their prepared delivery boundary instead.
        """
        started = False
        lock = threading.Lock()

        def _try_start() -> bool:
            nonlocal started
            with lock:
                if started:
                    return True
                try:
                    start_task()
                except Exception:
                    logger.exception("Failed to enqueue streaming task")
                    return False
                started = True
                return True

        if dify_config.PUBSUB_REDIS_CHANNEL_TYPE == "streams":

            def _on_subscribe_streams() -> None:
                _try_start()

            return _on_subscribe_streams

        timer = threading.Timer(SSE_TASK_START_FALLBACK_MS / 1000.0, _try_start)
        timer.daemon = True
        timer.start()

        def _on_subscribe() -> None:
            if _try_start():
                timer.cancel()

        return _on_subscribe

    @classmethod
    @trace_span(AppGenerateHandler)
    def generate(
        cls,
        app_model: App,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        *,
        session: Session,
        variables: WorkflowExecutionVariables,
        runtime: AppGenerationRuntime,
        streaming: bool = True,
        root_node_id: str | None = None,
        workflow_snapshot: WorkflowSnapshot | None = None,
    ):
        """
        App Content Generate
        :param app_model: app model
        :param user: user
        :param args: args
        :param invoke_from: invoke from
        :param streaming: streaming
        :param workflow_snapshot: trusted trigger-debug revision; None selects the requested/current workflow
        :return:
        """
        cls._validate_workflow_snapshot(app_model, invoke_from, workflow_snapshot)
        return cls._run_with_guardrails(
            app_model=app_model,
            streaming=streaming,
            action=lambda rate_limit, request_id: cls._dispatch_generate(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                streaming=streaming,
                root_node_id=root_node_id,
                workflow_snapshot=workflow_snapshot,
                session=session,
                variables=variables,
                runtime=runtime,
                rate_limit=rate_limit,
                request_id=request_id,
            ),
        )

    @staticmethod
    def _validate_workflow_snapshot(
        app_model: App, invoke_from: InvokeFrom, workflow_snapshot: WorkflowSnapshot | None
    ) -> None:
        if workflow_snapshot is not None and (
            invoke_from != InvokeFrom.DEBUGGER
            or app_model.mode != AppMode.WORKFLOW
            or (workflow_snapshot.tenant_id, workflow_snapshot.app_id) != (app_model.tenant_id, app_model.id)
        ):
            raise ValueError("Workflow snapshot does not belong to this debugger invocation")

    @classmethod
    @trace_span(AppGenerateHandler)
    def generate_workflow_stream(
        cls,
        *,
        app_model: App,
        user: Account | EndUser,
        workflow: Workflow,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        variables: WorkflowExecutionVariables,
        runtime: AppGenerationRuntime,
        root_node_id: str | None,
        workflow_snapshot: WorkflowSnapshot | None,
        reservation: WorkflowStreamReservation | None,
    ):
        """Prepare streaming execution from detached inputs, without a database transaction."""
        if app_model.mode not in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
            raise ValueError(f"Invalid app mode {app_model.mode}")
        if (workflow.tenant_id, workflow.app_id) != (app_model.tenant_id, app_model.id):
            raise ValueError("Workflow does not belong to this app")
        cls._validate_workflow_snapshot(app_model, invoke_from, workflow_snapshot)
        if app_model.mode == AppMode.WORKFLOW:
            cls._ensure_workflow_service_mode_available(workflow=workflow, invoke_from=invoke_from)
        return cls._run_with_guardrails(
            app_model=app_model,
            streaming=True,
            action=lambda rate_limit, request_id: cls._stream_workflow(
                app_model=app_model,
                user=user,
                workflow=workflow,
                args=args,
                invoke_from=invoke_from,
                variables=variables,
                runtime=runtime,
                root_node_id=root_node_id,
                workflow_snapshot=workflow_snapshot,
                reservation=reservation,
                rate_limit=rate_limit,
                request_id=request_id,
            ),
        )

    @classmethod
    def _stream_workflow(
        cls,
        *,
        app_model: App,
        user: Account | EndUser,
        workflow: Workflow,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        variables: WorkflowExecutionVariables,
        runtime: AppGenerationRuntime,
        root_node_id: str | None,
        workflow_snapshot: WorkflowSnapshot | None,
        rate_limit: RateLimit,
        request_id: str,
        reservation: WorkflowStreamReservation | None = None,
    ):
        with rate_limit_context(rate_limit, request_id):
            payload = AppExecutionParams.new(
                app_model=app_model,
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=invoke_from,
                streaming=True,
                call_depth=0,
                root_node_id=root_node_id,
                workflow_snapshot=workflow_snapshot,
                workflow_run_id=(workflow_snapshot.execution_id if workflow_snapshot is not None else None)
                or str(uuid.uuid4()),
            )
            payload_json = payload.model_dump_json()

        def on_subscribe():
            workflow_based_app_execution_task.delay(payload_json)

        # Reserved debug executions start only with a subscriber. A fallback timer
        # could enqueue after an unopened/failed response releases its Agent pins.
        # Let dispatch errors reach the stream owner so it can release the pins.
        subscribe = (
            (lambda: reservation.enqueue(on_subscribe))
            if reservation is not None
            else cls._build_streaming_task_on_subscribe(on_subscribe)
        )
        return rate_limit.generate(
            convert_to_event_stream(
                WorkflowEventStream.retrieve_events(
                    AppMode(app_model.mode), payload.workflow_run_id, on_subscribe=subscribe
                )
            ),
            request_id,
        )

    @classmethod
    def _run_with_guardrails(
        cls,
        *,
        app_model: App,
        streaming: bool,
        action: Callable[[RateLimit, str], Any],
    ):
        quota_charge = unlimited()
        if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD:
            try:
                quota_charge = QuotaService.reserve(QuotaType.WORKFLOW, app_model.tenant_id)
            except QuotaExceededError:
                raise InvokeRateLimitError(f"Workflow execution quota limit reached for tenant {app_model.tenant_id}")

        # app level rate limiter
        max_active_request = cls._get_max_active_requests(app_model)
        rate_limit = RateLimit(app_model.id, max_active_request)
        request_id = RateLimit.gen_request_key()
        try:
            request_id = rate_limit.enter(request_id)
            quota_charge.commit()
            return action(rate_limit, request_id)
        except Exception:
            quota_charge.refund()
            if streaming:
                rate_limit.exit(request_id)
            raise
        finally:
            if not streaming:
                rate_limit.exit(request_id)

    @classmethod
    def _dispatch_generate(
        cls,
        *,
        app_model: App,
        user: Account | EndUser,
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool,
        root_node_id: str | None,
        workflow_snapshot: WorkflowSnapshot | None,
        session: Session,
        variables: WorkflowExecutionVariables,
        runtime: AppGenerationRuntime,
        rate_limit: RateLimit,
        request_id: str,
    ):
        effective_mode = (
            AppMode.AGENT_CHAT
            if app_model.is_agent_with_session(session=session) and app_model.mode != AppMode.AGENT_CHAT
            else app_model.mode
        )
        match effective_mode:
            case AppMode.COMPLETION:
                return rate_limit.generate(
                    convert_to_event_stream(
                        CompletionAppGenerator(
                            retrieval=runtime.retrieval,
                            annotations=runtime.annotation_replies,
                            records=runtime.chat_records,
                        ).generate(
                            session=session,
                            app_model=app_model,
                            user=user,
                            args=args,
                            invoke_from=invoke_from,
                            streaming=streaming,
                        ),
                    ),
                    request_id=request_id,
                )
            case AppMode.AGENT_CHAT:
                return rate_limit.generate(
                    convert_to_event_stream(
                        AgentChatAppGenerator(
                            dataset_tools=runtime.dataset_tools,
                            tool_invoker=runtime.agent_tool_invoker,
                            annotations=runtime.annotation_replies,
                            records=runtime.chat_records,
                            draft_variable_saver=variables.saver_factory,
                            workflow_runtime=runtime,
                        ).generate(
                            session=session,
                            app_model=app_model,
                            user=user,
                            args=args,
                            invoke_from=invoke_from,
                            streaming=streaming,
                        ),
                    ),
                    request_id,
                )
            case AppMode.AGENT:
                session.expunge_all()
                session.close()
                return rate_limit.generate(
                    convert_to_event_stream(
                        AgentAppGenerator(
                            forms=runtime.human_forms,
                            agent_configs=runtime.agent_configs,
                            tool_providers=runtime.tool_providers,
                            workflow_queries=runtime.tools,
                            records=runtime.chat_records,
                            annotations=runtime.annotation_replies,
                        ).generate(
                            app_model=app_model,
                            user=user,
                            args=args,
                            invoke_from=invoke_from,
                            streaming=streaming,
                        ),
                    ),
                    request_id,
                )
            case AppMode.CHAT:
                return rate_limit.generate(
                    convert_to_event_stream(
                        ChatAppGenerator(
                            retrieval=runtime.retrieval,
                            annotations=runtime.annotation_replies,
                            records=runtime.chat_records,
                        ).generate(
                            session=session,
                            app_model=app_model,
                            user=user,
                            args=args,
                            invoke_from=invoke_from,
                            streaming=streaming,
                        ),
                    ),
                    request_id=request_id,
                )
            case AppMode.ADVANCED_CHAT:
                workflow_id = args.get("workflow_id")
                workflow = cls._get_workflow(app_model, invoke_from, workflow_id, session=session)

                if streaming:
                    return cls._stream_workflow(
                        app_model=app_model,
                        user=user,
                        workflow=workflow,
                        args=args,
                        invoke_from=invoke_from,
                        variables=variables,
                        runtime=runtime,
                        root_node_id=None,
                        workflow_snapshot=None,
                        rate_limit=rate_limit,
                        request_id=request_id,
                    )

                # Blocking mode: run synchronously and return JSON instead of SSE
                # Keep behaviour consistent with WORKFLOW blocking branch.
                pause_config = PauseStateLayerConfig(
                    session_factory=session_factory.get_session_maker(),
                    state_owner_user_id=workflow.created_by,
                )
                advanced_generator = AdvancedChatAppGenerator(
                    runtime=runtime,
                    draft_variable_loader=variables.workflow_loader,
                    draft_variable_saver=variables.saver_factory,
                )
                return rate_limit.generate(
                    convert_to_event_stream(
                        advanced_generator.generate(
                            app_model=app_model,
                            workflow=workflow,
                            user=user,
                            args=args,
                            invoke_from=invoke_from,
                            workflow_run_id=str(uuid.uuid4()),
                            streaming=False,
                            pause_state_config=pause_config,
                        )
                    ),
                    request_id=request_id,
                )
            case AppMode.WORKFLOW:
                workflow_id = args.get("workflow_id")
                workflow = cls._get_workflow(
                    app_model, invoke_from, workflow_id, session=session, snapshot=workflow_snapshot
                )
                cls._ensure_workflow_service_mode_available(workflow=workflow, invoke_from=invoke_from)
                if streaming:
                    return cls._stream_workflow(
                        app_model=app_model,
                        user=user,
                        workflow=workflow,
                        args=args,
                        invoke_from=invoke_from,
                        variables=variables,
                        runtime=runtime,
                        root_node_id=root_node_id,
                        workflow_snapshot=workflow_snapshot,
                        rate_limit=rate_limit,
                        request_id=request_id,
                    )

                pause_config = PauseStateLayerConfig(
                    session_factory=session_factory.get_session_maker(),
                    state_owner_user_id=workflow.created_by,
                )
                return rate_limit.generate(
                    convert_to_event_stream(
                        WorkflowAppGenerator(
                            runtime=runtime,
                            draft_variable_loader=variables.workflow_loader,
                            draft_variable_saver=variables.saver_factory,
                        ).generate(
                            app_model=app_model,
                            workflow=workflow,
                            user=user,
                            args=args,
                            invoke_from=invoke_from,
                            streaming=False,
                            root_node_id=root_node_id,
                            call_depth=0,
                            pause_state_config=pause_config,
                        ),
                    ),
                    request_id,
                )
            case _:
                raise ValueError(f"Invalid app mode {app_model.mode}")

    @staticmethod
    def _ensure_workflow_service_mode_available(*, workflow: Workflow, invoke_from: InvokeFrom) -> None:
        if invoke_from not in _MANUAL_WORKFLOW_INVOKE_SOURCES:
            return

        for _, node_data in workflow.walk_nodes():
            node_type = node_data.get("type")
            if isinstance(node_type, str) and is_trigger_node_type(node_type):
                raise TriggerWorkflowServiceModeUnavailableError()

    @staticmethod
    def _get_max_active_requests(app: App) -> int:
        """
        Get the maximum number of active requests allowed for an app.

        Returns the smaller value between app's custom limit and global config limit.
        A value of 0 means infinite (no limit).

        Args:
            app: The App model instance

        Returns:
            The maximum number of active requests allowed
        """
        app_limit = app.max_active_requests or dify_config.APP_DEFAULT_ACTIVE_REQUESTS
        config_limit = dify_config.APP_MAX_ACTIVE_REQUESTS

        # Filter out infinite (0) values and return the minimum, or 0 if both are infinite
        limits = [limit for limit in [app_limit, config_limit] if limit > 0]
        return min(limits) if limits else 0

    @classmethod
    def generate_single_iteration(
        cls,
        app_model: App,
        user: Account,
        node_id: str,
        args: Any,
        *,
        workflow: Workflow,
        variables: WorkflowExecutionVariables,
        runtime: AppGenerationRuntime,
        streaming: bool = True,
    ):
        match app_model.mode:
            case AppMode.COMPLETION | AppMode.CHAT | AppMode.AGENT_CHAT:
                raise ValueError(f"Invalid app mode {app_model.mode}")
            case AppMode.ADVANCED_CHAT:
                return convert_to_event_stream(
                    AdvancedChatAppGenerator(
                        runtime=runtime,
                        draft_variable_loader=variables.workflow_loader,
                        draft_variable_saver=variables.saver_factory,
                    ).single_iteration_generate(
                        app_model=app_model,
                        workflow=workflow,
                        node_id=node_id,
                        user=user,
                        args=args,
                        streaming=streaming,
                    )
                )
            case AppMode.WORKFLOW:
                return convert_to_event_stream(
                    WorkflowAppGenerator(
                        runtime=runtime,
                        draft_variable_loader=variables.workflow_loader,
                        draft_variable_saver=variables.saver_factory,
                    ).single_iteration_generate(
                        app_model=app_model,
                        workflow=workflow,
                        node_id=node_id,
                        user=user,
                        args=args,
                        streaming=streaming,
                    )
                )
            case AppMode.CHANNEL | AppMode.RAG_PIPELINE:
                raise ValueError(f"Invalid app mode {app_model.mode}")
            case _:
                raise ValueError(f"Invalid app mode {app_model.mode}")

    @classmethod
    def generate_single_loop(
        cls,
        app_model: App,
        user: Account,
        node_id: str,
        args: Mapping[str, Any],
        *,
        workflow: Workflow,
        variables: WorkflowExecutionVariables,
        runtime: AppGenerationRuntime,
        streaming: bool = True,
    ):
        match app_model.mode:
            case AppMode.COMPLETION | AppMode.CHAT | AppMode.AGENT_CHAT:
                raise ValueError(f"Invalid app mode {app_model.mode}")
            case AppMode.ADVANCED_CHAT:
                return convert_to_event_stream(
                    AdvancedChatAppGenerator(
                        runtime=runtime,
                        draft_variable_loader=variables.workflow_loader,
                        draft_variable_saver=variables.saver_factory,
                    ).single_loop_generate(
                        app_model=app_model,
                        workflow=workflow,
                        node_id=node_id,
                        user=user,
                        args=args,
                        streaming=streaming,
                    )
                )
            case AppMode.WORKFLOW:
                return convert_to_event_stream(
                    WorkflowAppGenerator(
                        runtime=runtime,
                        draft_variable_loader=variables.workflow_loader,
                        draft_variable_saver=variables.saver_factory,
                    ).single_loop_generate(
                        app_model=app_model,
                        workflow=workflow,
                        node_id=node_id,
                        user=user,
                        args=args,
                        streaming=streaming,
                    )
                )
            case AppMode.CHANNEL | AppMode.RAG_PIPELINE:
                raise ValueError(f"Invalid app mode {app_model.mode}")
            case _:
                raise ValueError(f"Invalid app mode {app_model.mode}")

    @classmethod
    def generate_more_like_this(
        cls,
        app_model: App,
        user: Account | EndUser,
        message_id: str,
        invoke_from: InvokeFrom,
        *,
        session: Session,
        records: ChatRecords,
        retrieval: DatasetRetrievalFactory,
        annotations: AnnotationReplies,
        streaming: bool = True,
    ) -> Mapping | Generator:
        """
        Generate more like this
        :param app_model: app model
        :param user: user
        :param message_id: message id
        :param invoke_from: invoke from
        :param streaming: streaming
        :return:
        """
        return CompletionAppGenerator(
            retrieval=retrieval, annotations=annotations, records=records
        ).generate_more_like_this(
            session=session,
            app_model=app_model,
            message_id=message_id,
            user=user,
            invoke_from=invoke_from,
            stream=streaming,
        )

    @classmethod
    def _get_workflow(
        cls,
        app_model: App,
        invoke_from: InvokeFrom,
        workflow_id: str | None = None,
        *,
        session: Session,
        snapshot: WorkflowSnapshot | None = None,
    ) -> Workflow:
        """
        Get workflow
        :param app_model: app model
        :param invoke_from: invoke from
        :param workflow_id: optional workflow id to specify a specific version
        :return:
        """
        return WorkflowDefinitionStore.prepare_execution_workflow(
            app_model,
            workflow_id=workflow_id,
            draft=invoke_from == InvokeFrom.DEBUGGER,
            session=session,
            snapshot=snapshot,
        )

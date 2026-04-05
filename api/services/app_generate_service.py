from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable, Generator, Mapping
from typing import TYPE_CHECKING, Any, Union

from configs import dify_config
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting import RateLimit
from core.app.features.rate_limiting.rate_limit import rate_limit_context
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.app.request_files import PREPARED_FILES_ARG_KEY, prepare_request_file_args
from core.db import session_factory
from enums.quota_type import QuotaType, unlimited
from extensions.otel import AppGenerateHandler, trace_span
from models.model import Account, App, AppMode, EndUser
from models.workflow import Workflow, WorkflowRun
from services.conversation_service import ConversationService
from services.errors.app import QuotaExceededError, WorkflowIdFormatError, WorkflowNotFoundError
from services.errors.llm import InvokeRateLimitError
from services.workflow_service import WorkflowService
from tasks.app_generate.workflow_execute_task import AppExecutionParams, workflow_based_app_execution_task

logger = logging.getLogger(__name__)

SSE_TASK_START_FALLBACK_MS = 200

if TYPE_CHECKING:
    from controllers.console.app.workflow import LoopNodeRunPayload


class AppGenerateService:
    @staticmethod
    def _build_streaming_task_on_subscribe(start_task: Callable[[], None]) -> Callable[[], None]:
        """
        Build a subscription callback that coordinates when the background task starts.

        - streams transport: start immediately (events are durable; late subscribers can replay).
        - pubsub/sharded transport: start on first subscribe, with a short fallback timer so the task
          still runs if the client never connects.
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

        channel_type = dify_config.PUBSUB_REDIS_CHANNEL_TYPE
        if channel_type == "streams":
            # With Redis Streams, we can safely start right away; consumers can read past events.
            _try_start()

            # Keep return type Callable[[], None] consistent while allowing an extra (no-op) call.
            def _on_subscribe_streams() -> None:
                _try_start()

            return _on_subscribe_streams

        # Pub/Sub modes (at-most-once): subscribe-gated start with a tiny fallback.
        timer = threading.Timer(SSE_TASK_START_FALLBACK_MS / 1000.0, _try_start)
        timer.daemon = True
        timer.start()

        def _on_subscribe() -> None:
            if _try_start():
                timer.cancel()

        return _on_subscribe

    @classmethod
    def _prepare_message_based_args(
        cls,
        *,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        config_manager: (
            type[ChatAppConfigManager] | type[AgentChatAppConfigManager] | type[CompletionAppConfigManager]
        ),
        enable_retriever_resource: bool = False,
    ) -> dict[str, Any]:
        if args.get(PREPARED_FILES_ARG_KEY):
            return dict(args)

        prepared_args = dict(args)
        conversation = None
        conversation_id = prepared_args.get("conversation_id")
        if conversation_id:
            conversation = ConversationService.get_conversation(
                app_model=app_model,
                conversation_id=conversation_id,
                user=user,
            )

        app_model_config = MessageBasedAppGenerator()._get_app_model_config(
            app_model=app_model,
            conversation=conversation,
        )

        override_model_config_dict = None
        if prepared_args.get("model_config"):
            if invoke_from != InvokeFrom.DEBUGGER:
                raise ValueError("Only in App debug mode can override model config")

            override_model_config_dict = config_manager.config_validate(
                tenant_id=app_model.tenant_id,
                config=prepared_args.get("model_config", {}),
            )

            if enable_retriever_resource:
                override_model_config_dict["retriever_resource"] = {"enabled": True}

        file_upload_config = FileUploadConfigManager.convert(override_model_config_dict or app_model_config.to_dict())
        return prepare_request_file_args(
            args=prepared_args,
            files=prepared_args.get("files") or [],
            tenant_id=app_model.tenant_id,
            user=user,
            invoke_from=invoke_from,
            file_upload_config=file_upload_config,
        )

    @classmethod
    def _prepare_generate_args(
        cls,
        *,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        workflow: Workflow | None = None,
    ) -> dict[str, Any]:
        app_mode = (
            AppMode.AGENT_CHAT
            if app_model.mode == AppMode.CHAT and app_model.is_agent
            else AppMode.value_of(app_model.mode)
        )
        if app_mode == AppMode.COMPLETION:
            return cls._prepare_message_based_args(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                config_manager=CompletionAppConfigManager,
            )
        if app_mode == AppMode.AGENT_CHAT:
            return cls._prepare_message_based_args(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                config_manager=AgentChatAppConfigManager,
                enable_retriever_resource=True,
            )
        if app_mode == AppMode.CHAT:
            return cls._prepare_message_based_args(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                config_manager=ChatAppConfigManager,
                enable_retriever_resource=True,
            )
        if app_mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = workflow or cls._get_workflow(app_model, invoke_from, args.get("workflow_id"))
            return prepare_request_file_args(
                args=args,
                files=args.get("files") or [],
                tenant_id=app_model.tenant_id,
                user=user,
                invoke_from=invoke_from,
                file_upload_config=FileUploadConfigManager.convert(workflow.features_dict, is_vision=False),
                strict_type_validation=app_mode == AppMode.WORKFLOW and invoke_from == InvokeFrom.SERVICE_API,
            )

        return dict(args)

    @classmethod
    @trace_span(AppGenerateHandler)
    def generate(
        cls,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
        root_node_id: str | None = None,
    ):
        """
        App Content Generate
        :param app_model: app model
        :param user: user
        :param args: args
        :param invoke_from: invoke from
        :param streaming: streaming
        :return:
        """
        quota_charge = unlimited()
        if dify_config.BILLING_ENABLED:
            try:
                quota_charge = QuotaType.WORKFLOW.consume(app_model.tenant_id)
            except QuotaExceededError:
                raise InvokeRateLimitError(f"Workflow execution quota limit reached for tenant {app_model.tenant_id}")

        # app level rate limiter
        max_active_request = cls._get_max_active_requests(app_model)
        rate_limit = RateLimit(app_model.id, max_active_request)
        request_id = RateLimit.gen_request_key()
        try:
            request_id = rate_limit.enter(request_id)
            if app_model.mode == AppMode.COMPLETION:
                generator = CompletionAppGenerator()
                prepared_args = cls._prepare_generate_args(
                    app_model=app_model,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                )
                return rate_limit.generate(
                    generator.convert_to_event_stream(
                        generator.generate(
                            app_model=app_model,
                            user=user,
                            args=prepared_args,
                            invoke_from=invoke_from,
                            streaming=streaming,
                        ),
                    ),
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.AGENT_CHAT or app_model.is_agent:
                generator = AgentChatAppGenerator()
                prepared_args = cls._prepare_generate_args(
                    app_model=app_model,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                )
                return rate_limit.generate(
                    generator.convert_to_event_stream(
                        generator.generate(
                            app_model=app_model,
                            user=user,
                            args=prepared_args,
                            invoke_from=invoke_from,
                            streaming=streaming,
                        ),
                    ),
                    request_id,
                )
            elif app_model.mode == AppMode.CHAT:
                generator = ChatAppGenerator()
                prepared_args = cls._prepare_generate_args(
                    app_model=app_model,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                )
                return rate_limit.generate(
                    generator.convert_to_event_stream(
                        generator.generate(
                            app_model=app_model,
                            user=user,
                            args=prepared_args,
                            invoke_from=invoke_from,
                            streaming=streaming,
                        ),
                    ),
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.ADVANCED_CHAT:
                workflow_id = args.get("workflow_id")
                workflow = cls._get_workflow(app_model, invoke_from, workflow_id)
                prepared_args = cls._prepare_generate_args(
                    app_model=app_model,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                    workflow=workflow,
                )

                if streaming:
                    # Streaming mode: subscribe to SSE and enqueue the execution on first subscriber
                    with rate_limit_context(rate_limit, request_id):
                        payload = AppExecutionParams.new(
                            app_model=app_model,
                            workflow=workflow,
                            user=user,
                            args=prepared_args,
                            invoke_from=invoke_from,
                            streaming=True,
                            call_depth=0,
                        )
                        payload_json = payload.model_dump_json()

                    def on_subscribe():
                        workflow_based_app_execution_task.delay(payload_json)

                    on_subscribe = cls._build_streaming_task_on_subscribe(on_subscribe)
                    generator = AdvancedChatAppGenerator()
                    return rate_limit.generate(
                        generator.convert_to_event_stream(
                            generator.retrieve_events(
                                AppMode.ADVANCED_CHAT,
                                payload.workflow_run_id,
                                on_subscribe=on_subscribe,
                            ),
                        ),
                        request_id=request_id,
                    )
                else:
                    # Blocking mode: run synchronously and return JSON instead of SSE
                    # Keep behaviour consistent with WORKFLOW blocking branch.
                    advanced_generator = AdvancedChatAppGenerator()
                    return rate_limit.generate(
                        advanced_generator.convert_to_event_stream(
                            advanced_generator.generate(
                                app_model=app_model,
                                workflow=workflow,
                                user=user,
                                args=prepared_args,
                                invoke_from=invoke_from,
                                workflow_run_id=str(uuid.uuid4()),
                                streaming=False,
                            )
                        ),
                        request_id=request_id,
                    )
            elif app_model.mode == AppMode.WORKFLOW:
                workflow_id = args.get("workflow_id")
                workflow = cls._get_workflow(app_model, invoke_from, workflow_id)
                prepared_args = cls._prepare_generate_args(
                    app_model=app_model,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                    workflow=workflow,
                )
                if streaming:
                    with rate_limit_context(rate_limit, request_id):
                        payload = AppExecutionParams.new(
                            app_model=app_model,
                            workflow=workflow,
                            user=user,
                            args=prepared_args,
                            invoke_from=invoke_from,
                            streaming=True,
                            call_depth=0,
                            root_node_id=root_node_id,
                            workflow_run_id=str(uuid.uuid4()),
                        )
                        payload_json = payload.model_dump_json()

                    def on_subscribe():
                        workflow_based_app_execution_task.delay(payload_json)

                    on_subscribe = cls._build_streaming_task_on_subscribe(on_subscribe)
                    return rate_limit.generate(
                        WorkflowAppGenerator.convert_to_event_stream(
                            MessageBasedAppGenerator.retrieve_events(
                                AppMode.WORKFLOW,
                                payload.workflow_run_id,
                                on_subscribe=on_subscribe,
                            ),
                        ),
                        request_id,
                    )

                pause_config = PauseStateLayerConfig(
                    session_factory=session_factory.get_session_maker(),
                    state_owner_user_id=workflow.created_by,
                )
                return rate_limit.generate(
                    WorkflowAppGenerator.convert_to_event_stream(
                        WorkflowAppGenerator().generate(
                            app_model=app_model,
                            workflow=workflow,
                            user=user,
                            args=prepared_args,
                            invoke_from=invoke_from,
                            streaming=False,
                            root_node_id=root_node_id,
                            call_depth=0,
                            pause_state_config=pause_config,
                        ),
                    ),
                    request_id,
                )
            else:
                raise ValueError(f"Invalid app mode {app_model.mode}")
        except Exception:
            quota_charge.refund()
            rate_limit.exit(request_id)
            raise
        finally:
            if not streaming:
                rate_limit.exit(request_id)

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
    def generate_single_iteration(cls, app_model: App, user: Account, node_id: str, args: Any, streaming: bool = True):
        if app_model.mode == AppMode.ADVANCED_CHAT:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator.convert_to_event_stream(
                AdvancedChatAppGenerator().single_iteration_generate(
                    app_model=app_model, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
                )
            )
        elif app_model.mode == AppMode.WORKFLOW:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator.convert_to_event_stream(
                WorkflowAppGenerator().single_iteration_generate(
                    app_model=app_model, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
                )
            )
        else:
            raise ValueError(f"Invalid app mode {app_model.mode}")

    @classmethod
    def generate_single_loop(
        cls, app_model: App, user: Account, node_id: str, args: LoopNodeRunPayload, streaming: bool = True
    ):
        if app_model.mode == AppMode.ADVANCED_CHAT:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator.convert_to_event_stream(
                AdvancedChatAppGenerator().single_loop_generate(
                    app_model=app_model, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
                )
            )
        elif app_model.mode == AppMode.WORKFLOW:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator.convert_to_event_stream(
                WorkflowAppGenerator().single_loop_generate(
                    app_model=app_model, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
                )
            )
        else:
            raise ValueError(f"Invalid app mode {app_model.mode}")

    @classmethod
    def generate_more_like_this(
        cls,
        app_model: App,
        user: Union[Account, EndUser],
        message_id: str,
        invoke_from: InvokeFrom,
        streaming: bool = True,
    ) -> Union[Mapping, Generator]:
        """
        Generate more like this
        :param app_model: app model
        :param user: user
        :param message_id: message id
        :param invoke_from: invoke from
        :param streaming: streaming
        :return:
        """
        return CompletionAppGenerator().generate_more_like_this(
            app_model=app_model, message_id=message_id, user=user, invoke_from=invoke_from, stream=streaming
        )

    @classmethod
    def _get_workflow(cls, app_model: App, invoke_from: InvokeFrom, workflow_id: str | None = None) -> Workflow:
        """
        Get workflow
        :param app_model: app model
        :param invoke_from: invoke from
        :param workflow_id: optional workflow id to specify a specific version
        :return:
        """
        workflow_service = WorkflowService()

        # If workflow_id is specified, get the specific workflow version
        if workflow_id:
            try:
                _ = uuid.UUID(workflow_id)
            except ValueError:
                raise WorkflowIdFormatError(f"Invalid workflow_id format: '{workflow_id}'. ")
            workflow = workflow_service.get_published_workflow_by_id(app_model=app_model, workflow_id=workflow_id)
            if not workflow:
                raise WorkflowNotFoundError(f"Workflow not found with id: {workflow_id}")
            return workflow

        if invoke_from == InvokeFrom.DEBUGGER:
            # fetch draft workflow by app_model
            workflow = workflow_service.get_draft_workflow(app_model=app_model)

            if not workflow:
                raise ValueError("Workflow not initialized")
        else:
            # fetch published workflow by app_model
            workflow = workflow_service.get_published_workflow(app_model=app_model)

            if not workflow:
                raise ValueError("Workflow not published")

        return workflow

    @classmethod
    def get_response_generator(
        cls,
        app_model: App,
        workflow_run: WorkflowRun,
    ):
        if workflow_run.status.is_ended():
            # TODO(QuantumGhost): handled the ended scenario.
            pass

        generator = AdvancedChatAppGenerator()

        return generator.convert_to_event_stream(
            generator.retrieve_events(AppMode(app_model.mode), workflow_run.id),
        )

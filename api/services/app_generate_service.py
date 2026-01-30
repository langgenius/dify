from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable, Generator, Mapping
from typing import TYPE_CHECKING, Any, Union

from configs import dify_config
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting import RateLimit
from core.app.features.rate_limiting.rate_limit import rate_limit_context
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.db import session_factory
from enums.quota_type import QuotaType, unlimited
from extensions.otel import AppGenerateHandler, trace_span
from models.model import Account, App, AppMode, EndUser
from models.workflow import Workflow, WorkflowRun
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

        # XXX(QuantumGhost): dirty hacks to avoid a race between publisher and SSE subscriber.
        # The Celery task may publish the first event before the API side actually subscribes,
        # causing an "at most once" drop with Redis Pub/Sub. We start the task on subscribe,
        # but also use a short fallback timer so the task still runs if the client never consumes.
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
                return rate_limit.generate(
                    CompletionAppGenerator.convert_to_event_stream(
                        CompletionAppGenerator().generate(
                            app_model=app_model, user=user, args=args, invoke_from=invoke_from, streaming=streaming
                        ),
                    ),
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.AGENT_CHAT or app_model.is_agent:
                return rate_limit.generate(
                    AgentChatAppGenerator.convert_to_event_stream(
                        AgentChatAppGenerator().generate(
                            app_model=app_model, user=user, args=args, invoke_from=invoke_from, streaming=streaming
                        ),
                    ),
                    request_id,
                )
            elif app_model.mode == AppMode.CHAT:
                return rate_limit.generate(
                    ChatAppGenerator.convert_to_event_stream(
                        ChatAppGenerator().generate(
                            app_model=app_model, user=user, args=args, invoke_from=invoke_from, streaming=streaming
                        ),
                    ),
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.ADVANCED_CHAT:
                workflow_id = args.get("workflow_id")
                workflow = cls._get_workflow(app_model, invoke_from, workflow_id)
                with rate_limit_context(rate_limit, request_id):
                    payload = AppExecutionParams.new(
                        app_model=app_model,
                        workflow=workflow,
                        user=user,
                        args=args,
                        invoke_from=invoke_from,
                        streaming=streaming,
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
            elif app_model.mode == AppMode.WORKFLOW:
                workflow_id = args.get("workflow_id")
                workflow = cls._get_workflow(app_model, invoke_from, workflow_id)
                if streaming:
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

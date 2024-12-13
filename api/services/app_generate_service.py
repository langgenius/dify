from collections.abc import Generator, Mapping
from typing import Any, Union

from openai._exceptions import RateLimitError

from configs import dify_config
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting import RateLimit
from models.model import Account, App, AppMode, EndUser
from models.workflow import Workflow
from services.errors.llm import InvokeRateLimitError
from services.workflow_service import WorkflowService


class AppGenerateService:
    @classmethod
    def generate(
        cls,
        app_model: App,
        user: Union[Account, EndUser],
        args: Mapping[str, Any],
        invoke_from: InvokeFrom,
        streaming: bool = True,
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
        max_active_request = AppGenerateService._get_max_active_requests(app_model)
        rate_limit = RateLimit(app_model.id, max_active_request)
        request_id = RateLimit.gen_request_key()
        try:
            request_id = rate_limit.enter(request_id)
            if app_model.mode == AppMode.COMPLETION.value:
                return rate_limit.generate(
                    generator=CompletionAppGenerator().generate(
                        app_model=app_model,
                        user=user,
                        args=args,
                        invoke_from=invoke_from,
                        streaming=streaming,
                    ),
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.AGENT_CHAT.value or app_model.is_agent:
                generator = AgentChatAppGenerator().generate(
                    app_model=app_model,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                    streaming=streaming,
                )
                return rate_limit.generate(
                    generator=generator,
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.CHAT.value:
                return rate_limit.generate(
                    generator=ChatAppGenerator().generate(
                        app_model=app_model,
                        user=user,
                        args=args,
                        invoke_from=invoke_from,
                        streaming=streaming,
                    ),
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.ADVANCED_CHAT.value:
                workflow = cls._get_workflow(app_model, invoke_from)
                return rate_limit.generate(
                    generator=AdvancedChatAppGenerator().generate(
                        app_model=app_model,
                        workflow=workflow,
                        user=user,
                        args=args,
                        invoke_from=invoke_from,
                        streaming=streaming,
                    ),
                    request_id=request_id,
                )
            elif app_model.mode == AppMode.WORKFLOW.value:
                workflow = cls._get_workflow(app_model, invoke_from)
                generator = WorkflowAppGenerator().generate(
                    app_model=app_model,
                    workflow=workflow,
                    user=user,
                    args=args,
                    invoke_from=invoke_from,
                    streaming=streaming,
                    call_depth=0,
                    workflow_thread_pool_id=None,
                )
                return rate_limit.generate(
                    generator=generator,
                    request_id=request_id,
                )
            else:
                raise ValueError(f"Invalid app mode {app_model.mode}")
        except RateLimitError as e:
            raise InvokeRateLimitError(str(e))
        except Exception:
            rate_limit.exit(request_id)
            raise
        finally:
            if not streaming:
                rate_limit.exit(request_id)

    @staticmethod
    def _get_max_active_requests(app_model: App) -> int:
        max_active_requests = app_model.max_active_requests
        if app_model.max_active_requests is None:
            max_active_requests = int(dify_config.APP_MAX_ACTIVE_REQUESTS)
        return max_active_requests

    @classmethod
    def generate_single_iteration(cls, app_model: App, user: Account, node_id: str, args: Any, streaming: bool = True):
        if app_model.mode == AppMode.ADVANCED_CHAT.value:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator().single_iteration_generate(
                app_model=app_model,
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                streaming=streaming,
            )
        elif app_model.mode == AppMode.WORKFLOW.value:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return WorkflowAppGenerator().single_iteration_generate(
                app_model=app_model, workflow=workflow, node_id=node_id, user=user, args=args, streaming=streaming
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
    ) -> Union[dict, Generator]:
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
    def _get_workflow(cls, app_model: App, invoke_from: InvokeFrom) -> Workflow:
        """
        Get workflow
        :param app_model: app model
        :param invoke_from: invoke from
        :return:
        """
        workflow_service = WorkflowService()
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

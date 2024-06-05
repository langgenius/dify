from collections.abc import Generator
from typing import Any, Union

from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import Account, App, AppMode, EndUser
from services.workflow_service import WorkflowService


class AppGenerateService:

    @classmethod
    def generate(cls, app_model: App,
                 user: Union[Account, EndUser],
                 args: Any,
                 invoke_from: InvokeFrom,
                 streaming: bool = True) -> Union[dict, Generator[dict, None, None]]:
        """
        App Content Generate
        :param app_model: app model
        :param user: user
        :param args: args
        :param invoke_from: invoke from
        :param streaming: streaming
        :return:
        """
        if app_model.mode == AppMode.COMPLETION.value:
            return CompletionAppGenerator().generate(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                stream=streaming
            )
        elif app_model.mode == AppMode.AGENT_CHAT.value or app_model.is_agent:
            return AgentChatAppGenerator().generate(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                stream=streaming
            )
        elif app_model.mode == AppMode.CHAT.value:
            return ChatAppGenerator().generate(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                stream=streaming
            )
        elif app_model.mode == AppMode.ADVANCED_CHAT.value:
            workflow = cls._get_workflow(app_model, invoke_from)
            return AdvancedChatAppGenerator().generate(
                app_model=app_model,
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=invoke_from,
                stream=streaming
            )
        elif app_model.mode == AppMode.WORKFLOW.value:
            workflow = cls._get_workflow(app_model, invoke_from)
            return WorkflowAppGenerator().generate(
                app_model=app_model,
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=invoke_from,
                stream=streaming
            )
        else:
            raise ValueError(f'Invalid app mode {app_model.mode}')

    @classmethod
    def generate_single_iteration(cls, app_model: App,
                                  user: Union[Account, EndUser],
                                  node_id: str,
                                  args: Any,
                                  streaming: bool = True):
        if app_model.mode == AppMode.ADVANCED_CHAT.value:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return AdvancedChatAppGenerator().single_iteration_generate(
                app_model=app_model,
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                stream=streaming
            )
        elif app_model.mode == AppMode.WORKFLOW.value:
            workflow = cls._get_workflow(app_model, InvokeFrom.DEBUGGER)
            return WorkflowAppGenerator().single_iteration_generate(
                app_model=app_model,
                workflow=workflow,
                node_id=node_id,
                user=user,
                args=args,
                stream=streaming
            )
        else:
            raise ValueError(f'Invalid app mode {app_model.mode}')

    @classmethod
    def generate_more_like_this(cls, app_model: App, user: Union[Account, EndUser],
                                message_id: str, invoke_from: InvokeFrom, streaming: bool = True) \
            -> Union[dict, Generator]:
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
            app_model=app_model,
            message_id=message_id,
            user=user,
            invoke_from=invoke_from,
            stream=streaming
        )

    @classmethod
    def _get_workflow(cls, app_model: App, invoke_from: InvokeFrom) -> Any:
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
                raise ValueError('Workflow not initialized')
        else:
            # fetch published workflow by app_model
            workflow = workflow_service.get_published_workflow(app_model=app_model)

            if not workflow:
                raise ValueError('Workflow not published')

        return workflow

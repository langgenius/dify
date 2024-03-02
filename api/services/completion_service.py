from collections.abc import Generator
from typing import Any, Union

from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import Account, App, AppMode, EndUser


class CompletionService:

    @classmethod
    def completion(cls, app_model: App, user: Union[Account, EndUser], args: Any,
                   invoke_from: InvokeFrom, streaming: bool = True) -> Union[dict, Generator]:
        """
        App Completion
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
        elif app_model.mode == AppMode.CHAT.value:
            return ChatAppGenerator().generate(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                stream=streaming
            )
        elif app_model.mode == AppMode.AGENT_CHAT.value:
            return AgentChatAppGenerator().generate(
                app_model=app_model,
                user=user,
                args=args,
                invoke_from=invoke_from,
                stream=streaming
            )
        else:
            raise ValueError('Invalid app mode')

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

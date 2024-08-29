from collections.abc import Generator, Mapping
from typing import Optional, Union

from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from extensions.ext_database import db
from models.account import Account
from models.model import App, AppMode, EndUser


class PluginAppBackwardsInvocation(BaseBackwardsInvocation):
    @classmethod
    def invoke_app(
        cls, app_id: str, 
        user_id: str, 
        tenant_id: str,
        conversation_id: Optional[str],
        query: Optional[str],
        stream: bool,
        inputs: Mapping,
        files: list[dict], 
    ) -> Generator[dict | str, None, None] | dict:
        """
        invoke app
        """
        app = cls._get_app(app_id, tenant_id)
        user = cls._get_user(user_id)

        conversation_id = conversation_id or ""

        if app.mode in [AppMode.ADVANCED_CHAT.value, AppMode.AGENT_CHAT.value, AppMode.CHAT.value]:
            if not query:
                raise ValueError("missing query")
            
            return cls.invoke_chat_app(app, user, conversation_id, query, stream, inputs, files)
        elif app.mode in [AppMode.WORKFLOW.value]:
            return cls.invoke_workflow_app(app, user, stream, inputs, files)
        elif app.mode in [AppMode.COMPLETION]:
            return cls.invoke_completion_app(app, user, stream, inputs, files)

        raise ValueError("unexpected app type")

    @classmethod
    def invoke_chat_app(
        cls, 
        app: App,
        user: Account | EndUser, 
        conversation_id: str,
        query: str,
        stream: bool,
        inputs: Mapping,
        files: list[dict], 
    ) -> Generator[dict | str, None, None] | dict:
        """
        invoke chat app
        """
        if app.mode == AppMode.ADVANCED_CHAT.value:
            workflow = app.workflow
            if not workflow:
                raise ValueError("unexpected app type")
            
            return AdvancedChatAppGenerator().generate(
                app_model=app, 
                workflow=workflow, 
                user=user, 
                args={
                    "inputs": inputs,
                    "query": query,
                    "files": files,
                    "conversation_id": conversation_id,
                },
                invoke_from=InvokeFrom.SERVICE_API,
                stream=stream
            )
        elif app.mode == AppMode.AGENT_CHAT.value:
            return AgentChatAppGenerator().generate(
                app_model=app, 
                user=user, 
                args={
                    "inputs": inputs,
                    "query": query,
                    "files": files,
                    "conversation_id": conversation_id,
                },
                invoke_from=InvokeFrom.SERVICE_API,
                stream=stream
            )
        elif app.mode == AppMode.CHAT.value:
            return ChatAppGenerator().generate(
                app_model=app, 
                user=user, 
                args={
                    "inputs": inputs,
                    "query": query,
                    "files": files,
                    "conversation_id": conversation_id,
                },
                invoke_from=InvokeFrom.SERVICE_API,
                stream=stream
            )
        else:
            raise ValueError("unexpected app type")

    @classmethod
    def invoke_workflow_app(
        cls, 
        app: App,
        user: EndUser | Account, 
        stream: bool,
        inputs: Mapping,
        files: list[dict], 
    ):
        """
        invoke workflow app
        """
        workflow = app.workflow
        if not workflow:
            raise ValueError("")

        return WorkflowAppGenerator().generate(
            app_model=app, 
            workflow=workflow, 
            user=user, 
            args={
                'inputs': inputs,
                'files': files
            }, 
            invoke_from=InvokeFrom.SERVICE_API,
            stream=stream,
            call_depth=1,
        )

    @classmethod
    def invoke_completion_app(
        cls, 
        app: App,
        user: EndUser | Account, 
        stream: bool,
        inputs: Mapping,
        files: list[dict], 
    ):
        """
        invoke completion app
        """
        return CompletionAppGenerator().generate(
            app_model=app, 
            user=user, 
            args={
                'inputs': inputs,
                'files': files
            }, 
            invoke_from=InvokeFrom.SERVICE_API,
            stream=stream,
        )

    @classmethod
    def _get_user(cls, user_id: str) -> Union[EndUser, Account]:
        """
        get the user by user id
        """

        user = db.session.query(EndUser).filter(EndUser.id == user_id).first()
        if not user:
            user = db.session.query(Account).filter(Account.id == user_id).first()

        if not user:
            raise ValueError('user not found')

        return user
    
    @classmethod
    def _get_app(cls, app_id: str, tenant_id: str) -> App:
        """
        get app
        """
        app = db.session.query(App). \
            filter(App.id == app_id). \
            filter(App.tenant_id == tenant_id). \
            first()
        
        if not app:
            raise ValueError("app not found")
        
        return app
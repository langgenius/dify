from collections.abc import Generator, Mapping
from typing import Union

from sqlalchemy import select
from sqlalchemy.orm import Session

from controllers.service_api.wraps import create_or_update_end_user_for_user_id
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from extensions.ext_database import db
from models import Account
from models.model import App, AppMode, EndUser


class PluginAppBackwardsInvocation(BaseBackwardsInvocation):
    @classmethod
    def fetch_app_info(cls, app_id: str, tenant_id: str) -> Mapping:
        """
        Fetch app info
        """
        app = cls._get_app(app_id, tenant_id)

        """Retrieve app parameters."""
        if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = app.workflow
            if workflow is None:
                raise ValueError("unexpected app type")

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app.app_model_config
            if app_model_config is None:
                raise ValueError("unexpected app type")

            features_dict = app_model_config.to_dict()

            user_input_form = features_dict.get("user_input_form", [])

        return {
            "data": get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form),
        }

    @classmethod
    def invoke_app(
        cls,
        app_id: str,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        query: str | None,
        stream: bool,
        inputs: Mapping,
        files: list[dict],
    ) -> Generator[Mapping | str, None, None] | Mapping:
        """
        invoke app
        """
        app = cls._get_app(app_id, tenant_id)
        if not user_id:
            user = create_or_update_end_user_for_user_id(app)
        else:
            user = cls._get_user(user_id)

        conversation_id = conversation_id or ""

        if app.mode in {AppMode.ADVANCED_CHAT, AppMode.AGENT_CHAT, AppMode.CHAT}:
            if not query:
                raise ValueError("missing query")

            return cls.invoke_chat_app(app, user, conversation_id, query, stream, inputs, files)
        elif app.mode == AppMode.WORKFLOW:
            return cls.invoke_workflow_app(app, user, stream, inputs, files)
        elif app.mode == AppMode.COMPLETION:
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
    ) -> Generator[Mapping | str, None, None] | Mapping:
        """
        invoke chat app
        """
        if app.mode == AppMode.ADVANCED_CHAT:
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
                streaming=stream,
            )
        elif app.mode == AppMode.AGENT_CHAT:
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
                streaming=stream,
            )
        elif app.mode == AppMode.CHAT:
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
                streaming=stream,
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
    ) -> Generator[Mapping | str, None, None] | Mapping:
        """
        invoke workflow app
        """
        workflow = app.workflow
        if not workflow:
            raise ValueError("unexpected app type")

        return WorkflowAppGenerator().generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": inputs, "files": files},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=stream,
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
    ) -> Generator[Mapping | str, None, None] | Mapping:
        """
        invoke completion app
        """
        return CompletionAppGenerator().generate(
            app_model=app,
            user=user,
            args={"inputs": inputs, "files": files},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=stream,
        )

    @classmethod
    def _get_user(cls, user_id: str) -> Union[EndUser, Account]:
        """
        get the user by user id
        """
        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(EndUser).where(EndUser.id == user_id)
            user = session.scalar(stmt)
            if not user:
                stmt = select(Account).where(Account.id == user_id)
                user = session.scalar(stmt)

        if not user:
            raise ValueError("user not found")

        return user

    @classmethod
    def _get_app(cls, app_id: str, tenant_id: str) -> App:
        """
        get app
        """
        try:
            app = db.session.query(App).where(App.id == app_id).where(App.tenant_id == tenant_id).first()
        except Exception:
            raise ValueError("app not found")

        if not app:
            raise ValueError("app not found")

        return app

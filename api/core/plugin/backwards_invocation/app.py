import uuid
from collections.abc import Generator, Mapping
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.db.session_factory import create_session
from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from extensions.ext_database import db
from models import Account, TenantAccountJoin
from models.model import (
    App,
    AppMode,
    AppModelConfig,
    AppModelConfigDict,
    EndUser,
    load_annotation_reply_config,
)
from models.workflow import Workflow
from services.end_user_service import EndUserService


class PluginAppBackwardsInvocation(BaseBackwardsInvocation):
    @classmethod
    def fetch_app_info(cls, app_id: str, tenant_id: str) -> Mapping:
        """
        Fetch app info
        """
        app = cls._get_app(app_id, tenant_id)

        """Retrieve app parameters."""
        if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = cls._get_workflow(app)
            if workflow is None:
                raise ValueError("unexpected app type")

            features_dict: dict[str, Any] = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config_dict = cls._get_app_model_config_dict(app)
            if app_model_config_dict is None:
                raise ValueError("unexpected app type")

            features_dict = cast(dict[str, Any], app_model_config_dict)

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
        session: Session,
    ) -> Generator[Mapping | str, None, None] | Mapping:
        """
        invoke app
        """
        app = cls._get_app(app_id, tenant_id)
        if not user_id:
            user = EndUserService.get_or_create_end_user(app)
        else:
            try:
                user = cls._get_user(user_id, app)
            except ValueError:
                # Plugins such as WeCom Bot pass external sender IDs rather than EndUser UUIDs.
                user = EndUserService.get_or_create_end_user(app, user_id=user_id)

        conversation_id = conversation_id or ""

        match app.mode:
            case AppMode.ADVANCED_CHAT | AppMode.AGENT_CHAT | AppMode.CHAT:
                if not query:
                    raise ValueError("missing query")

                return cls.invoke_chat_app(app, user, conversation_id, query, stream, inputs, files, session)
            case AppMode.WORKFLOW:
                workflow = cls._get_workflow(app)
                if not workflow:
                    raise ValueError("unexpected app type")
                return cls.invoke_workflow_app(app, workflow, user, stream, inputs, files)
            case AppMode.COMPLETION:
                return cls.invoke_completion_app(app, user, stream, inputs, files, session)
            case _:
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
        session: Session,
    ) -> Generator[Mapping | str, None, None] | Mapping:
        """
        invoke chat app
        """
        match app.mode:
            case AppMode.ADVANCED_CHAT:
                workflow = cls._get_workflow(app)
                if not workflow:
                    raise ValueError("unexpected app type")

                pause_config = PauseStateLayerConfig(
                    session_factory=db.engine,
                    state_owner_user_id=workflow.created_by,
                )

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
                    workflow_run_id=str(uuid.uuid4()),
                    streaming=stream,
                    pause_state_config=pause_config,
                    session=session,
                )
            case AppMode.AGENT_CHAT:
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
                    session=session,
                )
            case AppMode.CHAT:
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
                    session=session,
                )
            case _:
                raise ValueError("unexpected app type")

    @classmethod
    def invoke_workflow_app(
        cls,
        app: App,
        workflow: Workflow,
        user: EndUser | Account,
        stream: bool,
        inputs: Mapping,
        files: list[dict],
    ) -> Generator[Mapping | str, None, None] | Mapping:
        """
        invoke workflow app
        """
        pause_config = PauseStateLayerConfig(
            session_factory=db.engine,
            state_owner_user_id=workflow.created_by,
        )

        return WorkflowAppGenerator().generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": inputs, "files": files},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=stream,
            call_depth=1,
            pause_state_config=pause_config,
        )

    @classmethod
    def invoke_completion_app(
        cls,
        app: App,
        user: EndUser | Account,
        stream: bool,
        inputs: Mapping,
        files: list[dict],
        session: Session,
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
            session=session,
        )

    @classmethod
    def _get_user(cls, user_id: str, app: App) -> EndUser | Account:
        """
        get the user by user id
        """
        with create_session() as session:
            stmt = select(EndUser).where(
                EndUser.id == user_id,
                EndUser.tenant_id == app.tenant_id,
                EndUser.app_id == app.id,
            )
            user = session.scalar(stmt)
            if not user:
                stmt = select(EndUser).where(
                    EndUser.session_id == user_id,
                    EndUser.tenant_id == app.tenant_id,
                    EndUser.app_id == app.id,
                )
                user = session.scalar(stmt)
            if not user:
                stmt = select(Account).where(
                    Account.id == user_id,
                    Account.id == TenantAccountJoin.account_id,
                    TenantAccountJoin.tenant_id == app.tenant_id,
                )
                user = session.scalar(stmt)
            if user:
                session.expunge(user)

        if not user:
            raise ValueError("user not found")

        return user

    @classmethod
    def _get_app(cls, app_id: str, tenant_id: str) -> App:
        """
        get app
        """
        try:
            with create_session() as session:
                app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).limit(1))
                if app:
                    session.expunge(app)
        except Exception:
            raise ValueError("app not found")

        if not app:
            raise ValueError("app not found")

        return app

    @classmethod
    def _get_workflow(cls, app: App) -> Workflow | None:
        """
        get workflow without relying on App.workflow's request-scoped session property
        """
        if not app.workflow_id:
            return None

        with create_session() as session:
            workflow = session.scalar(
                select(Workflow)
                .where(Workflow.id == app.workflow_id, Workflow.tenant_id == app.tenant_id, Workflow.app_id == app.id)
                .limit(1)
            )
            if workflow:
                session.expunge(workflow)
            return workflow

    @classmethod
    def _get_app_model_config_dict(cls, app: App) -> AppModelConfigDict | None:
        """
        get app model config features without relying on request-scoped session-backed model properties
        """
        if not app.app_model_config_id:
            return None

        with create_session() as session:
            app_model_config = session.scalar(
                select(AppModelConfig)
                .where(AppModelConfig.id == app.app_model_config_id, AppModelConfig.app_id == app.id)
                .limit(1)
            )
            if app_model_config is None:
                return None

            annotation_reply = load_annotation_reply_config(session, app_model_config.app_id)
            return app_model_config.to_dict(annotation_reply=annotation_reply)

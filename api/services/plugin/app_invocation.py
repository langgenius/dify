"""Coordinate plugin callbacks into published applications."""

import uuid
from collections.abc import Generator, Mapping
from typing import Any, Protocol, cast

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.completion.app_generator import CompletionAppGenerator
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.apps.workflow_app_runner import WorkflowRunDriver
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
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
from services.knowledge.retrieval.retrieval import KnowledgeRetriever


class AppScopedEndUserProvisioner(Protocol):
    def get_or_create_end_user(
        self,
        tenant_id: str,
        app_id: str,
        user_id: str | None = None,
    ) -> EndUser: ...


class PluginAppInvocationService:
    """Invoke tenant-owned apps with execution dependencies bound at construction."""

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        execution_driver: WorkflowRunDriver,
        end_users: AppScopedEndUserProvisioner,
        knowledge_retrieval: KnowledgeRetriever,
    ) -> None:
        self._sessions = session_factory
        self._execution_driver = execution_driver
        self._end_users = end_users
        self._knowledge_retrieval = knowledge_retrieval

    def fetch_app_info(self, app_id: str, tenant_id: str) -> Mapping:
        """
        Fetch app info
        """
        app = self._get_app(app_id, tenant_id)

        """Retrieve app parameters."""
        if app.mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow = self._get_workflow(app)
            if workflow is None:
                raise ValueError("unexpected app type")

            features_dict: dict[str, Any] = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config_dict = self._get_app_model_config_dict(app)
            if app_model_config_dict is None:
                raise ValueError("unexpected app type")

            features_dict = cast(dict[str, Any], app_model_config_dict)

            user_input_form = features_dict.get("user_input_form", [])

        return {
            "data": get_parameters_from_feature_dict(features_dict=features_dict, user_input_form=user_input_form),
        }

    def invoke_app(
        self,
        app_id: str,
        user_id: str,
        tenant_id: str,
        conversation_id: str | None,
        query: str | None,
        stream: bool,
        inputs: Mapping,
        files: list[dict],
        session: Session,
    ) -> Generator[Mapping | str] | Mapping:
        """
        invoke app
        """
        app = self._get_app(app_id, tenant_id)
        if not user_id:
            user = self._end_users.get_or_create_end_user(app.tenant_id, app.id, None)
        else:
            try:
                user = self._get_user(user_id, app)
            except ValueError:
                # Plugins such as WeCom Bot pass external sender IDs rather than EndUser UUIDs.
                user = self._end_users.get_or_create_end_user(app.tenant_id, app.id, user_id)

        conversation_id = conversation_id or ""

        match app.mode:
            case AppMode.ADVANCED_CHAT | AppMode.AGENT_CHAT | AppMode.CHAT:
                if not query:
                    raise ValueError("missing query")

                return self.invoke_chat_app(
                    app,
                    user,
                    conversation_id,
                    query,
                    stream,
                    inputs,
                    files,
                    session,
                )
            case AppMode.WORKFLOW:
                workflow = self._get_workflow(app)
                if not workflow:
                    raise ValueError("unexpected app type")
                return self.invoke_workflow_app(
                    app,
                    workflow,
                    user,
                    stream,
                    inputs,
                    files,
                )
            case AppMode.COMPLETION:
                return self.invoke_completion_app(app, user, stream, inputs, files, session)
            case _:
                raise ValueError("unexpected app type")

    def invoke_chat_app(
        self,
        app: App,
        user: Account | EndUser,
        conversation_id: str,
        query: str,
        stream: bool,
        inputs: Mapping,
        files: list[dict],
        session: Session,
    ) -> Generator[Mapping | str] | Mapping:
        """
        invoke chat app
        """
        match app.mode:
            case AppMode.ADVANCED_CHAT:
                workflow = self._get_workflow(app)
                if not workflow:
                    raise ValueError("unexpected app type")

                pause_config = PauseStateLayerConfig(
                    session_factory=self._sessions,
                    state_owner_user_id=workflow.created_by,
                )

                return AdvancedChatAppGenerator(
                    execution_driver=self._execution_driver, knowledge_retrieval=self._knowledge_retrieval
                ).generate(
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
                return AgentChatAppGenerator(
                    execution_driver=self._execution_driver, knowledge_retrieval=self._knowledge_retrieval
                ).generate(
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
                return ChatAppGenerator(knowledge_retrieval=self._knowledge_retrieval).generate(
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

    def invoke_workflow_app(
        self,
        app: App,
        workflow: Workflow,
        user: EndUser | Account,
        stream: bool,
        inputs: Mapping,
        files: list[dict],
    ) -> Generator[Mapping | str] | Mapping:
        """
        invoke workflow app
        """
        pause_config = PauseStateLayerConfig(
            session_factory=self._sessions,
            state_owner_user_id=workflow.created_by,
        )

        return WorkflowAppGenerator(
            execution_driver=self._execution_driver, knowledge_retrieval=self._knowledge_retrieval
        ).generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": inputs, "files": files},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=stream,
            call_depth=1,
            pause_state_config=pause_config,
        )

    def invoke_completion_app(
        self,
        app: App,
        user: EndUser | Account,
        stream: bool,
        inputs: Mapping,
        files: list[dict],
        session: Session,
    ) -> Generator[Mapping | str] | Mapping:
        """
        invoke completion app
        """
        return CompletionAppGenerator(knowledge_retrieval=self._knowledge_retrieval).generate(
            app_model=app,
            user=user,
            args={"inputs": inputs, "files": files},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=stream,
            session=session,
        )

    def _get_user(self, user_id: str, app: App) -> EndUser | Account:
        """
        get the user by user id
        """
        with self._sessions() as session:
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

    def _get_app(self, app_id: str, tenant_id: str) -> App:
        """
        get app
        """
        try:
            with self._sessions() as session:
                app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).limit(1))
                if app:
                    session.expunge(app)
        except Exception as e:
            raise ValueError("app not found") from e

        if not app:
            raise ValueError("app not found")

        return app

    def _get_workflow(self, app: App) -> Workflow | None:
        """
        get workflow with an owned session, additionally scoped by tenant and app

        `App.workflow_with_session` resolves by `workflow_id` alone; a plugin
        invocation must also confirm the workflow belongs to this tenant and app.
        """
        if not app.workflow_id:
            return None

        with self._sessions() as session:
            workflow = session.scalar(
                select(Workflow)
                .where(Workflow.id == app.workflow_id, Workflow.tenant_id == app.tenant_id, Workflow.app_id == app.id)
                .limit(1)
            )
            if workflow:
                session.expunge(workflow)
            return workflow

    def _get_app_model_config_dict(self, app: App) -> AppModelConfigDict | None:
        """
        get app model config features without relying on request-scoped session-backed model properties
        """
        if not app.app_model_config_id:
            return None

        with self._sessions() as session:
            app_model_config = session.scalar(
                select(AppModelConfig)
                .where(AppModelConfig.id == app.app_model_config_id, AppModelConfig.app_id == app.id)
                .limit(1)
            )
            if app_model_config is None:
                return None

            annotation_reply = load_annotation_reply_config(session, app_model_config.app_id)
            return app_model_config.to_dict(annotation_reply=annotation_reply)

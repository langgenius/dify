import json

from sqlalchemy.orm import Session

from core.app.app_config.easy_ui_based_app.workflow_graph_builder import WorkflowGraphBuilder
from core.app.app_config.entities import EasyUIBasedAppConfig
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfigManager
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from events.app_event import app_was_created
from models import Account
from models.model import App, AppMode, AppModelConfig, IconType, load_annotation_reply_config
from models.workflow import Workflow, WorkflowType


class WorkflowConverter(WorkflowGraphBuilder):
    """
    App Convert to Workflow Mode
    """

    def convert_to_workflow(
        self,
        app_model: App,
        account: Account,
        name: str,
        icon_type: str,
        icon: str,
        icon_background: str,
        session: Session,
    ):
        """
        Convert app to workflow

        - basic mode of chatbot app

        - expert mode of chatbot app

        - completion app

        :param app_model: App instance
        :param account: Account
        :param name: new app name
        :param icon: new app icon
        :param icon_type: new app icon type
        :param icon_background: new app icon background
        :return: new App instance
        """
        # convert app model config
        app_model_config = (
            session.get(AppModelConfig, app_model.app_model_config_id) if app_model.app_model_config_id else None
        )
        if not app_model_config:
            raise ValueError("App model config is required")

        workflow = self.convert_app_model_config_to_workflow(
            app_model=app_model, app_model_config=app_model_config, account_id=account.id, session=session
        )

        # create new app
        new_app = App()
        new_app.tenant_id = app_model.tenant_id
        new_app.name = name or app_model.name + "(workflow)"
        new_app.mode = AppMode.ADVANCED_CHAT if app_model.mode == AppMode.CHAT else AppMode.WORKFLOW
        new_app.icon_type = IconType(icon_type) if icon_type else app_model.icon_type
        new_app.icon = icon or app_model.icon
        new_app.icon_background = icon_background or app_model.icon_background
        new_app.enable_site = app_model.enable_site
        new_app.enable_api = app_model.enable_api
        new_app.api_rpm = app_model.api_rpm
        new_app.api_rph = app_model.api_rph
        new_app.is_demo = False
        new_app.is_public = app_model.is_public
        new_app.created_by = account.id
        new_app.maintainer = account.id
        new_app.updated_by = account.id
        session.add(new_app)
        session.flush()

        workflow.app_id = new_app.id
        session.commit()

        app_was_created.send(new_app, account=account, session=session)
        session.commit()

        return new_app

    def convert_app_model_config_to_workflow(
        self, app_model: App, app_model_config: AppModelConfig, account_id: str, session: Session
    ):
        """
        Convert app model config to workflow mode
        :param app_model: App instance
        :param app_model_config: AppModelConfig instance
        :param account_id: Account ID
        """
        # get new app mode
        new_app_mode = self._get_new_app_mode(app_model)

        # convert app model config
        app_config = self._convert_to_app_config(
            app_model=app_model, app_model_config=app_model_config, session=session
        )

        graph, features = self.build_graph_from_app_config(
            app_model=app_model,
            app_config=app_config,
            target_app_mode=new_app_mode,
            session=session,
        )

        # create workflow record
        workflow = Workflow(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type=WorkflowType.from_app_mode(new_app_mode).value,
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(graph),
            features=json.dumps(features),
            created_by=account_id,
            environment_variables=[],
            conversation_variables=[],
        )

        session.add(workflow)
        session.commit()

        return workflow

    def _convert_to_app_config(
        self, app_model: App, app_model_config: AppModelConfig, *, session: Session
    ) -> EasyUIBasedAppConfig:
        app_mode_enum = AppMode.value_of(app_model.mode)
        app_config: EasyUIBasedAppConfig
        effective_mode = (
            AppMode.AGENT_CHAT
            if app_model.is_agent_with_session(session=session) and app_mode_enum != AppMode.AGENT_CHAT
            else app_mode_enum
        )
        match effective_mode:
            case AppMode.AGENT_CHAT:
                app_model.mode = AppMode.AGENT_CHAT
                annotation_reply = load_annotation_reply_config(session, app_model_config.app_id)
                app_config = AgentChatAppConfigManager.get_app_config(
                    app_model=app_model,
                    app_model_config=app_model_config,
                    annotation_reply=annotation_reply,
                )
            case AppMode.CHAT:
                annotation_reply = load_annotation_reply_config(session, app_model_config.app_id)
                app_config = ChatAppConfigManager.get_app_config(
                    app_model=app_model,
                    app_model_config=app_model_config,
                    annotation_reply=annotation_reply,
                )
            case AppMode.COMPLETION:
                annotation_reply = load_annotation_reply_config(session, app_model_config.app_id)
                app_config = CompletionAppConfigManager.get_app_config(
                    app_model=app_model,
                    app_model_config=app_model_config,
                    annotation_reply=annotation_reply,
                )
            case _:
                raise ValueError("Invalid app mode")

        return app_config

    def _get_new_app_mode(self, app_model: App) -> AppMode:
        """
        Get new app mode
        :param app_model: App instance
        :return: AppMode
        """
        if app_model.mode == AppMode.COMPLETION:
            return AppMode.WORKFLOW
        else:
            return AppMode.ADVANCED_CHAT

import logging

import httpx
import yaml  # type: ignore

from core.app.segments import factory
from events.app_event import app_model_config_was_updated, app_was_created
from extensions.ext_database import db
from models.account import Account
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow
from services.workflow_service import WorkflowService

logger = logging.getLogger(__name__)

current_dsl_version = "0.1.0"
dsl_to_dify_version_mapping: dict[str, str] = {
    "0.1.0": "0.6.0",  # dsl version -> from dify version
}


class AppDslService:
    @classmethod
    def import_and_create_new_app_from_url(cls, tenant_id: str, url: str, args: dict, account: Account) -> App:
        """
        Import app dsl from url and create new app
        :param tenant_id: tenant id
        :param url: import url
        :param args: request args
        :param account: Account instance
        """
        try:
            max_size = 10 * 1024 * 1024  # 10MB
            timeout = httpx.Timeout(10.0)
            with httpx.stream("GET", url.strip(), follow_redirects=True, timeout=timeout) as response:
                response.raise_for_status()
                total_size = 0
                content = b""
                for chunk in response.iter_bytes():
                    total_size += len(chunk)
                    if total_size > max_size:
                        raise ValueError("File size exceeds the limit of 10MB")
                    content += chunk
        except httpx.HTTPStatusError as http_err:
            raise ValueError(f"HTTP error occurred: {http_err}")
        except httpx.RequestError as req_err:
            raise ValueError(f"Request error occurred: {req_err}")
        except Exception as e:
            raise ValueError(f"Failed to fetch DSL from URL: {e}")

        if not content:
            raise ValueError("Empty content from url")

        try:
            data = content.decode("utf-8")
        except UnicodeDecodeError as e:
            raise ValueError(f"Error decoding content: {e}")

        return cls.import_and_create_new_app(tenant_id, data, args, account)

    @classmethod
    def import_and_create_new_app(cls, tenant_id: str, data: str, args: dict, account: Account) -> App:
        """
        Import app dsl and create new app
        :param tenant_id: tenant id
        :param data: import data
        :param args: request args
        :param account: Account instance
        """
        try:
            import_data = yaml.safe_load(data)
        except yaml.YAMLError:
            raise ValueError("Invalid YAML format in data argument.")

        # check or repair dsl version
        import_data = cls._check_or_fix_dsl(import_data)

        app_data = import_data.get('app')
        if not app_data:
            raise ValueError("Missing app in data argument")

        # get app basic info
        name = args.get("name") if args.get("name") else app_data.get('name')
        description = args.get("description") if args.get("description") else app_data.get('description', '')
        icon = args.get("icon") if args.get("icon") else app_data.get('icon')
        icon_background = args.get("icon_background") if args.get("icon_background") \
            else app_data.get('icon_background')

        # import dsl and create app
        app_mode = AppMode.value_of(app_data.get('mode'))
        if app_mode in [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW]:
            app = cls._import_and_create_new_workflow_based_app(
                tenant_id=tenant_id,
                app_mode=app_mode,
                workflow_data=import_data.get('workflow'),
                account=account,
                name=name,
                description=description,
                icon=icon,
                icon_background=icon_background
            )
        elif app_mode in [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION]:
            app = cls._import_and_create_new_model_config_based_app(
                tenant_id=tenant_id,
                app_mode=app_mode,
                model_config_data=import_data.get('model_config'),
                account=account,
                name=name,
                description=description,
                icon=icon,
                icon_background=icon_background
            )
        else:
            raise ValueError("Invalid app mode")

        return app

    @classmethod
    def import_and_overwrite_workflow(cls, app_model: App, data: str, account: Account) -> Workflow:
        """
        Import app dsl and overwrite workflow
        :param app_model: App instance
        :param data: import data
        :param account: Account instance
        """
        try:
            import_data = yaml.safe_load(data)
        except yaml.YAMLError:
            raise ValueError("Invalid YAML format in data argument.")

        # check or repair dsl version
        import_data = cls._check_or_fix_dsl(import_data)

        app_data = import_data.get('app')
        if not app_data:
            raise ValueError("Missing app in data argument")

        # import dsl and overwrite app
        app_mode = AppMode.value_of(app_data.get('mode'))
        if app_mode not in [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW]:
            raise ValueError("Only support import workflow in advanced-chat or workflow app.")

        if app_data.get('mode') != app_model.mode:
            raise ValueError(
                f"App mode {app_data.get('mode')} is not matched with current app mode {app_mode.value}")

        return cls._import_and_overwrite_workflow_based_app(
            app_model=app_model,
            workflow_data=import_data.get('workflow'),
            account=account,
        )

    @classmethod
    def export_dsl(cls, app_model: App, include_secret:bool = False) -> str:
        """
        Export app
        :param app_model: App instance
        :return:
        """
        app_mode = AppMode.value_of(app_model.mode)

        export_data = {
            "version": current_dsl_version,
            "kind": "app",
            "app": {
                "name": app_model.name,
                "mode": app_model.mode,
                "icon": app_model.icon,
                "icon_background": app_model.icon_background,
                "description": app_model.description
            }
        }

        if app_mode in [AppMode.ADVANCED_CHAT, AppMode.WORKFLOW]:
            cls._append_workflow_export_data(export_data=export_data, app_model=app_model, include_secret=include_secret)
        else:
            cls._append_model_config_export_data(export_data, app_model)

        return yaml.dump(export_data)

    @classmethod
    def _check_or_fix_dsl(cls, import_data: dict) -> dict:
        """
        Check or fix dsl

        :param import_data: import data
        """
        if not import_data.get('version'):
            import_data['version'] = "0.1.0"

        if not import_data.get('kind') or import_data.get('kind') != "app":
            import_data['kind'] = "app"

        if import_data.get('version') != current_dsl_version:
            # Currently only one DSL version, so no difference checks or compatibility fixes will be performed.
            logger.warning(f"DSL version {import_data.get('version')} is not compatible "
                           f"with current version {current_dsl_version}, related to "
                           f"Dify version {dsl_to_dify_version_mapping.get(current_dsl_version)}.")

        return import_data

    @classmethod
    def _import_and_create_new_workflow_based_app(cls,
                                                  tenant_id: str,
                                                  app_mode: AppMode,
                                                  workflow_data: dict,
                                                  account: Account,
                                                  name: str,
                                                  description: str,
                                                  icon: str,
                                                  icon_background: str) -> App:
        """
        Import app dsl and create new workflow based app

        :param tenant_id: tenant id
        :param app_mode: app mode
        :param workflow_data: workflow data
        :param account: Account instance
        :param name: app name
        :param description: app description
        :param icon: app icon
        :param icon_background: app icon background
        """
        if not workflow_data:
            raise ValueError("Missing workflow in data argument "
                             "when app mode is advanced-chat or workflow")

        app = cls._create_app(
            tenant_id=tenant_id,
            app_mode=app_mode,
            account=account,
            name=name,
            description=description,
            icon=icon,
            icon_background=icon_background
        )

        # init draft workflow
        environment_variables_list = workflow_data.get('environment_variables') or []
        environment_variables = [factory.build_variable_from_mapping(obj) for obj in environment_variables_list]
        workflow_service = WorkflowService()
        draft_workflow = workflow_service.sync_draft_workflow(
            app_model=app,
            graph=workflow_data.get('graph', {}),
            features=workflow_data.get('../core/app/features', {}),
            unique_hash=None,
            account=account,
            environment_variables=environment_variables,
        )
        workflow_service.publish_workflow(
            app_model=app,
            account=account,
            draft_workflow=draft_workflow
        )

        return app

    @classmethod
    def _import_and_overwrite_workflow_based_app(cls,
                                                 app_model: App,
                                                 workflow_data: dict,
                                                 account: Account) -> Workflow:
        """
        Import app dsl and overwrite workflow based app

        :param app_model: App instance
        :param workflow_data: workflow data
        :param account: Account instance
        """
        if not workflow_data:
            raise ValueError("Missing workflow in data argument "
                             "when app mode is advanced-chat or workflow")

        # fetch draft workflow by app_model
        workflow_service = WorkflowService()
        current_draft_workflow = workflow_service.get_draft_workflow(app_model=app_model)
        if current_draft_workflow:
            unique_hash = current_draft_workflow.unique_hash
        else:
            unique_hash = None

        # sync draft workflow
        environment_variables_list = workflow_data.get('environment_variables') or []
        environment_variables = [factory.build_variable_from_mapping(obj) for obj in environment_variables_list]
        draft_workflow = workflow_service.sync_draft_workflow(
            app_model=app_model,
            graph=workflow_data.get('graph', {}),
            features=workflow_data.get('features', {}),
            unique_hash=unique_hash,
            account=account,
            environment_variables=environment_variables,
        )

        return draft_workflow

    @classmethod
    def _import_and_create_new_model_config_based_app(cls,
                                                      tenant_id: str,
                                                      app_mode: AppMode,
                                                      model_config_data: dict,
                                                      account: Account,
                                                      name: str,
                                                      description: str,
                                                      icon: str,
                                                      icon_background: str) -> App:
        """
        Import app dsl and create new model config based app

        :param tenant_id: tenant id
        :param app_mode: app mode
        :param model_config_data: model config data
        :param account: Account instance
        :param name: app name
        :param description: app description
        :param icon: app icon
        :param icon_background: app icon background
        """
        if not model_config_data:
            raise ValueError("Missing model_config in data argument "
                             "when app mode is chat, agent-chat or completion")

        app = cls._create_app(
            tenant_id=tenant_id,
            app_mode=app_mode,
            account=account,
            name=name,
            description=description,
            icon=icon,
            icon_background=icon_background
        )

        app_model_config = AppModelConfig()
        app_model_config = app_model_config.from_model_config_dict(model_config_data)
        app_model_config.app_id = app.id

        db.session.add(app_model_config)
        db.session.commit()

        app.app_model_config_id = app_model_config.id

        app_model_config_was_updated.send(
            app,
            app_model_config=app_model_config
        )

        return app

    @classmethod
    def _create_app(cls,
                    tenant_id: str,
                    app_mode: AppMode,
                    account: Account,
                    name: str,
                    description: str,
                    icon: str,
                    icon_background: str) -> App:
        """
        Create new app

        :param tenant_id: tenant id
        :param app_mode: app mode
        :param account: Account instance
        :param name: app name
        :param description: app description
        :param icon: app icon
        :param icon_background: app icon background
        """
        app = App(
            tenant_id=tenant_id,
            mode=app_mode.value,
            name=name,
            description=description,
            icon=icon,
            icon_background=icon_background,
            enable_site=True,
            enable_api=True
        )

        db.session.add(app)
        db.session.commit()

        app_was_created.send(app, account=account)

        return app

    @classmethod
    def _append_workflow_export_data(cls, *, export_data: dict, app_model: App, include_secret: bool) -> None:
        """
        Append workflow export data
        :param export_data: export data
        :param app_model: App instance
        """
        workflow_service = WorkflowService()
        workflow = workflow_service.get_draft_workflow(app_model)
        if not workflow:
            raise ValueError("Missing draft workflow configuration, please check.")

        export_data['workflow'] = workflow.to_dict(include_secret=include_secret)

    @classmethod
    def _append_model_config_export_data(cls, export_data: dict, app_model: App) -> None:
        """
        Append model config export data
        :param export_data: export data
        :param app_model: App instance
        """
        app_model_config = app_model.app_model_config
        if not app_model_config:
            raise ValueError("Missing app configuration, please check.")

        export_data['model_config'] = app_model_config.to_dict()

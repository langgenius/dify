import logging
from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any, Literal

import yaml
from packaging import version

from core.helper import ssrf_proxy
from events.app_event import app_model_config_was_updated, app_was_created
from extensions.ext_database import db
from factories import variable_factory
from models.account import Account
from models.model import App, AppMode, AppModelConfig
from models.workflow import Workflow
from services.workflow_service import WorkflowService

from .exc import (
    ContentDecodingError,
    EmptyContentError,
    FileSizeLimitExceededError,
    InvalidAppModeError,
    InvalidYAMLFormatError,
    MissingAppDataError,
    MissingModelConfigError,
    MissingWorkflowDataError,
)

logger = logging.getLogger(__name__)

CURRENT_DSL_VERSION = "0.1.3"


class Status(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    SUCCESS = "success"


@dataclass
class ImportResult:
    app: App
    current_dsl_version: str
    imported_dsl_version: str
    status: Status

    def to_dict(self):
        return {
            "app": self.app,
            "current_dsl_version": self.current_dsl_version,
            "imported_dsl_version": self.imported_dsl_version,
            "status": self.status.value,
        }


def _get_status(current_version: str, imported_version: str) -> Status:
    try:
        current_ver = version.parse(current_version)
        imported_ver = version.parse(imported_version)
    except version.InvalidVersion:
        return Status.ERROR

    # Compare major version
    if current_ver.major != imported_ver.major:
        return Status.ERROR

    # Compare minor version
    if current_ver.minor != imported_ver.minor:
        return Status.WARNING

    return Status.SUCCESS


def _check_or_fix_dsl(dsl_mapping: Mapping[str, Any]) -> Mapping[str, Any]:
    fixed_mapping = dict(dsl_mapping)
    if not fixed_mapping.get("version"):
        fixed_mapping["version"] = "0.1.0"

    if not fixed_mapping.get("kind") or fixed_mapping.get("kind") != "app":
        fixed_mapping["kind"] = "app"

    imported_version = fixed_mapping.get("version")
    if imported_version != CURRENT_DSL_VERSION:
        if imported_version and version.parse(imported_version) > version.parse(CURRENT_DSL_VERSION):
            errmsg = (
                f"The imported DSL version {imported_version} is newer than "
                f"the current supported version {CURRENT_DSL_VERSION}. "
                f"Please upgrade your Dify instance to import this configuration."
            )
            logger.warning(errmsg)
            # raise DSLVersionNotSupportedError(errmsg)
        else:
            logger.warning(
                f"DSL version {imported_version} is older than "
                f"the current version {CURRENT_DSL_VERSION}. "
                f"This may cause compatibility issues."
            )

    return fixed_mapping


class AppDslService:
    @classmethod
    def import_and_create_new_app_from_url(
        cls,
        *,
        tenant_id: str,
        url: str,
        account: Account,
        name: str | None = None,
        description: str | None = None,
        icon_type: Literal["emoji", "image"] | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> ImportResult:
        max_size = 10 * 1024 * 1024  # 10MB
        response = ssrf_proxy.get(url.strip(), follow_redirects=True, timeout=(10, 10))
        response.raise_for_status()
        content = response.content

        if len(content) > max_size:
            raise FileSizeLimitExceededError("File size exceeds the limit of 10MB")

        if not content:
            raise EmptyContentError("Empty content from url")

        try:
            data = content.decode("utf-8")
        except UnicodeDecodeError as e:
            raise ContentDecodingError(f"Error decoding content: {e}")

        try:
            import_data = yaml.safe_load(data)
        except yaml.YAMLError:
            raise InvalidYAMLFormatError("Invalid YAML format in data argument.")

        return cls.import_and_create_new_app(
            tenant_id=tenant_id,
            data=import_data,
            account=account,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
        )

    @classmethod
    def import_and_create_new_app(
        cls,
        *,
        tenant_id: str,
        data: Mapping[str, Any],
        account: Account,
        name: str | None = None,
        description: str | None = None,
        icon_type: Literal["emoji", "image"] | None = None,
        icon: str | None = None,
        icon_background: str | None = None,
    ) -> ImportResult:
        imported_version = data.get("version", "0.1.0")
        status = _get_status(CURRENT_DSL_VERSION, imported_version)

        # check or repair dsl version
        data = _check_or_fix_dsl(data)

        app_data = data.get("app")
        if not app_data:
            raise MissingAppDataError("Missing app in data argument")

        # get app basic info
        name = name or str(app_data.get("name", ""))
        description = description or str(app_data.get("description", ""))
        icon_background = icon_background or str(app_data.get("icon_background", ""))
        use_icon_as_answer_icon = app_data.get("use_icon_as_answer_icon", False)

        raw_icon_type = app_data.get("icon_type")
        raw_icon_type = raw_icon_type or ""
        raw_icon_type = str(raw_icon_type)
        if icon_type or raw_icon_type:
            icon_type_value = icon_type or raw_icon_type
            if icon_type_value not in ("emoji", "image"):
                raise ValueError(f"Invalid icon_type: {icon_type_value}. Must be either 'emoji' or 'image'")
            icon_type = icon_type_value
        else:
            icon_type = "emoji"
        icon = icon or str(app_data.get("icon", ""))

        # import dsl and create app
        app_mode = AppMode(app_data["mode"])

        if app_mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            workflow_data = data.get("workflow")
            if not workflow_data or not isinstance(workflow_data, dict):
                raise MissingWorkflowDataError(
                    "Missing workflow in data argument when app mode is advanced-chat or workflow"
                )

            app = cls._import_and_create_new_workflow_based_app(
                tenant_id=tenant_id,
                app_mode=app_mode,
                workflow_data=workflow_data,
                account=account,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
                use_icon_as_answer_icon=use_icon_as_answer_icon,
            )
        elif app_mode in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.COMPLETION}:
            model_config = data.get("model_config")
            if not model_config or not isinstance(model_config, dict):
                raise MissingModelConfigError(
                    "Missing model_config in data argument when app mode is chat, agent-chat or completion"
                )

            app = cls._import_and_create_new_model_config_based_app(
                tenant_id=tenant_id,
                app_mode=app_mode,
                model_config_data=model_config,
                account=account,
                name=name,
                description=description,
                icon_type=icon_type,
                icon=icon,
                icon_background=icon_background,
                use_icon_as_answer_icon=use_icon_as_answer_icon,
            )
        else:
            raise InvalidAppModeError("Invalid app mode")

        return ImportResult(
            app=app,
            current_dsl_version=CURRENT_DSL_VERSION,
            imported_dsl_version=imported_version,
            status=status,
        )

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
            raise InvalidYAMLFormatError("Invalid YAML format in data argument.")

        # check or repair dsl version
        import_data = _check_or_fix_dsl(import_data)

        app_data = import_data.get("app")
        if not app_data:
            raise MissingAppDataError("Missing app in data argument")

        # import dsl and overwrite app
        app_mode = AppMode.value_of(app_data.get("mode"))
        if app_mode not in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            raise InvalidAppModeError("Only support import workflow in advanced-chat or workflow app.")

        if app_data.get("mode") != app_model.mode:
            raise ValueError(f"App mode {app_data.get('mode')} is not matched with current app mode {app_mode.value}")

        workflow_data = import_data.get("workflow")
        if not workflow_data or not isinstance(workflow_data, dict):
            raise MissingWorkflowDataError(
                "Missing workflow in data argument when app mode is advanced-chat or workflow"
            )

        return cls._import_and_overwrite_workflow_based_app(
            app_model=app_model,
            workflow_data=workflow_data,
            account=account,
        )

    @classmethod
    def export_dsl(cls, app_model: App, include_secret: bool = False) -> str:
        """
        Export app
        :param app_model: App instance
        :return:
        """
        app_mode = AppMode.value_of(app_model.mode)

        export_data = {
            "version": CURRENT_DSL_VERSION,
            "kind": "app",
            "app": {
                "name": app_model.name,
                "mode": app_model.mode,
                "icon": "🤖" if app_model.icon_type == "image" else app_model.icon,
                "icon_background": "#FFEAD5" if app_model.icon_type == "image" else app_model.icon_background,
                "description": app_model.description,
                "use_icon_as_answer_icon": app_model.use_icon_as_answer_icon,
            },
        }

        if app_mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            cls._append_workflow_export_data(
                export_data=export_data, app_model=app_model, include_secret=include_secret
            )
        else:
            cls._append_model_config_export_data(export_data, app_model)

        return yaml.dump(export_data, allow_unicode=True)

    @classmethod
    def _import_and_create_new_workflow_based_app(
        cls,
        tenant_id: str,
        app_mode: AppMode,
        workflow_data: Mapping[str, Any],
        account: Account,
        name: str,
        description: str,
        icon_type: str,
        icon: str,
        icon_background: str,
        use_icon_as_answer_icon: bool,
    ) -> App:
        """
        Import app dsl and create new workflow based app

        :param tenant_id: tenant id
        :param app_mode: app mode
        :param workflow_data: workflow data
        :param account: Account instance
        :param name: app name
        :param description: app description
        :param icon_type: app icon type, "emoji" or "image"
        :param icon: app icon
        :param icon_background: app icon background
        :param use_icon_as_answer_icon: use app icon as answer icon
        """
        if not workflow_data:
            raise MissingWorkflowDataError(
                "Missing workflow in data argument when app mode is advanced-chat or workflow"
            )

        app = cls._create_app(
            tenant_id=tenant_id,
            app_mode=app_mode,
            account=account,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            use_icon_as_answer_icon=use_icon_as_answer_icon,
        )

        # init draft workflow
        environment_variables_list = workflow_data.get("environment_variables") or []
        environment_variables = [
            variable_factory.build_variable_from_mapping(obj) for obj in environment_variables_list
        ]
        conversation_variables_list = workflow_data.get("conversation_variables") or []
        conversation_variables = [
            variable_factory.build_variable_from_mapping(obj) for obj in conversation_variables_list
        ]
        workflow_service = WorkflowService()
        draft_workflow = workflow_service.sync_draft_workflow(
            app_model=app,
            graph=workflow_data.get("graph", {}),
            features=workflow_data.get("features", {}),
            unique_hash=None,
            account=account,
            environment_variables=environment_variables,
            conversation_variables=conversation_variables,
        )
        workflow_service.publish_workflow(app_model=app, account=account, draft_workflow=draft_workflow)

        return app

    @classmethod
    def _import_and_overwrite_workflow_based_app(
        cls, app_model: App, workflow_data: Mapping[str, Any], account: Account
    ) -> Workflow:
        """
        Import app dsl and overwrite workflow based app

        :param app_model: App instance
        :param workflow_data: workflow data
        :param account: Account instance
        """
        if not workflow_data:
            raise MissingWorkflowDataError(
                "Missing workflow in data argument when app mode is advanced-chat or workflow"
            )

        # fetch draft workflow by app_model
        workflow_service = WorkflowService()
        current_draft_workflow = workflow_service.get_draft_workflow(app_model=app_model)
        if current_draft_workflow:
            unique_hash = current_draft_workflow.unique_hash
        else:
            unique_hash = None

        # sync draft workflow
        environment_variables_list = workflow_data.get("environment_variables") or []
        environment_variables = [
            variable_factory.build_variable_from_mapping(obj) for obj in environment_variables_list
        ]
        conversation_variables_list = workflow_data.get("conversation_variables") or []
        conversation_variables = [
            variable_factory.build_variable_from_mapping(obj) for obj in conversation_variables_list
        ]
        draft_workflow = workflow_service.sync_draft_workflow(
            app_model=app_model,
            graph=workflow_data.get("graph", {}),
            features=workflow_data.get("features", {}),
            unique_hash=unique_hash,
            account=account,
            environment_variables=environment_variables,
            conversation_variables=conversation_variables,
        )

        return draft_workflow

    @classmethod
    def _import_and_create_new_model_config_based_app(
        cls,
        tenant_id: str,
        app_mode: AppMode,
        model_config_data: Mapping[str, Any],
        account: Account,
        name: str,
        description: str,
        icon_type: str,
        icon: str,
        icon_background: str,
        use_icon_as_answer_icon: bool,
    ) -> App:
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
            raise MissingModelConfigError(
                "Missing model_config in data argument when app mode is chat, agent-chat or completion"
            )

        app = cls._create_app(
            tenant_id=tenant_id,
            app_mode=app_mode,
            account=account,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            use_icon_as_answer_icon=use_icon_as_answer_icon,
        )

        app_model_config = AppModelConfig()
        app_model_config = app_model_config.from_model_config_dict(model_config_data)
        app_model_config.app_id = app.id
        app_model_config.created_by = account.id
        app_model_config.updated_by = account.id

        db.session.add(app_model_config)
        db.session.commit()

        app.app_model_config_id = app_model_config.id

        app_model_config_was_updated.send(app, app_model_config=app_model_config)

        return app

    @classmethod
    def _create_app(
        cls,
        tenant_id: str,
        app_mode: AppMode,
        account: Account,
        name: str,
        description: str,
        icon_type: str,
        icon: str,
        icon_background: str,
        use_icon_as_answer_icon: bool,
    ) -> App:
        """
        Create new app

        :param tenant_id: tenant id
        :param app_mode: app mode
        :param account: Account instance
        :param name: app name
        :param description: app description
        :param icon_type: app icon type, "emoji" or "image"
        :param icon: app icon
        :param icon_background: app icon background
        :param use_icon_as_answer_icon: use app icon as answer icon
        """
        app = App(
            tenant_id=tenant_id,
            mode=app_mode.value,
            name=name,
            description=description,
            icon_type=icon_type,
            icon=icon,
            icon_background=icon_background,
            enable_site=True,
            enable_api=True,
            use_icon_as_answer_icon=use_icon_as_answer_icon,
            created_by=account.id,
            updated_by=account.id,
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

        export_data["workflow"] = workflow.to_dict(include_secret=include_secret)

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

        export_data["model_config"] = app_model_config.to_dict()

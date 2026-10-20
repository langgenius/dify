"""Convert a basic app with external preparation and one atomic persistence operation."""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from typing import Any, Protocol

from core.app.app_config.entities import EasyUIBasedAppConfig
from machinery.context import RequestContext
from models.model import AppMode
from models.workflow_conversion import ConversionExtension, ConvertedWorkflow, WorkflowConversionSource
from services.entities.app_entities import AppCreationSettings, AppEvent, CreateAppParams
from services.errors.workflow_service import WorkflowConversionError


class WorkflowConversionApps(Protocol):
    def conversion_source(self, context: RequestContext, app_id: str) -> WorkflowConversionSource: ...
    def conversion_extensions(self, context: RequestContext, ids: set[str]) -> Sequence[ConversionExtension]: ...
    def create_converted(
        self,
        context: RequestContext,
        source_id: str,
        params: CreateAppParams,
        settings: AppCreationSettings,
        workflow: ConvertedWorkflow,
    ) -> AppEvent: ...


class AppCreatedNotifier(Protocol):
    def __call__(self, *, event: AppEvent, account_id: str, backing_agent_id: str | None) -> None: ...


class WorkflowConversionBuilder(Protocol):
    def app_config(self, source: WorkflowConversionSource) -> EasyUIBasedAppConfig: ...
    def convert(
        self, app_config: EasyUIBasedAppConfig, extensions: Mapping[str, ConversionExtension]
    ) -> ConvertedWorkflow: ...


class WorkflowConversionService:
    def __init__(
        self,
        apps: WorkflowConversionApps,
        *,
        converter: WorkflowConversionBuilder,
        decrypt_token: Callable[[str, str], str],
        notify_created: AppCreatedNotifier,
    ) -> None:
        self._apps = apps
        self._decrypt_token = decrypt_token
        self._notify_created = notify_created
        self._converter = converter

    def convert(self, context: RequestContext, app_id: str, args: dict[str, Any]) -> str:
        source = self._apps.conversion_source(context, app_id)
        if source.mode not in {AppMode.CHAT, AppMode.COMPLETION}:
            raise WorkflowConversionError(f"Current App mode: {source.mode} is not supported convert to workflow.")
        if source.model_config is None:
            raise WorkflowConversionError("App model config is required")
        config = self._converter.app_config(source)
        extension_ids = {
            extension_id
            for variable in config.external_data_variables
            if variable.type == "api" and (extension_id := variable.config.get("api_based_extension_id"))
        }
        extensions = {
            extension.id: replace(
                extension, api_key=self._decrypt_token(context.active_workspace_id, extension.api_key)
            )
            for extension in self._apps.conversion_extensions(context, extension_ids)
        }
        workflow = self._converter.convert(config, extensions)
        params = CreateAppParams(
            name=args.get("name", "Default Name") or source.name + "(workflow)",
            mode="workflow" if workflow.mode == AppMode.WORKFLOW else "advanced-chat",
            icon_type=args.get("icon_type", "emoji") or source.icon_type,
            icon=args.get("icon", "🤖") or source.icon,
            icon_background=args.get("icon_background", "#FFEAD5") or source.icon_background,
            api_rpm=source.api_rpm,
            api_rph=source.api_rph,
        )
        settings = AppCreationSettings(
            app={
                "enable_site": source.enable_site,
                "enable_api": source.enable_api,
                "is_demo": False,
                "is_public": source.is_public,
            },
            model_config=None,
        )
        created = self._apps.create_converted(context, app_id, params, settings, workflow)
        self._notify_created(event=created, account_id=context.account_id, backing_agent_id=None)
        return created.id

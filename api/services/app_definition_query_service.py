"""Application service for reading an app's externally visible definition."""

import json
from collections.abc import Mapping, Sequence
from typing import Any, NamedTuple, Protocol

from core.app.app_config.common.parameters_mapping import AppParametersDict, get_parameters_from_feature_dict
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from services.errors.app import AppAbnormalStatusError, AppApiDisabledError
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError


class AppParameterConfig(NamedTuple):
    features_dict: Mapping[str, Any]
    user_input_form: list[dict[str, Any]]


class AppToolIconSource(NamedTuple):
    provider_type: str
    provider_id: str
    tool_name: str
    provider_icon: str | None


class AppDefinitionSummary(NamedTuple):
    name: str
    description: str | None
    tags: tuple[str, ...]
    mode: str
    author_name: str | None


class ServiceApiAppRecord(NamedTuple):
    """App admission state; a null tenant status means the workspace is missing."""

    app_id: str
    tenant_id: str
    mode: str
    status: str
    enable_api: bool
    tenant_status: str | None


class AppSiteConfiguration(NamedTuple):
    title: str
    chat_color_theme: str | None
    chat_color_theme_inverted: bool
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    description: str | None
    copyright: str | None
    privacy_policy: str | None
    input_placeholder: str | None
    custom_disclaimer: str | None
    default_language: str
    prompt_public: bool
    show_workflow_steps: bool
    use_icon_as_answer_icon: bool


class AppDefinitionQuery(Protocol):
    def get_mode(self, app_id: str) -> str | None: ...

    def get_service_api_record(self, app_id: str, *, tenant_id: str | None = None) -> ServiceApiAppRecord | None: ...

    def has_service_api_owner(self, tenant_id: str) -> bool: ...

    def get_published_parameter_config(
        self,
        app_id: str,
        *,
        public_runtime: bool = False,
    ) -> AppParameterConfig | None: ...

    def get_tool_icon_sources(self, app_id: str) -> Sequence[AppToolIconSource] | None: ...

    def get_summary(self, app_id: str) -> AppDefinitionSummary | None: ...

    def get_site_configuration(self, app_id: str) -> AppSiteConfiguration | None: ...


class AppDefinitionUnavailableError(ValueError):
    """Raised when an app definition is unavailable."""


class AppDefinitionNotPublishedError(AppDefinitionUnavailableError):
    """Raised when a public Agent App has not been published."""


_API_TOOL_FALLBACK_ICON = {"background": "#252525", "content": "\ud83d\ude01"}


class AppDefinitionQueryService:
    def __init__(
        self,
        *,
        definitions: AppDefinitionQuery,
        builtin_icon_url_prefix: str,
    ) -> None:
        self._definitions = definitions
        self._builtin_icon_url_prefix = builtin_icon_url_prefix

    def get_service_api_app(self, app_id: str | None, *, tenant_id: str | None = None) -> ServiceApiAppRecord:
        """Return an app admitted for Service API access, or raise a domain error.

        ``None`` means the API token no longer references an app. The repository
        closes its read session before this policy runs or an end user is provisioned.
        Resource-token grants provide ``tenant_id`` to constrain the lookup to their
        workspace; ``None`` retains legacy app tokens' app-ID-only lookup.
        """
        if app_id is None:
            raise AppDefinitionUnavailableError("The app no longer exists.")
        app = self._definitions.get_service_api_record(app_id, tenant_id=tenant_id)
        if app is None:
            raise AppDefinitionUnavailableError("The app no longer exists.")
        if app.status != "normal":
            raise AppAbnormalStatusError("The app's status is abnormal.")
        if not app.enable_api:
            raise AppApiDisabledError("The app's API service has been disabled.")
        if app.tenant_status is None:
            raise WorkspaceNotFoundError("Tenant does not exist.")
        if app.tenant_status == "archive":
            raise WorkspaceArchivedError("The workspace's status is archived.")
        return app

    def has_service_api_owner(self, tenant_id: str) -> bool:
        """Whether an active API workspace still has its legacy owner identity."""
        return self._definitions.has_service_api_owner(tenant_id)

    def get_mode(self, app_id: str) -> str:
        mode = self._definitions.get_mode(app_id)
        if mode is None:
            raise AppDefinitionUnavailableError("App not found")
        return mode

    def get_parameters(self, app_id: str) -> AppParametersDict:
        config = self._definitions.get_published_parameter_config(app_id)
        return self._map_parameters(config)

    def get_public_parameters(self, app_id: str) -> AppParametersDict:
        """Read public parameters, using the published Soul for Agent Apps."""
        try:
            config = self._definitions.get_published_parameter_config(app_id, public_runtime=True)
        except AgentAppNotPublishedError:
            raise AppDefinitionNotPublishedError from None
        except AgentAppGeneratorError:
            raise AppDefinitionUnavailableError from None

        return self._map_parameters(config)

    @staticmethod
    def _map_parameters(config: AppParameterConfig | None) -> AppParametersDict:
        if config is None:
            raise AppDefinitionUnavailableError

        return get_parameters_from_feature_dict(
            features_dict=config.features_dict,
            user_input_form=config.user_input_form,
        )

    def get_tool_icons(self, app_id: str) -> dict[str, Any]:
        tools = self._definitions.get_tool_icon_sources(app_id)
        if tools is None:
            raise AppDefinitionUnavailableError("App not found")

        tool_icons: dict[str, Any] = {}
        for tool in tools:
            if tool.provider_type == "builtin":
                tool_icons[tool.tool_name] = self._builtin_icon_url_prefix + tool.provider_id + "/icon"
            elif tool.provider_type == "api":
                try:
                    if tool.provider_icon is None:
                        raise ValueError("API tool provider not found")
                    tool_icons[tool.tool_name] = json.loads(tool.provider_icon)
                except (TypeError, ValueError):
                    tool_icons[tool.tool_name] = _API_TOOL_FALLBACK_ICON.copy()

        return tool_icons

    def get_summary(self, app_id: str) -> AppDefinitionSummary:
        summary = self._definitions.get_summary(app_id)
        if summary is None:
            raise AppDefinitionUnavailableError("App not found")
        return summary

    def get_site_configuration(self, app_id: str) -> AppSiteConfiguration:
        configuration = self._definitions.get_site_configuration(app_id)
        if configuration is None:
            raise AppDefinitionUnavailableError("Site not found")
        return configuration

"""Application service for reading an app's externally visible definition."""

import json
from collections.abc import Callable, Mapping, Sequence
from typing import Any, NamedTuple, Protocol

from pydantic import Field

from core.app.app_config.common.parameters_mapping import AppParametersDict, get_parameters_from_feature_dict
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from services.end_user_connections.errors import ConnectionError
from services.entities.tool_connection_entities import ConnectionRevisions, ToolConnectionRequirement
from services.errors.app import AppAbnormalStatusError, AppApiDisabledError
from services.errors.workspace import WorkspaceArchivedError, WorkspaceNotFoundError


class AppParameterConfig(NamedTuple):
    features_dict: Mapping[str, Any]
    user_input_form: list[dict[str, Any]]


class WebAppParameterConfig(NamedTuple):
    parameters: AppParameterConfig
    default_language: str
    # Non-workflow app modes have no workflow version or personal tool requirements.
    workflow_id: str | None
    requires_end_user_connections: bool
    graph: Mapping[str, Any] | None


class WebAppConnectionRequirement(ToolConnectionRequirement):
    provider_label: str = Field(
        description="Tool provider display name in the WebApp's configured language, falling back to English."
    )
    plugin_unique_identifier: str = Field(description="Exact plugin artifact recorded in connection_revision.")
    icon: str = Field(description="Plugin icon URL, using the Integrations asset endpoint.")
    icon_dark: str | None = Field(description="Dark plugin icon URL; null when the plugin has no dark icon.")


class WebAppParametersDict(AppParametersDict):
    connection_revision: str | None
    requires_end_user_connections: bool
    connection_requirements: tuple[WebAppConnectionRequirement, ...]


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

    def get_service_api_owner_id(self, tenant_id: str) -> str | None:
        """Return the active workspace's owner ID, or None when that identity is unavailable."""
        ...

    def get_published_parameter_config(
        self,
        app_id: str,
        *,
        public_runtime: bool = False,
    ) -> AppParameterConfig | None: ...

    def get_web_parameter_config(self, app_id: str, tenant_id: str) -> WebAppParameterConfig | None: ...

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
        get_connection_requirements: Callable[[Mapping[str, Any]], tuple[ToolConnectionRequirement, ...]],
        connection_revisions: ConnectionRevisions,
        plugin_readme: Callable[[str, str, str], str],
        plugin_asset: Callable[[str, str, str], bytes],
    ) -> None:
        self._definitions = definitions
        self._connection_revisions = connection_revisions
        self._builtin_icon_url_prefix = builtin_icon_url_prefix
        self._get_connection_requirements = get_connection_requirements
        self._plugin_readme = plugin_readme
        self._plugin_asset = plugin_asset

    def get_service_api_app(self, app_id: str | None, *, tenant_id: str | None = None) -> ServiceApiAppRecord:
        """Return an app admitted for Service API access, or raise a domain error.

        ``None`` means the API token no longer references an app. The repository
        closes its read session before this policy runs or an end user is provisioned.
        Credentials with a recorded ``tenant_id`` constrain the lookup to that
        workspace; ``None`` supports historical app keys without a tenant ID.
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

    def get_service_api_owner_id(self, tenant_id: str) -> str | None:
        """Return the active workspace's legacy owner identity; None means unavailable."""
        return self._definitions.get_service_api_owner_id(tenant_id)

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

    def get_web_parameters(self, app_id: str, tenant_id: str) -> WebAppParametersDict:
        """Read inputs and connection requirements from one published definition."""
        try:
            config = self._definitions.get_web_parameter_config(app_id, tenant_id)
        except AgentAppNotPublishedError:
            raise AppDefinitionNotPublishedError from None
        except AgentAppGeneratorError:
            raise AppDefinitionUnavailableError from None
        if config is None:
            raise AppDefinitionUnavailableError()
        try:
            requirements = self._get_connection_requirements(config.graph) if config.graph is not None else ()
            revision, providers = (
                self._connection_revisions.resolve(tenant_id, app_id, config.graph)
                if config.workflow_id is not None and config.graph is not None
                else (None, ())
            )
            providers_by_name = {provider.provider: provider for provider in providers}
            web_requirements = []
            for requirement in requirements:
                metadata = providers_by_name[requirement.provider]
                provider_labels = {
                    "en-US": metadata.provider_label.en_US,
                    "zh-Hans": metadata.provider_label.zh_Hans,
                    "pt-BR": metadata.provider_label.pt_BR,
                    "ja-JP": metadata.provider_label.ja_JP,
                }
                web_requirements.append(
                    WebAppConnectionRequirement(
                        **requirement.model_dump(),
                        provider_label=provider_labels.get(config.default_language) or metadata.provider_label.en_US,
                        plugin_unique_identifier=metadata.plugin_unique_identifier,
                        icon=metadata.icon,
                        icon_dark=metadata.icon_dark,
                    )
                )
        except (KeyError, TypeError, ValueError, ConnectionError):
            raise AppDefinitionUnavailableError() from None
        return {
            **self._map_parameters(config.parameters),
            "connection_revision": revision,
            "requires_end_user_connections": config.requires_end_user_connections,
            "connection_requirements": tuple(web_requirements),
        }

    def get_web_plugin_readme(self, app_id: str, tenant_id: str, plugin_unique_identifier: str, language: str) -> str:
        """Only expose documentation for this App's published personal tool providers."""
        self._require_web_plugin(app_id, tenant_id, plugin_unique_identifier)
        return self._plugin_readme(tenant_id, plugin_unique_identifier, language)

    def get_web_plugin_asset(self, app_id: str, tenant_id: str, plugin_unique_identifier: str, file_name: str) -> bytes:
        """Read an asset relative to the authorized plugin's packaged _assets directory."""
        self._require_web_plugin(app_id, tenant_id, plugin_unique_identifier)
        if (
            any(part in {"", ".", ".."} for part in file_name.split("/"))
            or "\\" in file_name
            or any(ord(character) < 32 or ord(character) == 127 for character in file_name)
        ):
            raise ValueError("Invalid plugin asset filename.")
        try:
            return self._plugin_asset(tenant_id, plugin_unique_identifier, file_name)
        except ValueError:
            raise AppDefinitionUnavailableError() from None

    def _require_web_plugin(self, app_id: str, tenant_id: str, plugin_unique_identifier: str) -> None:
        parameters = self.get_web_parameters(app_id, tenant_id)
        if not any(
            requirement.plugin_unique_identifier == plugin_unique_identifier
            for requirement in parameters["connection_requirements"]
        ):
            raise AppDefinitionUnavailableError()

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

"""Application service for reading an app's externally visible definition."""

import json
from collections.abc import Mapping, Sequence
from typing import Any, NamedTuple, Protocol

from core.app.app_config.common.parameters_mapping import AppParametersDict, get_parameters_from_feature_dict


class AppParameterConfig(NamedTuple):
    features_dict: Mapping[str, Any]
    user_input_form: list[dict[str, Any]]


class AppToolIconSource(NamedTuple):
    provider_type: str
    provider_id: str
    tool_name: str
    provider_icon: str | None


class AppDefinitionQuery(Protocol):
    def get_published_parameter_config(self, app_id: str) -> AppParameterConfig | None: ...

    def get_tool_icon_sources(self, app_id: str) -> Sequence[AppToolIconSource] | None: ...


class AppDefinitionUnavailableError(ValueError):
    """Raised when an app definition is unavailable."""


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

    def get_parameters(self, app_id: str) -> AppParametersDict:
        config = self._definitions.get_published_parameter_config(app_id)
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

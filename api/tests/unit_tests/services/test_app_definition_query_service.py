from unittest.mock import MagicMock, create_autospec, patch

import pytest

import services.app_definition_query_service as module
from core.app.apps.agent_app.errors import AgentAppGeneratorError, AgentAppNotPublishedError
from services.app_definition_query_service import (
    AppDefinitionNotPublishedError,
    AppDefinitionQuery,
    AppDefinitionQueryService,
    AppDefinitionSummary,
    AppDefinitionUnavailableError,
    AppParameterConfig,
    AppToolIconSource,
)

_BUILTIN_ICON_URL_PREFIX = "https://console.example/console/api/workspaces/current/tool-provider/builtin/"


def _service() -> tuple[AppDefinitionQueryService, MagicMock]:
    definitions: MagicMock = create_autospec(AppDefinitionQuery, instance=True, spec_set=True)
    return (
        AppDefinitionQueryService(
            definitions=definitions,
            builtin_icon_url_prefix=_BUILTIN_ICON_URL_PREFIX,
        ),
        definitions,
    )


def test_get_parameters_maps_published_config() -> None:
    service, definitions = _service()
    config = AppParameterConfig(
        features_dict={"opening_statement": "Hello"},
        user_input_form=[{"text-input": {"variable": "query"}}],
    )
    definitions.get_published_parameter_config.return_value = config
    mapped = {"mapped": True}

    with patch.object(module, "get_parameters_from_feature_dict", return_value=mapped) as map_parameters:
        result = service.get_parameters("app-1")

    assert result is mapped
    definitions.get_published_parameter_config.assert_called_once_with("app-1")
    map_parameters.assert_called_once_with(
        features_dict=config.features_dict,
        user_input_form=config.user_input_form,
    )


def test_get_parameters_rejects_missing_config() -> None:
    service, definitions = _service()
    definitions.get_published_parameter_config.return_value = None

    with pytest.raises(AppDefinitionUnavailableError):
        service.get_parameters("app-1")


def test_get_public_parameters_maps_public_config() -> None:
    service, definitions = _service()
    config = AppParameterConfig(
        features_dict={"opening_statement": "Hello"},
        user_input_form=[{"text-input": {"variable": "query"}}],
    )
    definitions.get_published_parameter_config.return_value = config
    mapped = {"mapped": True}

    with patch.object(module, "get_parameters_from_feature_dict", return_value=mapped):
        result = service.get_public_parameters("app-1")

    assert result is mapped
    definitions.get_published_parameter_config.assert_called_once_with("app-1", public_runtime=True)


@pytest.mark.parametrize(
    ("source_error", "expected_error"),
    [
        pytest.param(AgentAppNotPublishedError("not published"), AppDefinitionNotPublishedError, id="not-published"),
        pytest.param(AgentAppGeneratorError("unavailable"), AppDefinitionUnavailableError, id="unavailable"),
    ],
)
def test_get_public_parameters_maps_agent_errors(source_error: Exception, expected_error: type[Exception]) -> None:
    service, definitions = _service()
    definitions.get_published_parameter_config.side_effect = source_error

    with pytest.raises(expected_error):
        service.get_public_parameters("app-1")


def test_get_tool_icons_maps_builtin_and_api_icons() -> None:
    service, definitions = _service()
    definitions.get_tool_icon_sources.return_value = (
        AppToolIconSource("builtin", "search", "search", None),
        AppToolIconSource("api", "provider-1", "weather", '{"background":"#fff","content":"W"}'),
        AppToolIconSource("workflow", "ignored", "ignored", None),
    )

    result = service.get_tool_icons("app-1")

    assert result == {
        "search": _BUILTIN_ICON_URL_PREFIX + "search/icon",
        "weather": {"background": "#fff", "content": "W"},
    }
    definitions.get_tool_icon_sources.assert_called_once_with("app-1")


@pytest.mark.parametrize("provider_icon", [None, "not-json"])
def test_get_tool_icons_falls_back_for_unavailable_api_icon(provider_icon: str | None) -> None:
    service, definitions = _service()
    definitions.get_tool_icon_sources.return_value = (AppToolIconSource("api", "provider-1", "weather", provider_icon),)

    assert service.get_tool_icons("app-1") == {"weather": {"background": "#252525", "content": "\ud83d\ude01"}}


def test_get_tool_icons_keeps_last_icon_for_duplicate_tool_name() -> None:
    service, definitions = _service()
    definitions.get_tool_icon_sources.return_value = (
        AppToolIconSource("builtin", "first", "search", None),
        AppToolIconSource("builtin", "second", "search", None),
    )

    assert service.get_tool_icons("app-1")["search"].endswith("/second/icon")


def test_get_tool_icons_rejects_missing_app() -> None:
    service, definitions = _service()
    definitions.get_tool_icon_sources.return_value = None

    with pytest.raises(AppDefinitionUnavailableError, match="App not found"):
        service.get_tool_icons("missing")


def test_get_summary_returns_repository_record() -> None:
    service, definitions = _service()
    summary = AppDefinitionSummary("Test App", "A test application", ("tag",), "chat", "Test Author")
    definitions.get_summary.return_value = summary

    assert service.get_summary("app-1") == summary
    definitions.get_summary.assert_called_once_with("app-1")


def test_get_summary_rejects_missing_app() -> None:
    service, definitions = _service()
    definitions.get_summary.return_value = None

    with pytest.raises(AppDefinitionUnavailableError, match="App not found"):
        service.get_summary("missing")


def test_get_site_configuration_rejects_missing_site() -> None:
    service, definitions = _service()
    definitions.get_site_configuration.return_value = None

    with pytest.raises(AppDefinitionUnavailableError, match="Site not found"):
        service.get_site_configuration("app-1")

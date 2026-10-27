from unittest.mock import MagicMock, create_autospec, patch

import pytest

import services.app_definition_query_service as module
from constants.end_user_connections import ConnectionCredentialType
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
from services.end_user_connections.revision import ConnectionProviderMetadata
from services.entities.tool_connection_entities import ToolConnectionRequirement

_BUILTIN_ICON_URL_PREFIX = "https://console.example/console/api/workspaces/current/tool-provider/builtin/"


def _service() -> tuple[AppDefinitionQueryService, MagicMock]:
    definitions: MagicMock = create_autospec(AppDefinitionQuery, instance=True, spec_set=True)
    revisions = create_autospec(module.ConnectionRevisions, instance=True, spec_set=True)
    revisions.resolve.return_value = ("connection-revision", ())
    return (
        AppDefinitionQueryService(
            definitions=definitions,
            connection_revisions=revisions,
            builtin_icon_url_prefix=_BUILTIN_ICON_URL_PREFIX,
        ),
        definitions,
    )


def test_get_mode_returns_repository_value() -> None:
    service, definitions = _service()
    definitions.get_mode.return_value = "completion"

    assert service.get_mode("app-1") == "completion"
    definitions.get_mode.assert_called_once_with("app-1")


def test_get_mode_rejects_missing_app() -> None:
    service, definitions = _service()
    definitions.get_mode.return_value = None

    with pytest.raises(AppDefinitionUnavailableError, match="App not found"):
        service.get_mode("missing")


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


def test_web_parameters_include_version_and_requirements_without_changing_public_parameters() -> None:
    service, definitions = _service()
    parameters = AppParameterConfig(features_dict={"opening_statement": "Hello"}, user_input_form=[])
    definitions.get_web_parameter_config.return_value = module.WebAppParameterConfig(
        parameters=parameters,
        workflow_id="published-version",
        requires_end_user_connections=True,
        connection_requirements=(
            ToolConnectionRequirement(
                node_id="tool-1",
                node_ids=("tool-1", "tool-2"),
                title="tool-1",
                purpose="Read events",
                provider="vendor/calendar/calendar",
                allowed_credential_types=(ConnectionCredentialType.API_KEY,),
            ),
        ),
        graph={
            "nodes": [
                {
                    "id": "tool-1",
                    "data": {
                        "type": "tool",
                        "credential_source": "end_user",
                        "provider_id": "vendor/calendar/calendar",
                        "tool_name": "read",
                        "end_user_auth": {"allowed_credential_types": ["api-key"], "purpose": "Read events"},
                    },
                },
                {
                    "id": "tool-2",
                    "data": {"type": "tool", "credential_source": "reuse_node", "reuse_node_id": "tool-1"},
                },
            ]
        },
    )
    definitions.get_published_parameter_config.return_value = parameters
    providers = (
        ConnectionProviderMetadata(
            provider="vendor/calendar/calendar",
            plugin_unique_identifier="vendor/calendar:1.0.0@" + "a" * 64,
            icon="https://console.example/plugin/icon.svg",
            icon_dark="https://console.example/plugin/icon-dark.svg",
        ),
    )
    with patch.object(service._connection_revisions, "resolve", return_value=("connection-revision", providers)):
        result = service.get_web_parameters("app-1", "tenant-1")
    assert result["connection_revision"] == "connection-revision"
    assert "workflow_id" not in result
    assert result["requires_end_user_connections"] is True
    requirement = result["connection_requirements"][0]
    assert requirement.node_id == "tool-1"
    assert requirement.node_ids == ("tool-1", "tool-2")
    assert requirement.provider == "vendor/calendar/calendar"
    assert requirement.plugin_unique_identifier == providers[0].plugin_unique_identifier
    assert requirement.icon == providers[0].icon
    assert requirement.icon_dark == providers[0].icon_dark
    assert requirement.title == "tool-1"
    assert requirement.purpose == "Read events"
    assert result["opening_statement"] == "Hello"
    definitions.get_web_parameter_config.assert_called_once_with("app-1", "tenant-1")
    public = service.get_public_parameters("app-1")
    assert "workflow_id" not in public
    assert "requires_end_user_connections" not in public
    assert "connection_requirements" not in public


@pytest.mark.parametrize(
    ("source_error", "expected_error"),
    [
        (AgentAppNotPublishedError("unpublished"), AppDefinitionNotPublishedError),
        (AgentAppGeneratorError("missing"), AppDefinitionUnavailableError),
    ],
)
def test_web_parameters_preserve_agent_publication_errors(
    source_error: Exception, expected_error: type[Exception]
) -> None:
    service, definitions = _service()
    definitions.get_web_parameter_config.side_effect = source_error
    with pytest.raises(expected_error):
        service.get_web_parameters("app-1", "tenant-1")


@pytest.mark.parametrize("workflow_id", [None, "published-version"])
def test_web_parameters_without_personal_tools_have_empty_requirements(workflow_id: str | None) -> None:
    service, definitions = _service()
    definitions.get_web_parameter_config.return_value = module.WebAppParameterConfig(
        parameters=AppParameterConfig(features_dict={}, user_input_form=[]),
        workflow_id=workflow_id,
        requires_end_user_connections=False,
        connection_requirements=(),
        graph={"nodes": []} if workflow_id is not None else None,
    )

    result = service.get_web_parameters("app-1", "tenant-1")
    assert result["connection_requirements"] == ()


def test_unavailable_web_parameter_config_is_not_reported_as_connection_free() -> None:
    service, definitions = _service()
    definitions.get_web_parameter_config.return_value = None

    with pytest.raises(AppDefinitionUnavailableError):
        service.get_web_parameters("app-1", "tenant-1")

from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, create_autospec, patch

import pytest

import controllers.console.explore.parameter as module
from controllers.console.app.error import AppUnavailableError
from models.model import InstalledApp
from services.app_definition_query_service import AppDefinitionQueryService, AppDefinitionUnavailableError


def _installed_app() -> InstalledApp:
    return InstalledApp(
        tenant_id="viewer-tenant",
        app_id="app-1",
        app_owner_tenant_id="owner-tenant",
        position=0,
        is_pinned=False,
        last_used_at=None,
    )


def _application_services() -> tuple[SimpleNamespace, MagicMock]:
    app_definitions: MagicMock = create_autospec(AppDefinitionQueryService, instance=True, spec_set=True)
    return SimpleNamespace(app_definitions=app_definitions), app_definitions


class TestAppParameterApi:
    def test_get_parameters(self) -> None:
        services, app_definitions = _application_services()
        app_definitions.get_parameters.return_value = {"any": "thing"}
        installed_app = _installed_app()

        with (
            patch.object(module, "application_services", return_value=services),
            patch.object(module, "dump_response", return_value={"ok": True}) as dump_response,
        ):
            result = unwrap(module.AppParameterApi.get)(module.AppParameterApi(), installed_app)

        assert result == {"ok": True}
        app_definitions.get_parameters.assert_called_once_with("app-1")
        dump_response.assert_called_once_with(module.Parameters, {"any": "thing"})

    def test_get_maps_unavailable_parameter_config_to_app_unavailable(self) -> None:
        services, app_definitions = _application_services()
        app_definitions.get_parameters.side_effect = AppDefinitionUnavailableError

        with (
            patch.object(module, "application_services", return_value=services),
            pytest.raises(AppUnavailableError),
        ):
            unwrap(module.AppParameterApi.get)(module.AppParameterApi(), _installed_app())


class TestExploreAppMetaApi:
    def test_get_meta(self) -> None:
        services, app_definitions = _application_services()
        app_definitions.get_tool_icons.return_value = {"search": "/icon"}
        installed_app = _installed_app()

        with patch.object(module, "application_services", return_value=services):
            result = unwrap(module.ExploreAppMetaApi.get)(module.ExploreAppMetaApi(), installed_app)

        assert result == {"tool_icons": {"search": "/icon"}}
        app_definitions.get_tool_icons.assert_called_once_with("app-1")

    def test_get_maps_unavailable_definition_to_app_unavailable(self) -> None:
        services, app_definitions = _application_services()
        app_definitions.get_tool_icons.side_effect = AppDefinitionUnavailableError

        with (
            patch.object(module, "application_services", return_value=services),
            pytest.raises(AppUnavailableError) as raised,
        ):
            unwrap(module.ExploreAppMetaApi.get)(module.ExploreAppMetaApi(), _installed_app())

        assert raised.value.data == {
            "code": "app_unavailable",
            "message": "App unavailable, please check your app configurations.",
            "status": 400,
        }

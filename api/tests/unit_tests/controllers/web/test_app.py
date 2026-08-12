"""Unit tests for controllers.web.app endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.app import AppAccessMode, AppMeta, AppParameterApi, AppWebAuthPermission
from controllers.web.error import AgentNotPublishedError, AppUnavailableError
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from enums import WebAppAccessMode
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from services.app_definition_query_service import AppDefinitionNotPublishedError, AppDefinitionUnavailableError


def _make_app() -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Web app",
        mode=AppMode.CHAT,
        enable_site=True,
        enable_api=True,
    )


def _make_end_user() -> EndUser:
    return EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.BROWSER,
        session_id="session-1",
    )


# ---------------------------------------------------------------------------
# AppParameterApi
# ---------------------------------------------------------------------------
class TestAppParameterApi:
    @patch("controllers.web.app.application_services")
    def test_get_returns_public_parameters(self, application_services: MagicMock, app: Flask) -> None:
        app_definitions = MagicMock()
        app_definitions.get_public_parameters.return_value = get_parameters_from_feature_dict(
            features_dict={"opening_statement": "Hello"},
            user_input_form=[],
        )
        application_services.return_value = SimpleNamespace(app_definitions=app_definitions)
        app_model = _make_app()

        with app.test_request_context("/parameters"):
            result = AppParameterApi().get(app_model, _make_end_user())

        assert result["opening_statement"] == "Hello"
        app_definitions.get_public_parameters.assert_called_once_with("app-1")

    @pytest.mark.parametrize(
        ("service_error", "http_error"),
        [
            pytest.param(AppDefinitionNotPublishedError(), AgentNotPublishedError, id="not-published"),
            pytest.param(AppDefinitionUnavailableError(), AppUnavailableError, id="unavailable"),
        ],
    )
    @patch("controllers.web.app.application_services")
    def test_get_maps_query_errors(
        self,
        application_services: MagicMock,
        service_error: Exception,
        http_error: type[Exception],
        app: Flask,
    ) -> None:
        app_definitions = MagicMock()
        app_definitions.get_public_parameters.side_effect = service_error
        application_services.return_value = SimpleNamespace(app_definitions=app_definitions)

        with app.test_request_context("/parameters"):
            with pytest.raises(http_error):
                AppParameterApi().get(_make_app(), _make_end_user())


# ---------------------------------------------------------------------------
# AppMeta
# ---------------------------------------------------------------------------
class TestAppMeta:
    @patch("controllers.web.app.application_services")
    def test_get_returns_meta(self, application_services: MagicMock, app: Flask) -> None:
        app_definitions = MagicMock()
        app_definitions.get_tool_icons.return_value = {}
        application_services.return_value = SimpleNamespace(app_definitions=app_definitions)
        app_model = _make_app()

        with app.test_request_context("/meta"):
            result = AppMeta().get(app_model, _make_end_user())

        assert result == {"tool_icons": {}}
        app_definitions.get_tool_icons.assert_called_once_with("app-1")

    @patch("controllers.web.app.application_services")
    def test_maps_unavailable_definition_to_app_unavailable(self, application_services: MagicMock, app: Flask) -> None:
        app_definitions = MagicMock()
        app_definitions.get_tool_icons.side_effect = AppDefinitionUnavailableError
        application_services.return_value = SimpleNamespace(app_definitions=app_definitions)

        with app.test_request_context("/meta"):
            with pytest.raises(AppUnavailableError) as raised:
                AppMeta().get(_make_app(), _make_end_user())

        assert raised.value.data == {
            "code": "app_unavailable",
            "message": "App unavailable, please check your app configurations.",
            "status": 400,
        }


# ---------------------------------------------------------------------------
# AppAccessMode
# ---------------------------------------------------------------------------
class TestAppAccessMode:
    @patch("controllers.web.app.application_services")
    def test_delegates_validated_app_references(self, application_services: MagicMock, app: Flask) -> None:
        webapp_access = MagicMock()
        webapp_access.get_access_mode.return_value = WebAppAccessMode.SSO_VERIFIED
        application_services.return_value = SimpleNamespace(webapp_access=webapp_access)

        with app.test_request_context("/webapp/access-mode?appId=app-1&appCode=code-1"):
            result = AppAccessMode().get()

        assert result == {"accessMode": "sso_verified"}
        webapp_access.get_access_mode.assert_called_once_with(app_id="app-1", app_code="code-1")


# ---------------------------------------------------------------------------
# AppWebAuthPermission
# ---------------------------------------------------------------------------
class TestAppWebAuthPermission:
    @patch("controllers.web.app.WebAppAuthService.is_app_require_permission_check", return_value=False)
    def test_returns_true_when_no_permission_check_required(self, mock_check: MagicMock, app: Flask) -> None:
        with app.test_request_context("/webapp/permission?appId=app-1", headers={"X-App-Code": "code1"}):
            result = AppWebAuthPermission().get()

        assert result == {"result": True}

    def test_raises_when_missing_app_id(self, app: Flask) -> None:
        with app.test_request_context("/webapp/permission", headers={"X-App-Code": "code1"}):
            with pytest.raises(ValueError, match="appId"):
                AppWebAuthPermission().get()

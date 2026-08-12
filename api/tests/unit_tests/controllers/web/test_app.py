"""Unit tests for controllers.web.app endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.app import AppAccessMode, AppMeta, AppParameterApi, AppWebAuthPermission
from controllers.web.error import AgentNotPublishedError, AppUnavailableError
from core.app.apps.agent_app.errors import AgentAppNotPublishedError
from enums import WebAppAccessMode


# ---------------------------------------------------------------------------
# AppParameterApi
# ---------------------------------------------------------------------------
class TestAppParameterApi:
    def test_advanced_chat_mode_uses_workflow(self, app: Flask) -> None:
        features_dict = {"opening_statement": "Hello"}
        workflow = SimpleNamespace(
            features_dict=features_dict,
            user_input_form=lambda to_old_structure=False: [],
        )
        app_model = SimpleNamespace(
            mode="advanced-chat",
            workflow_with_session=lambda *, session: workflow,
        )

        with (
            app.test_request_context("/parameters"),
            patch("controllers.web.app.get_parameters_from_feature_dict", return_value={}) as mock_params,
            patch("controllers.web.app.fields.Parameters") as mock_fields,
        ):
            mock_fields.model_validate.return_value.model_dump.return_value = {"result": "ok"}
            result = AppParameterApi().get(app_model, SimpleNamespace())

        mock_params.assert_called_once_with(features_dict=features_dict, user_input_form=[])
        assert result == {"result": "ok"}

    def test_workflow_mode_uses_workflow(self, app: Flask) -> None:
        features_dict = {}
        workflow = SimpleNamespace(
            features_dict=features_dict,
            user_input_form=lambda to_old_structure=False: [{"var": "x"}],
        )
        app_model = SimpleNamespace(
            mode="workflow",
            workflow_with_session=lambda *, session: workflow,
        )

        with (
            app.test_request_context("/parameters"),
            patch("controllers.web.app.get_parameters_from_feature_dict", return_value={}) as mock_params,
            patch("controllers.web.app.fields.Parameters") as mock_fields,
        ):
            mock_fields.model_validate.return_value.model_dump.return_value = {}
            AppParameterApi().get(app_model, SimpleNamespace())

        mock_params.assert_called_once_with(features_dict=features_dict, user_input_form=[{"var": "x"}])

    def test_advanced_chat_mode_no_workflow_raises(self, app: Flask) -> None:
        app_model = SimpleNamespace(
            mode="advanced-chat",
            workflow_with_session=lambda *, session: None,
        )
        with app.test_request_context("/parameters"):
            with pytest.raises(AppUnavailableError):
                AppParameterApi().get(app_model, SimpleNamespace())

    def test_standard_mode_uses_app_model_config(self, app: Flask) -> None:
        config = SimpleNamespace(to_dict=lambda **_kwargs: {"user_input_form": [{"var": "y"}], "key": "val"})
        app_model = SimpleNamespace(
            id="app-1",
            mode="chat",
            app_model_config_with_session=lambda *, session: config,
        )

        with (
            app.test_request_context("/parameters"),
            patch("controllers.web.app.get_parameters_from_feature_dict", return_value={}) as mock_params,
            patch("controllers.web.app.fields.Parameters") as mock_fields,
            patch("controllers.web.app.load_annotation_reply_config", return_value={"enabled": False}),
        ):
            mock_fields.model_validate.return_value.model_dump.return_value = {}
            AppParameterApi().get(app_model, SimpleNamespace())

        call_kwargs = mock_params.call_args
        assert call_kwargs.kwargs["user_input_form"] == [{"var": "y"}]

    def test_standard_mode_no_config_raises(self, app: Flask) -> None:
        app_model = SimpleNamespace(
            mode="chat",
            app_model_config_with_session=lambda *, session: None,
        )
        with app.test_request_context("/parameters"):
            with pytest.raises(AppUnavailableError):
                AppParameterApi().get(app_model, SimpleNamespace())

    def test_agent_mode_unpublished_raises_friendly_error(self, app: Flask) -> None:
        app_model = SimpleNamespace(mode="agent")
        with (
            app.test_request_context("/parameters"),
            patch(
                "controllers.web.app.get_published_agent_app_feature_dict_and_user_input_form",
                side_effect=AgentAppNotPublishedError("Agent has not been published"),
            ),
        ):
            with pytest.raises(AgentNotPublishedError):
                AppParameterApi().get(app_model, SimpleNamespace())


# ---------------------------------------------------------------------------
# AppMeta
# ---------------------------------------------------------------------------
class TestAppMeta:
    @patch("controllers.web.app.AppService")
    def test_get_returns_meta(self, mock_service_cls: MagicMock, app: Flask) -> None:
        mock_service_cls.return_value.get_app_meta.return_value = {"tool_icons": {}}
        app_model = SimpleNamespace(id="app-1")

        with app.test_request_context("/meta"):
            result = AppMeta().get(app_model, SimpleNamespace())

        assert result == {"tool_icons": {}}


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

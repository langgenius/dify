"""Unit tests for controllers.web.app endpoints."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.app import AppAccessMode, AppMeta, AppParameterApi, AppWebAuthPermission
from controllers.web.error import AppUnavailableError


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
        app_model = SimpleNamespace(mode="advanced-chat", workflow=workflow)

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
        app_model = SimpleNamespace(mode="workflow", workflow=workflow)

        with (
            app.test_request_context("/parameters"),
            patch("controllers.web.app.get_parameters_from_feature_dict", return_value={}) as mock_params,
            patch("controllers.web.app.fields.Parameters") as mock_fields,
        ):
            mock_fields.model_validate.return_value.model_dump.return_value = {}
            AppParameterApi().get(app_model, SimpleNamespace())

        mock_params.assert_called_once_with(features_dict=features_dict, user_input_form=[{"var": "x"}])

    def test_advanced_chat_mode_no_workflow_raises(self, app: Flask) -> None:
        app_model = SimpleNamespace(mode="advanced-chat", workflow=None)
        with app.test_request_context("/parameters"):
            with pytest.raises(AppUnavailableError):
                AppParameterApi().get(app_model, SimpleNamespace())

    def test_standard_mode_uses_app_model_config(self, app: Flask) -> None:
        config = SimpleNamespace(to_dict=lambda: {"user_input_form": [{"var": "y"}], "key": "val"})
        app_model = SimpleNamespace(mode="chat", app_model_config=config)

        with (
            app.test_request_context("/parameters"),
            patch("controllers.web.app.get_parameters_from_feature_dict", return_value={}) as mock_params,
            patch("controllers.web.app.fields.Parameters") as mock_fields,
        ):
            mock_fields.model_validate.return_value.model_dump.return_value = {}
            AppParameterApi().get(app_model, SimpleNamespace())

        call_kwargs = mock_params.call_args
        assert call_kwargs.kwargs["user_input_form"] == [{"var": "y"}]

    def test_standard_mode_no_config_raises(self, app: Flask) -> None:
        app_model = SimpleNamespace(mode="chat", app_model_config=None)
        with app.test_request_context("/parameters"):
            with pytest.raises(AppUnavailableError):
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
    @patch("controllers.web.app.FeatureService.get_system_features")
    def test_returns_public_when_webapp_auth_disabled(self, mock_features: MagicMock, app: Flask) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        with app.test_request_context("/webapp/access-mode?appId=app-1"):
            result = AppAccessMode().get()

        assert result == {"accessMode": "public"}

    @patch("controllers.web.app.EnterpriseService.WebAppAuth.get_app_access_mode_by_id")
    @patch("controllers.web.app.FeatureService.get_system_features")
    def test_returns_access_mode_with_app_id(
        self, mock_features: MagicMock, mock_access: MagicMock, app: Flask
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True))
        mock_access.return_value = SimpleNamespace(access_mode="internal")

        with app.test_request_context("/webapp/access-mode?appId=app-1"):
            result = AppAccessMode().get()

        assert result == {"accessMode": "internal"}
        mock_access.assert_called_once_with("app-1")

    @patch("controllers.web.app.AppService.get_app_id_by_code", return_value="resolved-id")
    @patch("controllers.web.app.EnterpriseService.WebAppAuth.get_app_access_mode_by_id")
    @patch("controllers.web.app.FeatureService.get_system_features")
    def test_resolves_app_code_to_id(
        self, mock_features: MagicMock, mock_access: MagicMock, mock_resolve: MagicMock, app: Flask
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True))
        mock_access.return_value = SimpleNamespace(access_mode="external")

        with app.test_request_context("/webapp/access-mode?appCode=code1"):
            result = AppAccessMode().get()

        mock_resolve.assert_called_once_with("code1")
        mock_access.assert_called_once_with("resolved-id")
        assert result == {"accessMode": "external"}

    @patch("controllers.web.app.FeatureService.get_system_features")
    def test_raises_when_no_app_id_or_code(self, mock_features: MagicMock, app: Flask) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=True))

        with app.test_request_context("/webapp/access-mode"):
            with pytest.raises(ValueError, match="appId or appCode"):
                AppAccessMode().get()


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

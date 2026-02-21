"""Unit tests for controllers.web.wraps — JWT auth decorator and validation helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, NotFound, Unauthorized

from controllers.web.error import WebAppAuthAccessDeniedError, WebAppAuthRequiredError
from controllers.web.wraps import (
    _validate_user_accessibility,
    _validate_webapp_token,
    decode_jwt_token,
)


# ---------------------------------------------------------------------------
# _validate_webapp_token
# ---------------------------------------------------------------------------
class TestValidateWebappToken:
    def test_enterprise_enabled_and_app_auth_requires_webapp_source(self) -> None:
        """When both flags are true, a non-webapp source must raise."""
        decoded = {"token_source": "other"}
        with pytest.raises(WebAppAuthRequiredError):
            _validate_webapp_token(decoded, app_web_auth_enabled=True, system_webapp_auth_enabled=True)

    def test_enterprise_enabled_and_app_auth_accepts_webapp_source(self) -> None:
        decoded = {"token_source": "webapp"}
        _validate_webapp_token(decoded, app_web_auth_enabled=True, system_webapp_auth_enabled=True)

    def test_enterprise_enabled_and_app_auth_missing_source_raises(self) -> None:
        decoded = {}
        with pytest.raises(WebAppAuthRequiredError):
            _validate_webapp_token(decoded, app_web_auth_enabled=True, system_webapp_auth_enabled=True)

    def test_public_app_rejects_webapp_source(self) -> None:
        """When auth is not required, a webapp-sourced token must be rejected."""
        decoded = {"token_source": "webapp"}
        with pytest.raises(Unauthorized):
            _validate_webapp_token(decoded, app_web_auth_enabled=False, system_webapp_auth_enabled=False)

    def test_public_app_accepts_non_webapp_source(self) -> None:
        decoded = {"token_source": "other"}
        _validate_webapp_token(decoded, app_web_auth_enabled=False, system_webapp_auth_enabled=False)

    def test_public_app_accepts_no_source(self) -> None:
        decoded = {}
        _validate_webapp_token(decoded, app_web_auth_enabled=False, system_webapp_auth_enabled=False)

    def test_system_enabled_but_app_public(self) -> None:
        """system_webapp_auth_enabled=True but app is public — webapp source rejected."""
        decoded = {"token_source": "webapp"}
        with pytest.raises(Unauthorized):
            _validate_webapp_token(decoded, app_web_auth_enabled=False, system_webapp_auth_enabled=True)


# ---------------------------------------------------------------------------
# _validate_user_accessibility
# ---------------------------------------------------------------------------
class TestValidateUserAccessibility:
    def test_skips_when_auth_disabled(self) -> None:
        """No checks when system or app auth is disabled."""
        _validate_user_accessibility(
            decoded={},
            app_code="code",
            app_web_auth_enabled=False,
            system_webapp_auth_enabled=False,
            webapp_settings=None,
        )

    def test_missing_user_id_raises(self) -> None:
        decoded = {}
        with pytest.raises(WebAppAuthRequiredError):
            _validate_user_accessibility(
                decoded=decoded,
                app_code="code",
                app_web_auth_enabled=True,
                system_webapp_auth_enabled=True,
                webapp_settings=SimpleNamespace(access_mode="internal"),
            )

    def test_missing_webapp_settings_raises(self) -> None:
        decoded = {"user_id": "u1"}
        with pytest.raises(WebAppAuthRequiredError, match="settings not found"):
            _validate_user_accessibility(
                decoded=decoded,
                app_code="code",
                app_web_auth_enabled=True,
                system_webapp_auth_enabled=True,
                webapp_settings=None,
            )

    def test_missing_auth_type_raises(self) -> None:
        decoded = {"user_id": "u1", "granted_at": 1}
        settings = SimpleNamespace(access_mode="public")
        with pytest.raises(WebAppAuthAccessDeniedError, match="auth_type"):
            _validate_user_accessibility(
                decoded=decoded,
                app_code="code",
                app_web_auth_enabled=True,
                system_webapp_auth_enabled=True,
                webapp_settings=settings,
            )

    def test_missing_granted_at_raises(self) -> None:
        decoded = {"user_id": "u1", "auth_type": "external"}
        settings = SimpleNamespace(access_mode="public")
        with pytest.raises(WebAppAuthAccessDeniedError, match="granted_at"):
            _validate_user_accessibility(
                decoded=decoded,
                app_code="code",
                app_web_auth_enabled=True,
                system_webapp_auth_enabled=True,
                webapp_settings=settings,
            )

    @patch("controllers.web.wraps.EnterpriseService.get_app_sso_settings_last_update_time")
    @patch("controllers.web.wraps.WebAppAuthService.is_app_require_permission_check", return_value=False)
    def test_external_auth_type_checks_sso_update_time(
        self, mock_perm_check: MagicMock, mock_sso_time: MagicMock
    ) -> None:
        # granted_at is before SSO update time → denied
        mock_sso_time.return_value = datetime.now(UTC)
        old_granted = int((datetime.now(UTC) - timedelta(hours=1)).timestamp())
        decoded = {"user_id": "u1", "auth_type": "external", "granted_at": old_granted}
        settings = SimpleNamespace(access_mode="public")
        with pytest.raises(WebAppAuthAccessDeniedError, match="SSO settings"):
            _validate_user_accessibility(
                decoded=decoded,
                app_code="code",
                app_web_auth_enabled=True,
                system_webapp_auth_enabled=True,
                webapp_settings=settings,
            )

    @patch("controllers.web.wraps.EnterpriseService.get_workspace_sso_settings_last_update_time")
    @patch("controllers.web.wraps.WebAppAuthService.is_app_require_permission_check", return_value=False)
    def test_internal_auth_type_checks_workspace_sso_update_time(
        self, mock_perm_check: MagicMock, mock_workspace_sso: MagicMock
    ) -> None:
        mock_workspace_sso.return_value = datetime.now(UTC)
        old_granted = int((datetime.now(UTC) - timedelta(hours=1)).timestamp())
        decoded = {"user_id": "u1", "auth_type": "internal", "granted_at": old_granted}
        settings = SimpleNamespace(access_mode="public")
        with pytest.raises(WebAppAuthAccessDeniedError, match="SSO settings"):
            _validate_user_accessibility(
                decoded=decoded,
                app_code="code",
                app_web_auth_enabled=True,
                system_webapp_auth_enabled=True,
                webapp_settings=settings,
            )

    @patch("controllers.web.wraps.EnterpriseService.get_app_sso_settings_last_update_time")
    @patch("controllers.web.wraps.WebAppAuthService.is_app_require_permission_check", return_value=False)
    def test_external_auth_passes_when_granted_after_sso_update(
        self, mock_perm_check: MagicMock, mock_sso_time: MagicMock
    ) -> None:
        mock_sso_time.return_value = datetime.now(UTC) - timedelta(hours=2)
        recent_granted = int(datetime.now(UTC).timestamp())
        decoded = {"user_id": "u1", "auth_type": "external", "granted_at": recent_granted}
        settings = SimpleNamespace(access_mode="public")
        # Should not raise
        _validate_user_accessibility(
            decoded=decoded,
            app_code="code",
            app_web_auth_enabled=True,
            system_webapp_auth_enabled=True,
            webapp_settings=settings,
        )

    @patch("controllers.web.wraps.EnterpriseService.WebAppAuth.is_user_allowed_to_access_webapp", return_value=False)
    @patch("controllers.web.wraps.AppService.get_app_id_by_code", return_value="app-id-1")
    @patch("controllers.web.wraps.WebAppAuthService.is_app_require_permission_check", return_value=True)
    def test_permission_check_denies_unauthorized_user(
        self, mock_perm: MagicMock, mock_app_id: MagicMock, mock_allowed: MagicMock
    ) -> None:
        decoded = {"user_id": "u1", "auth_type": "external", "granted_at": int(datetime.now(UTC).timestamp())}
        settings = SimpleNamespace(access_mode="internal")
        with pytest.raises(WebAppAuthAccessDeniedError):
            _validate_user_accessibility(
                decoded=decoded,
                app_code="code",
                app_web_auth_enabled=True,
                system_webapp_auth_enabled=True,
                webapp_settings=settings,
            )


# ---------------------------------------------------------------------------
# decode_jwt_token
# ---------------------------------------------------------------------------
class TestDecodeJwtToken:
    @patch("controllers.web.wraps._validate_user_accessibility")
    @patch("controllers.web.wraps._validate_webapp_token")
    @patch("controllers.web.wraps.EnterpriseService.WebAppAuth.get_app_access_mode_by_id")
    @patch("controllers.web.wraps.AppService.get_app_id_by_code")
    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    @patch("controllers.web.wraps.db")
    def test_happy_path(
        self,
        mock_db: MagicMock,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        mock_app_id: MagicMock,
        mock_access_mode: MagicMock,
        mock_validate_token: MagicMock,
        mock_validate_user: MagicMock,
        app: Flask,
    ) -> None:
        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": "code1",
            "app_id": "app-1",
            "end_user_id": "eu-1",
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        app_model = SimpleNamespace(id="app-1", enable_site=True)
        site = SimpleNamespace(code="code1")
        end_user = SimpleNamespace(id="eu-1", session_id="sess-1")

        # Configure session mock to return correct objects via scalar()
        session_mock = MagicMock()
        session_mock.scalar.side_effect = [app_model, site, end_user]
        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_mock)
        session_ctx.__exit__ = MagicMock(return_value=False)
        mock_db.engine = "engine"

        with patch("controllers.web.wraps.Session", return_value=session_ctx):
            with app.test_request_context("/", headers={"X-App-Code": "code1"}):
                result_app, result_user = decode_jwt_token()

        assert result_app.id == "app-1"
        assert result_user.id == "eu-1"

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.extract_webapp_passport")
    def test_missing_token_raises_unauthorized(
        self, mock_extract: MagicMock, mock_features: MagicMock, app: Flask
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        mock_extract.return_value = None

        with app.test_request_context("/", headers={"X-App-Code": "code1"}):
            with pytest.raises(Unauthorized):
                decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    @patch("controllers.web.wraps.db")
    def test_missing_app_raises_not_found(
        self,
        mock_db: MagicMock,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app: Flask,
    ) -> None:
        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": "code1",
            "app_id": "app-1",
            "end_user_id": "eu-1",
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        session_mock = MagicMock()
        session_mock.scalar.return_value = None  # No app found
        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_mock)
        session_ctx.__exit__ = MagicMock(return_value=False)
        mock_db.engine = "engine"

        with patch("controllers.web.wraps.Session", return_value=session_ctx):
            with app.test_request_context("/", headers={"X-App-Code": "code1"}):
                with pytest.raises(NotFound):
                    decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    @patch("controllers.web.wraps.db")
    def test_disabled_site_raises_bad_request(
        self,
        mock_db: MagicMock,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app: Flask,
    ) -> None:
        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": "code1",
            "app_id": "app-1",
            "end_user_id": "eu-1",
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        app_model = SimpleNamespace(id="app-1", enable_site=False)

        session_mock = MagicMock()
        # scalar calls: app_model, site (code found), then end_user
        session_mock.scalar.side_effect = [app_model, SimpleNamespace(code="code1"), None]
        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_mock)
        session_ctx.__exit__ = MagicMock(return_value=False)
        mock_db.engine = "engine"

        with patch("controllers.web.wraps.Session", return_value=session_ctx):
            with app.test_request_context("/", headers={"X-App-Code": "code1"}):
                with pytest.raises(BadRequest, match="Site is disabled"):
                    decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    @patch("controllers.web.wraps.db")
    def test_missing_end_user_raises_not_found(
        self,
        mock_db: MagicMock,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app: Flask,
    ) -> None:
        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": "code1",
            "app_id": "app-1",
            "end_user_id": "eu-1",
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        app_model = SimpleNamespace(id="app-1", enable_site=True)
        site = SimpleNamespace(code="code1")

        session_mock = MagicMock()
        session_mock.scalar.side_effect = [app_model, site, None]  # end_user is None
        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_mock)
        session_ctx.__exit__ = MagicMock(return_value=False)
        mock_db.engine = "engine"

        with patch("controllers.web.wraps.Session", return_value=session_ctx):
            with app.test_request_context("/", headers={"X-App-Code": "code1"}):
                with pytest.raises(NotFound):
                    decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    @patch("controllers.web.wraps.db")
    def test_user_id_mismatch_raises_unauthorized(
        self,
        mock_db: MagicMock,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app: Flask,
    ) -> None:
        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": "code1",
            "app_id": "app-1",
            "end_user_id": "eu-1",
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        app_model = SimpleNamespace(id="app-1", enable_site=True)
        site = SimpleNamespace(code="code1")
        end_user = SimpleNamespace(id="eu-1", session_id="sess-1")

        session_mock = MagicMock()
        session_mock.scalar.side_effect = [app_model, site, end_user]
        session_ctx = MagicMock()
        session_ctx.__enter__ = MagicMock(return_value=session_mock)
        session_ctx.__exit__ = MagicMock(return_value=False)
        mock_db.engine = "engine"

        with patch("controllers.web.wraps.Session", return_value=session_ctx):
            with app.test_request_context("/", headers={"X-App-Code": "code1"}):
                with pytest.raises(Unauthorized, match="expired"):
                    decode_jwt_token(user_id="different-user")

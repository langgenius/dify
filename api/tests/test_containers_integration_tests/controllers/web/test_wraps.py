"""Testcontainers integration tests for controllers.web.wraps — JWT auth decorator and validation helpers."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound, Unauthorized

from controllers.web.error import WebAppAuthAccessDeniedError, WebAppAuthRequiredError
from controllers.web.wraps import (
    _validate_user_accessibility,
    _validate_webapp_token,
    decode_jwt_token,
)


class TestValidateWebappToken:
    def test_enterprise_enabled_and_app_auth_requires_webapp_source(self) -> None:
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
        decoded = {"token_source": "webapp"}
        with pytest.raises(Unauthorized):
            _validate_webapp_token(decoded, app_web_auth_enabled=False, system_webapp_auth_enabled=True)


class TestValidateUserAccessibility:
    def test_skips_when_auth_disabled(self) -> None:
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


class TestDecodeJwtToken:
    @pytest.fixture
    def app(self, flask_app_with_containers: Flask):
        return flask_app_with_containers

    def _create_app_site_enduser(self, db_session: Session, *, enable_site: bool = True):
        from models.model import App, AppMode, CustomizeTokenStrategy, EndUser, Site

        tenant_id = str(uuid4())
        app_model = App(
            tenant_id=tenant_id,
            mode=AppMode.CHAT.value,
            name="test-app",
            enable_site=enable_site,
            enable_api=True,
        )
        db_session.add(app_model)
        db_session.commit()
        db_session.expire_all()

        site = Site(
            app_id=app_model.id,
            title="test-site",
            default_language="en-US",
            customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            code="code1",
        )
        db_session.add(site)
        db_session.commit()
        db_session.expire_all()

        end_user = EndUser(
            tenant_id=tenant_id,
            app_id=app_model.id,
            type="browser",
            session_id="sess-1",
        )
        db_session.add(end_user)
        db_session.commit()
        db_session.expire_all()

        return app_model, site, end_user

    @patch("controllers.web.wraps._validate_user_accessibility")
    @patch("controllers.web.wraps._validate_webapp_token")
    @patch("controllers.web.wraps.EnterpriseService.WebAppAuth.get_app_access_mode_by_id")
    @patch("controllers.web.wraps.AppService.get_app_id_by_code")
    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    def test_happy_path(
        self,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        mock_app_id: MagicMock,
        mock_access_mode: MagicMock,
        mock_validate_token: MagicMock,
        mock_validate_user: MagicMock,
        app: Flask,
        db_session_with_containers: Session,
    ) -> None:
        app_model, site, end_user = self._create_app_site_enduser(db_session_with_containers)

        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": site.code,
            "app_id": app_model.id,
            "end_user_id": end_user.id,
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        with app.test_request_context("/", headers={"X-App-Code": site.code}):
            result_app, result_user = decode_jwt_token()

        assert result_app.id == app_model.id
        assert result_user.id == end_user.id

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.extract_webapp_passport")
    def test_missing_token_raises_unauthorized(self, mock_extract: MagicMock, mock_features: MagicMock, app) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        mock_extract.return_value = None

        with app.test_request_context("/", headers={"X-App-Code": "code1"}):
            with pytest.raises(Unauthorized):
                decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    def test_missing_app_raises_not_found(
        self,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app,
    ) -> None:
        non_existent_id = str(uuid4())
        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": "code1",
            "app_id": non_existent_id,
            "end_user_id": str(uuid4()),
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        with app.test_request_context("/", headers={"X-App-Code": "code1"}):
            with pytest.raises(NotFound):
                decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    def test_disabled_site_raises_bad_request(
        self,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app: Flask,
        db_session_with_containers: Session,
    ) -> None:
        app_model, site, end_user = self._create_app_site_enduser(db_session_with_containers, enable_site=False)

        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": site.code,
            "app_id": app_model.id,
            "end_user_id": end_user.id,
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        with app.test_request_context("/", headers={"X-App-Code": site.code}):
            with pytest.raises(BadRequest, match="Site is disabled"):
                decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    def test_missing_end_user_raises_not_found(
        self,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app: Flask,
        db_session_with_containers: Session,
    ) -> None:
        app_model, site, _ = self._create_app_site_enduser(db_session_with_containers)
        non_existent_eu = str(uuid4())

        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": site.code,
            "app_id": app_model.id,
            "end_user_id": non_existent_eu,
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        with app.test_request_context("/", headers={"X-App-Code": site.code}):
            with pytest.raises(NotFound):
                decode_jwt_token()

    @patch("controllers.web.wraps.FeatureService.get_system_features")
    @patch("controllers.web.wraps.PassportService")
    @patch("controllers.web.wraps.extract_webapp_passport")
    def test_user_id_mismatch_raises_unauthorized(
        self,
        mock_extract: MagicMock,
        mock_passport_cls: MagicMock,
        mock_features: MagicMock,
        app: Flask,
        db_session_with_containers: Session,
    ) -> None:
        app_model, site, end_user = self._create_app_site_enduser(db_session_with_containers)

        mock_extract.return_value = "jwt-token"
        mock_passport_cls.return_value.verify.return_value = {
            "app_code": site.code,
            "app_id": app_model.id,
            "end_user_id": end_user.id,
        }
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))

        with app.test_request_context("/", headers={"X-App-Code": site.code}):
            with pytest.raises(Unauthorized, match="expired"):
                decode_jwt_token(user_id="different-user")

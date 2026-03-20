"""Unit tests for controllers.web.passport — token issuance and enterprise auth exchange."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import NotFound, Unauthorized

from controllers.web.error import WebAppAuthRequiredError
from controllers.web.passport import (
    PassportResource,
    decode_enterprise_webapp_user_id,
    exchange_token_for_existing_web_user,
    generate_session_id,
)
from services.webapp_auth_service import WebAppAuthType


# ---------------------------------------------------------------------------
# decode_enterprise_webapp_user_id
# ---------------------------------------------------------------------------
class TestDecodeEnterpriseWebappUserId:
    def test_none_token_returns_none(self) -> None:
        assert decode_enterprise_webapp_user_id(None) is None

    @patch("controllers.web.passport.PassportService")
    def test_valid_token_returns_decoded(self, mock_passport_cls: MagicMock) -> None:
        mock_passport_cls.return_value.verify.return_value = {
            "token_source": "webapp_login_token",
            "user_id": "u1",
        }
        result = decode_enterprise_webapp_user_id("valid-jwt")
        assert result["user_id"] == "u1"

    @patch("controllers.web.passport.PassportService")
    def test_wrong_source_raises_unauthorized(self, mock_passport_cls: MagicMock) -> None:
        mock_passport_cls.return_value.verify.return_value = {
            "token_source": "other_source",
        }
        with pytest.raises(Unauthorized, match="Expected 'webapp_login_token'"):
            decode_enterprise_webapp_user_id("bad-jwt")

    @patch("controllers.web.passport.PassportService")
    def test_missing_source_raises_unauthorized(self, mock_passport_cls: MagicMock) -> None:
        mock_passport_cls.return_value.verify.return_value = {}
        with pytest.raises(Unauthorized, match="Expected 'webapp_login_token'"):
            decode_enterprise_webapp_user_id("no-source-jwt")


# ---------------------------------------------------------------------------
# generate_session_id
# ---------------------------------------------------------------------------
class TestGenerateSessionId:
    @patch("controllers.web.passport.db")
    def test_returns_unique_session_id(self, mock_db: MagicMock) -> None:
        mock_db.session.scalar.return_value = 0
        sid = generate_session_id()
        assert isinstance(sid, str)
        assert len(sid) == 36  # UUID format

    @patch("controllers.web.passport.db")
    def test_retries_on_collision(self, mock_db: MagicMock) -> None:
        # First call returns count=1 (collision), second returns 0
        mock_db.session.scalar.side_effect = [1, 0]
        sid = generate_session_id()
        assert isinstance(sid, str)
        assert mock_db.session.scalar.call_count == 2


# ---------------------------------------------------------------------------
# exchange_token_for_existing_web_user
# ---------------------------------------------------------------------------
class TestExchangeTokenForExistingWebUser:
    @patch("controllers.web.passport.PassportService")
    @patch("controllers.web.passport.db")
    def test_external_auth_type_mismatch_raises(self, mock_db: MagicMock, mock_passport_cls: MagicMock) -> None:
        site = SimpleNamespace(code="code1", app_id="app-1")
        app_model = SimpleNamespace(id="app-1", status="normal", enable_site=True, tenant_id="t1")
        mock_db.session.scalar.side_effect = [site, app_model]

        decoded = {"user_id": "u1", "auth_type": "internal"}  # mismatch: expected "external"
        with pytest.raises(WebAppAuthRequiredError, match="external"):
            exchange_token_for_existing_web_user(
                app_code="code1", enterprise_user_decoded=decoded, auth_type=WebAppAuthType.EXTERNAL
            )

    @patch("controllers.web.passport.PassportService")
    @patch("controllers.web.passport.db")
    def test_internal_auth_type_mismatch_raises(self, mock_db: MagicMock, mock_passport_cls: MagicMock) -> None:
        site = SimpleNamespace(code="code1", app_id="app-1")
        app_model = SimpleNamespace(id="app-1", status="normal", enable_site=True, tenant_id="t1")
        mock_db.session.scalar.side_effect = [site, app_model]

        decoded = {"user_id": "u1", "auth_type": "external"}  # mismatch: expected "internal"
        with pytest.raises(WebAppAuthRequiredError, match="internal"):
            exchange_token_for_existing_web_user(
                app_code="code1", enterprise_user_decoded=decoded, auth_type=WebAppAuthType.INTERNAL
            )

    @patch("controllers.web.passport.PassportService")
    @patch("controllers.web.passport.db")
    def test_site_not_found_raises(self, mock_db: MagicMock, mock_passport_cls: MagicMock) -> None:
        mock_db.session.scalar.return_value = None
        decoded = {"user_id": "u1", "auth_type": "external"}
        with pytest.raises(NotFound):
            exchange_token_for_existing_web_user(
                app_code="code1", enterprise_user_decoded=decoded, auth_type=WebAppAuthType.EXTERNAL
            )


# ---------------------------------------------------------------------------
# PassportResource.get
# ---------------------------------------------------------------------------
class TestPassportResource:
    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_missing_app_code_raises_unauthorized(self, mock_features: MagicMock, app: Flask) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        with app.test_request_context("/passport"):
            with pytest.raises(Unauthorized, match="X-App-Code"):
                PassportResource().get()

    @patch("controllers.web.passport.PassportService")
    @patch("controllers.web.passport.generate_session_id", return_value="new-sess-id")
    @patch("controllers.web.passport.db")
    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_creates_new_end_user_when_no_user_id(
        self,
        mock_features: MagicMock,
        mock_db: MagicMock,
        mock_gen_session: MagicMock,
        mock_passport_cls: MagicMock,
        app: Flask,
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        site = SimpleNamespace(app_id="app-1", code="code1")
        app_model = SimpleNamespace(id="app-1", status="normal", enable_site=True, tenant_id="t1")
        mock_db.session.scalar.side_effect = [site, app_model]
        mock_passport_cls.return_value.issue.return_value = "issued-token"

        with app.test_request_context("/passport", headers={"X-App-Code": "code1"}):
            response = PassportResource().get()

        assert response.get_json()["access_token"] == "issued-token"
        mock_db.session.add.assert_called_once()
        mock_db.session.commit.assert_called_once()

    @patch("controllers.web.passport.PassportService")
    @patch("controllers.web.passport.db")
    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_reuses_existing_end_user_when_user_id_provided(
        self,
        mock_features: MagicMock,
        mock_db: MagicMock,
        mock_passport_cls: MagicMock,
        app: Flask,
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        site = SimpleNamespace(app_id="app-1", code="code1")
        app_model = SimpleNamespace(id="app-1", status="normal", enable_site=True, tenant_id="t1")
        existing_user = SimpleNamespace(id="eu-1", session_id="sess-existing")
        mock_db.session.scalar.side_effect = [site, app_model, existing_user]
        mock_passport_cls.return_value.issue.return_value = "reused-token"

        with app.test_request_context("/passport?user_id=sess-existing", headers={"X-App-Code": "code1"}):
            response = PassportResource().get()

        assert response.get_json()["access_token"] == "reused-token"
        # Should not create a new end user
        mock_db.session.add.assert_not_called()

    @patch("controllers.web.passport.db")
    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_site_not_found_raises(self, mock_features: MagicMock, mock_db: MagicMock, app: Flask) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        mock_db.session.scalar.return_value = None
        with app.test_request_context("/passport", headers={"X-App-Code": "code1"}):
            with pytest.raises(NotFound):
                PassportResource().get()

    @patch("controllers.web.passport.db")
    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_disabled_app_raises_not_found(self, mock_features: MagicMock, mock_db: MagicMock, app: Flask) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        site = SimpleNamespace(app_id="app-1", code="code1")
        disabled_app = SimpleNamespace(id="app-1", status="normal", enable_site=False)
        mock_db.session.scalar.side_effect = [site, disabled_app]
        with app.test_request_context("/passport", headers={"X-App-Code": "code1"}):
            with pytest.raises(NotFound):
                PassportResource().get()

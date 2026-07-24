"""Unit tests for controllers.web.passport — token issuance and enterprise auth exchange."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, Unauthorized

from controllers.web.error import WebAppAuthRequiredError
from controllers.web.passport import (
    PassportResource,
    decode_enterprise_webapp_user_id,
    exchange_token_for_existing_web_user,
    generate_session_id,
)
from models.base import TypeBase
from models.enums import CustomizeTokenStrategy, EndUserType
from models.model import App, AppMode, EndUser, IconType, Site
from services.webapp_auth_service import WebAppAuthType


@pytest.fixture
def database_session(sqlite_engine: Engine):
    models = (App, Site, EndUser)
    tables = [model.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        with patch("controllers.web.passport.db.session", session):
            yield session


def _persist_webapp(
    session: Session,
    *,
    app_code: str = "code1",
    enable_site: bool = True,
) -> tuple[App, Site]:
    app_model = App(
        id=str(uuid.uuid4()),
        tenant_id=str(uuid.uuid4()),
        name="Web App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=enable_site,
        enable_api=False,
    )
    site = Site(
        app_id=app_model.id,
        title="Web App Site",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code=app_code,
    )
    session.add_all([app_model, site])
    session.commit()
    return app_model, site


def _end_user(app_model: App, *, session_id: str) -> EndUser:
    return EndUser(
        id=str(uuid.uuid4()),
        tenant_id=app_model.tenant_id,
        app_id=app_model.id,
        type=EndUserType.BROWSER,
        name="Web User",
        session_id=session_id,
    )


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
        assert result is not None
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
    def test_returns_unique_session_id(self, database_session: Session) -> None:
        sid = generate_session_id()
        assert isinstance(sid, str)
        assert len(sid) == 36  # UUID format

    def test_retries_on_collision(self, database_session: Session) -> None:
        app_model, _ = _persist_webapp(database_session)
        collision_id = str(uuid.uuid4())
        generated_id = str(uuid.uuid4())
        database_session.add(_end_user(app_model, session_id=collision_id))
        database_session.commit()

        with patch(
            "controllers.web.passport.uuid.uuid4",
            side_effect=[uuid.UUID(collision_id), uuid.UUID(generated_id)],
        ):
            sid = generate_session_id()

        assert sid == generated_id


# ---------------------------------------------------------------------------
# exchange_token_for_existing_web_user
# ---------------------------------------------------------------------------
class TestExchangeTokenForExistingWebUser:
    def test_external_auth_type_mismatch_raises(self, database_session: Session) -> None:
        _persist_webapp(database_session)
        decoded = {"user_id": "u1", "auth_type": "internal"}  # mismatch: expected "external"
        with pytest.raises(WebAppAuthRequiredError, match="external"):
            exchange_token_for_existing_web_user(
                app_code="code1", enterprise_user_decoded=decoded, auth_type=WebAppAuthType.EXTERNAL
            )

    def test_internal_auth_type_mismatch_raises(self, database_session: Session) -> None:
        _persist_webapp(database_session)
        decoded = {"user_id": "u1", "auth_type": "external"}  # mismatch: expected "internal"
        with pytest.raises(WebAppAuthRequiredError, match="internal"):
            exchange_token_for_existing_web_user(
                app_code="code1", enterprise_user_decoded=decoded, auth_type=WebAppAuthType.INTERNAL
            )

    def test_site_not_found_raises(self, database_session: Session) -> None:
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
    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_creates_new_end_user_when_no_user_id(
        self,
        mock_features: MagicMock,
        mock_gen_session: MagicMock,
        mock_passport_cls: MagicMock,
        app: Flask,
        database_session: Session,
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        app_model, _ = _persist_webapp(database_session)
        mock_passport_cls.return_value.issue.return_value = "issued-token"

        with app.test_request_context("/passport", headers={"X-App-Code": "code1"}):
            response = PassportResource().get()

        assert response["access_token"] == "issued-token"
        end_users = database_session.scalars(select(EndUser)).all()
        assert len(end_users) == 1
        assert end_users[0].session_id == "new-sess-id"
        assert end_users[0].app_id == app_model.id
        assert end_users[0].tenant_id == app_model.tenant_id

    @patch("controllers.web.passport.PassportService")
    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_reuses_existing_end_user_when_user_id_provided(
        self,
        mock_features: MagicMock,
        mock_passport_cls: MagicMock,
        app: Flask,
        database_session: Session,
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        app_model, _ = _persist_webapp(database_session)
        existing_user = _end_user(app_model, session_id="sess-existing")
        database_session.add(existing_user)
        database_session.commit()
        mock_passport_cls.return_value.issue.return_value = "reused-token"

        with app.test_request_context("/passport?user_id=sess-existing", headers={"X-App-Code": "code1"}):
            response = PassportResource().get()

        assert response["access_token"] == "reused-token"
        end_users = database_session.scalars(select(EndUser)).all()
        assert [end_user.id for end_user in end_users] == [existing_user.id]

    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_site_not_found_raises(self, mock_features: MagicMock, app: Flask, database_session: Session) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        with app.test_request_context("/passport", headers={"X-App-Code": "code1"}):
            with pytest.raises(NotFound):
                PassportResource().get()

    @patch("controllers.web.passport.FeatureService.get_system_features")
    def test_disabled_app_raises_not_found(
        self, mock_features: MagicMock, app: Flask, database_session: Session
    ) -> None:
        mock_features.return_value = SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))
        _persist_webapp(database_session, enable_site=False)
        with app.test_request_context("/passport", headers={"X-App-Code": "code1"}):
            with pytest.raises(NotFound):
                PassportResource().get()

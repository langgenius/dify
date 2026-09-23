from typing import Never
from unittest import mock
from uuid import uuid4

import pytest
from flask import Blueprint, Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, Unauthorized

from core.logging.context import clear_request_context, get_identity_context
from models import App, EndUser
from models.model import AppModelConfig
from tests.unit_tests.config_override import apply_config_overrides


@pytest.fixture(autouse=True)
def _reset_logging_context():
    clear_request_context()
    yield
    clear_request_context()


def test_validate_jwt_token_sets_logging_identity_before_view() -> None:
    from controllers.web import wraps

    app_model = App(id="app-id", tenant_id="tenant-id")
    end_user = EndUser(id="end-user-id", tenant_id="tenant-id", type=None)
    clear_request_context()

    @wraps.validate_jwt_token
    def protected_view(received_app, received_user):
        assert get_identity_context() == ("tenant-id", "end-user-id", "end_user")
        return received_app, received_user

    with mock.patch.object(wraps, "decode_jwt_token", return_value=(app_model, end_user)):
        result = protected_view()

    assert result == (app_model, end_user)


def test_validate_jwt_token_does_not_set_identity_when_authentication_fails() -> None:
    from controllers.web import wraps

    clear_request_context()

    @wraps.validate_jwt_token
    def protected_view(_app, _user):
        raise AssertionError("view must not be called")

    with (
        mock.patch.object(wraps, "decode_jwt_token", side_effect=Unauthorized()),
        pytest.raises(Unauthorized),
    ):
        protected_view()

    assert get_identity_context() == ("", "", "")


def test_decode_jwt_token_uses_shared_session_factory(sqlite_session: Session) -> None:
    from controllers.web import wraps
    from models.enums import EndUserType
    from models.model import AppMode, CustomizeTokenStrategy, Site

    tenant_id = str(uuid4())
    app_model = App(
        tenant_id=tenant_id,
        mode=AppMode.CHAT.value,
        name="test-app",
        enable_site=True,
        enable_api=True,
    )
    sqlite_session.add(app_model)
    sqlite_session.flush()
    config = AppModelConfig(app_id=app_model.id)
    config.id = str(uuid4())
    app_model.app_model_config_id = config.id
    sqlite_session.add(config)
    sqlite_session.commit()

    site = Site(
        app_id=app_model.id,
        title="test-site",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
        code="app-code",
    )
    end_user = EndUser(
        tenant_id=tenant_id,
        app_id=app_model.id,
        type=EndUserType.BROWSER,
        session_id="session-id",
    )
    sqlite_session.add_all((site, end_user))
    sqlite_session.commit()

    with (
        mock.patch.object(wraps, "extract_webapp_passport", return_value="jwt-token"),
        mock.patch.object(wraps, "PassportService") as mock_passport_service,
        mock.patch.object(
            wraps.SystemFeatureService,
            "is_webapp_auth_enabled",
            return_value=False,
        ),
    ):
        mock_passport_service.return_value.verify.return_value = {
            "app_code": "app-code",
            "app_id": app_model.id,
            "end_user_id": end_user.id,
        }

        with Flask(__name__).test_request_context("/", headers={"X-App-Code": "app-code"}):
            result_app, result_end_user = wraps.decode_jwt_token()

    assert result_app.id == app_model.id
    assert result_end_user.id == end_user.id


@pytest.mark.parametrize("missing", ["app", "site", "code", "disabled", "unpublished", "end_user", "resource"])
def test_post_missing_app_is_canonical_but_other_not_found_keeps_its_owner(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch, missing: str
) -> None:
    from controllers.common.app_access_error import register_app_access_error_metadata
    from controllers.web import wraps
    from libs.external_api import ExternalApi
    from models.enums import EndUserType
    from models.model import AppMode, CustomizeTokenStrategy, Site

    app_id, tenant_id, end_user_id = str(uuid4()), str(uuid4()), str(uuid4())
    config_id = str(uuid4())
    if missing != "app":
        sqlite_session.add(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="fixture",
                mode=AppMode.CHAT,
                enable_site=missing != "disabled",
                enable_api=True,
                app_model_config_id=config_id if missing != "unpublished" else None,
            )
        )
        if missing != "unpublished":
            config = AppModelConfig(app_id=app_id)
            config.id = config_id
            sqlite_session.add(config)
    if missing != "site":
        sqlite_session.add(
            Site(
                app_id=app_id,
                code="fixture-code",
                title="fixture",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
    if missing == "resource":
        sqlite_session.add(
            EndUser(
                id=end_user_id,
                tenant_id=tenant_id,
                app_id=app_id,
                type=EndUserType.BROWSER,
                session_id="fixture-session",
            )
        )
    sqlite_session.commit()
    apply_config_overrides(monkeypatch, NETWORK_ACCESS_TRUSTED_PROXY_CIDRS="172.18.0.0/16")
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    bp = Blueprint("web_post_fixture", __name__, url_prefix="/api")
    register_app_access_error_metadata(bp, surface="web")
    api = ExternalApi(bp)
    calls: list[str] = []

    class ProtectedResource(wraps.WebApiResource):
        def post(self, _app: App, _end_user: EndUser) -> Never:
            calls.append("view")
            raise NotFound("Conversation not found.")

    api.add_resource(ProtectedResource, "/chat-messages")
    app.register_blueprint(bp)
    with (
        mock.patch.object(wraps, "extract_webapp_passport", return_value="fixture-passport"),
        mock.patch.object(wraps, "PassportService") as passport,
        mock.patch.object(wraps.SystemFeatureService, "is_webapp_auth_enabled", return_value=False),
    ):
        passport.return_value.verify.return_value = {
            "app_code": None if missing == "code" else "fixture-code",
            "app_id": app_id,
            "end_user_id": end_user_id,
        }
        response = app.test_client().post(
            "/api/chat-messages",
            json={},
            headers={"X-App-Code": "fixture-code"},
            environ_overrides={"REMOTE_ADDR": "203.0.113.42"},
        )

    assert response.status_code == 404
    if missing in {"app", "site", "code", "disabled", "unpublished"}:
        assert (
            response.data
            == b'{"client_ip":"203.0.113.42","code":"app_not_found","message":"App not found.","status":404}'
        )
        assert response.headers["Content-Type"] == "application/json"
        assert response.headers["Cache-Control"] == "no-store"
    else:
        assert response.get_json()["code"] == "not_found"
        assert "client_ip" not in response.get_json()
        assert "Cache-Control" not in response.headers
        if missing == "resource":
            assert response.get_json()["message"] == "Conversation not found."
    assert calls == (["view"] if missing == "resource" else [])

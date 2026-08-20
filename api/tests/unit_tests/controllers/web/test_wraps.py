from types import SimpleNamespace
from unittest import mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from core.logging.context import clear_request_context, get_identity_context
from models import App, EndUser


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
            wraps,
            "FeatureService",
            get_system_features=mock.Mock(return_value=SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False))),
        ),
    ):
        mock_passport_service.return_value.verify.return_value = {
            "app_code": "app-code",
            "app_id": app_model.id,
            "end_user_id": end_user.id,
        }

        with Flask(__name__).test_request_context("/", headers={"X-App-Code": "app-code"}):
            assert wraps.decode_jwt_token() == (app_model, end_user)

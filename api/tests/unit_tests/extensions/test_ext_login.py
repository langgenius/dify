import json
from typing import cast
from unittest import mock

import pytest
from flask import Flask, Response, request

from constants import COOKIE_NAME_ACCESS_TOKEN
from core.logging.context import clear_request_context, get_identity_context
from extensions import ext_login
from extensions.ext_login import unauthorized_handler


@pytest.fixture(autouse=True)
def _reset_logging_context():
    clear_request_context()
    yield
    clear_request_context()


def test_unauthorized_handler_returns_json_response() -> None:
    response = unauthorized_handler()

    assert isinstance(response, Response)
    assert response.status_code == 401
    assert response.content_type == "application/json"
    assert json.loads(response.get_data(as_text=True)) == {
        "code": "unauthorized",
        "message": "Unauthorized.",
    }


def test_on_user_logged_in_sets_account_logging_identity() -> None:
    account = mock.Mock(spec=ext_login.Account)
    account.id = "account-id"
    account.current_tenant_id = "tenant-id"
    clear_request_context()

    ext_login.on_user_logged_in(None, account)

    assert get_identity_context() == ("tenant-id", "account-id", "account")


def test_on_user_logged_in_sets_end_user_logging_identity() -> None:
    end_user = mock.Mock(spec=ext_login.EndUser)
    end_user.id = "end-user-id"
    end_user.tenant_id = "tenant-id"
    end_user.type = "browser"
    clear_request_context()

    ext_login.on_user_logged_in(None, end_user)

    assert get_identity_context() == ("tenant-id", "end-user-id", "browser")


def test_on_user_logged_in_does_not_break_auth_when_identity_is_unavailable(caplog: pytest.LogCaptureFixture) -> None:
    account = mock.Mock(spec=ext_login.Account)
    type(account).current_tenant_id = mock.PropertyMock(side_effect=RuntimeError("unavailable"))
    account.id = "account-id"
    clear_request_context()

    with caplog.at_level("ERROR", logger=ext_login.logger.name):
        ext_login.on_user_logged_in(None, account)

    assert get_identity_context() == ("", "", "")
    assert "Failed to set logging identity context" in caplog.text


def test_on_user_logged_in_logs_unsupported_user_type(caplog: pytest.LogCaptureFixture) -> None:
    unsupported_user = cast(ext_login.LoginUser, object())
    clear_request_context()

    with caplog.at_level("ERROR", logger=ext_login.logger.name):
        ext_login.on_user_logged_in(None, unsupported_user)

    assert get_identity_context() == ("", "", "")
    assert "Failed to set logging identity context" in caplog.text


def test_admin_api_key_header_takes_precedence_over_console_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    app = Flask(__name__)
    session = mock.Mock(spec=ext_login.Session)
    tenant = mock.Mock(spec=ext_login.Tenant)
    tenant_account_join = mock.Mock(spec=ext_login.TenantAccountJoin)
    account = mock.Mock(spec=ext_login.Account)
    session.execute.return_value.one_or_none.return_value = (tenant, tenant_account_join)
    session.scalar.return_value = account
    monkeypatch.setattr(ext_login.dify_config, "ADMIN_API_KEY_ENABLE", True)
    monkeypatch.setattr(ext_login.dify_config, "ADMIN_API_KEY", "admin-key")
    monkeypatch.setattr(ext_login.dify_config, "CONSOLE_WEB_URL", "http://console.example.com")
    monkeypatch.setattr(ext_login.dify_config, "CONSOLE_API_URL", "http://api.example.com")
    monkeypatch.setattr(ext_login.dify_config, "COOKIE_DOMAIN", "")

    with app.test_request_context(
        "/console/api/test",
        headers={
            "Authorization": "Bearer admin-key",
            "Cookie": f"{COOKIE_NAME_ACCESS_TOKEN}=console-session",
            "X-WORKSPACE-ID": "workspace-id",
        },
    ):
        result = ext_login._load_user_from_request(request, session)

    assert result is account
    account.set_current_tenant_with_session.assert_called_once_with(tenant, session=session)

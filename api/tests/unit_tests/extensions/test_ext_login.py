import json
from unittest import mock

import pytest
from flask import Flask, Response, request

from constants import COOKIE_NAME_ACCESS_TOKEN
from extensions import ext_login
from extensions.ext_login import unauthorized_handler


def test_unauthorized_handler_returns_json_response() -> None:
    response = unauthorized_handler()

    assert isinstance(response, Response)
    assert response.status_code == 401
    assert response.content_type == "application/json"
    assert json.loads(response.get_data(as_text=True)) == {
        "code": "unauthorized",
        "message": "Unauthorized.",
    }


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

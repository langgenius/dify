import json
from unittest import mock

import pytest
from flask import Response

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


def test_on_user_logged_in_does_not_break_auth_when_identity_is_unavailable() -> None:
    account = mock.Mock(spec=ext_login.Account)
    type(account).current_tenant_id = mock.PropertyMock(side_effect=RuntimeError("unavailable"))
    account.id = "account-id"
    clear_request_context()

    ext_login.on_user_logged_in(None, account)

    assert get_identity_context() == ("", "", "")

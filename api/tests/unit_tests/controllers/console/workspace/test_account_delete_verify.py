import inspect
from unittest.mock import MagicMock

import pytest
from flask import Flask

from controllers.console.workspace import account as account_module
from controllers.console.workspace.account import AccountDeleteVerifyApi
from models.account import Account


@pytest.fixture
def flask_app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def account_user():
    user = Account(name="Tester", email="tester@example.com")
    user.id = "user-id"
    return user


class TestAccountDeleteVerifyApi:
    def test_post_generates_token_and_sends_email(self, flask_app, account_user, monkeypatch):
        generate_mock = MagicMock(return_value=("token", "code"))
        send_mock = MagicMock()

        monkeypatch.setattr(account_module, "current_user", account_user, raising=False)
        monkeypatch.setattr(
            account_module.AccountService,
            "generate_account_deletion_verification_code",
            generate_mock,
            raising=False,
        )
        monkeypatch.setattr(
            account_module.AccountService,
            "send_account_deletion_verification_email",
            send_mock,
            raising=False,
        )

        controller = AccountDeleteVerifyApi()
        handler = inspect.unwrap(AccountDeleteVerifyApi.post)

        with flask_app.test_request_context("/account/delete/verify", method="POST", json={}):
            response = handler(controller)

        assert response == {"result": "success", "data": "token"}
        generate_mock.assert_called_once_with(account_user)
        send_mock.assert_called_once_with(account_user, "code")

    def test_post_requires_account_user(self, flask_app, monkeypatch):
        monkeypatch.setattr(account_module, "current_user", object(), raising=False)

        controller = AccountDeleteVerifyApi()
        handler = inspect.unwrap(AccountDeleteVerifyApi.post)

        with flask_app.test_request_context("/account/delete/verify", method="POST", json={}):
            with pytest.raises(ValueError):
                handler(controller)

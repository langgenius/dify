from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.console.workspace.account import AccountInterfaceLanguageApi
from models.account import AccountStatus


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["RESTX_MASK_HEADER"] = "X-Fields"
    return app


def test_update_interface_language_success(app):
    mock_account = MagicMock()
    mock_account.id = "account-1"
    mock_account.status = AccountStatus.ACTIVE
    mock_account.is_authenticated = True
    mock_account.current_tenant_id = "tenant-1"

    with app.test_request_context("/account/interface-language", method="POST", json={"interface_language": "ar-TN"}):
        with ExitStack() as stack:
            stack.enter_context(patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"))
            stack.enter_context(
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, None),
                )
            )
            stack.enter_context(
                patch(
                    "controllers.console.workspace.account.current_account_with_tenant",
                    return_value=(mock_account, None),
                )
            )
            stack.enter_context(patch("libs.login.current_user", mock_account))
            stack.enter_context(patch("libs.login.check_csrf_token", return_value=None))
            stack.enter_context(patch("flask_restx.marshalling.marshal", lambda resp, *_args, **_kwargs: resp))
            mock_update = stack.enter_context(
                patch("controllers.console.workspace.account.AccountService.update_account", return_value=mock_account)
            )

            api = AccountInterfaceLanguageApi()
            response = api.post()

        mock_update.assert_called_once_with(mock_account, interface_language="ar-TN")
        assert response == mock_account


def test_update_interface_language_invalid_lang(app):
    mock_account = MagicMock()
    mock_account.id = "account-2"
    mock_account.status = AccountStatus.ACTIVE
    mock_account.is_authenticated = True
    mock_account.current_tenant_id = "tenant-2"

    with app.test_request_context("/account/interface-language", method="POST", json={"interface_language": "xx-XX"}):
        with ExitStack() as stack:
            stack.enter_context(patch("controllers.console.wraps.dify_config.EDITION", "CLOUD"))
            stack.enter_context(
                patch(
                    "controllers.console.wraps.current_account_with_tenant",
                    return_value=(mock_account, None),
                )
            )
            stack.enter_context(
                patch(
                    "controllers.console.workspace.account.current_account_with_tenant",
                    return_value=(mock_account, None),
                )
            )
            stack.enter_context(patch("libs.login.current_user", mock_account))
            stack.enter_context(patch("libs.login.check_csrf_token", return_value=None))
            stack.enter_context(patch("flask_restx.marshalling.marshal", lambda resp, *_args, **_kwargs: resp))

            api = AccountInterfaceLanguageApi()
            with pytest.raises(ValueError):
                api.post()

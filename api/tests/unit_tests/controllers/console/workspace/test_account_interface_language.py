import pytest
from unittest.mock import patch, MagicMock
from flask import Flask

from controllers.console.workspace.account import AccountInterfaceLanguageApi
from models.account import AccountStatus


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config['TESTING'] = True
    return app


def test_update_interface_language_success(app):
    mock_account = MagicMock()
    mock_account.id = 'account-1'
    mock_account.status = AccountStatus.ACTIVE

    with app.test_request_context('/account/interface-language', method='POST', json={'interface_language': 'ar-TN'}):
        with patch('controllers.console.workspace.account.current_account_with_tenant') as mock_current:
            mock_current.return_value = (mock_account, None)
            with patch('controllers.console.workspace.account.AccountService.update_account') as mock_update:
                mock_update.return_value = mock_account
                api = AccountInterfaceLanguageApi()
                response = api.post()

                mock_update.assert_called_once_with(mock_account, interface_language='ar-TN')
                assert response == mock_account


def test_update_interface_language_invalid_lang(app):
    mock_account = MagicMock()
    mock_account.id = 'account-2'
    mock_account.status = AccountStatus.ACTIVE

    with app.test_request_context('/account/interface-language', method='POST', json={'interface_language': 'xx-XX'}):
        with patch('controllers.console.workspace.account.current_account_with_tenant') as mock_current:
            mock_current.return_value = (mock_account, None)
            api = AccountInterfaceLanguageApi()
            with pytest.raises(ValueError):
                api.post()

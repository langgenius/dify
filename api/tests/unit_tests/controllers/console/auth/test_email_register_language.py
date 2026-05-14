from unittest.mock import MagicMock, patch

from controllers.console.auth.email_register import EmailRegisterResetApi


@patch("controllers.console.auth.email_register.AccountService.create_account_and_tenant")
def test_create_new_account_uses_requested_language(mock_create_account):
    account = MagicMock()
    mock_create_account.return_value = account

    result = EmailRegisterResetApi()._create_new_account(
        "invitee@example.com",
        "ValidPass123!",
        timezone="Asia/Shanghai",
        language="zh-Hans",
    )

    assert result is account
    mock_create_account.assert_called_once_with(
        email="invitee@example.com",
        name="invitee@example.com",
        password="ValidPass123!",
        interface_language="zh-Hans",
        timezone="Asia/Shanghai",
    )

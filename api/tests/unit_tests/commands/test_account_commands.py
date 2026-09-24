from unittest.mock import Mock

import pytest
from click.testing import CliRunner

from commands.account import reset_email, reset_password


def test_reset_password_does_not_swallow_keyboard_interrupt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "commands.account.AccountService.get_account_by_email_with_case_fallback",
        Mock(return_value=Mock()),
    )
    monkeypatch.setattr("commands.account.valid_password", Mock(side_effect=KeyboardInterrupt))

    result = CliRunner().invoke(
        reset_password,
        ["--email", "a@example.com", "--new-password", "whatever", "--password-confirm", "whatever"],
    )

    assert not isinstance(result.exception, SystemExit) or result.exception.code != 0
    assert "Invalid password" not in result.output


def test_reset_email_does_not_swallow_keyboard_interrupt(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "commands.account.AccountService.get_account_by_email_with_case_fallback",
        Mock(return_value=Mock()),
    )
    monkeypatch.setattr("commands.account.email_validate", Mock(side_effect=KeyboardInterrupt))

    result = CliRunner().invoke(
        reset_email,
        ["--email", "a@example.com", "--new-email", "b@example.com", "--email-confirm", "b@example.com"],
    )

    assert not isinstance(result.exception, SystemExit) or result.exception.code != 0
    assert "Invalid email" not in result.output

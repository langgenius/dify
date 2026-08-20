from contextlib import nullcontext
from unittest.mock import MagicMock, Mock

import pytest
from click import Command
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


@pytest.mark.parametrize(
    ("command", "arguments"),
    [
        (
            reset_password,
            [
                "--email",
                "a@example.com",
                "--new-password",
                "valid-password",
                "--password-confirm",
                "valid-password",
            ],
        ),
        (
            reset_email,
            ["--email", "a@example.com", "--new-email", "b@example.com", "--email-confirm", "b@example.com"],
        ),
    ],
)
def test_account_reset_does_not_update_concurrently_closed_account(
    monkeypatch: pytest.MonkeyPatch,
    command: Command,
    arguments: list[str],
) -> None:
    stale_account = Mock(id="00000000-0000-0000-0000-000000000001")
    session = MagicMock()
    account_lock = Mock(return_value=nullcontext())
    load_fresh_account = Mock(return_value=None)
    monkeypatch.setattr("commands.account.db", MagicMock())
    monkeypatch.setattr(
        "commands.account.AccountService.get_account_by_email_with_case_fallback",
        Mock(return_value=stale_account),
    )
    monkeypatch.setattr("commands.account.account_membership_mutation_lock", account_lock)
    monkeypatch.setattr("commands.account.TenantService.get_membership_eligible_account", load_fresh_account)
    monkeypatch.setattr("commands.account.Session", Mock(return_value=nullcontext(session)))
    monkeypatch.setattr("commands.account.valid_password", Mock())
    monkeypatch.setattr("commands.account.hash_password", Mock(return_value=b"hash"))
    monkeypatch.setattr("commands.account.email_validate", Mock())

    result = CliRunner().invoke(command, arguments)

    assert result.exit_code == 0
    assert "Account is not active." in result.output
    account_lock.assert_called_once_with(stale_account.id)
    load_fresh_account.assert_called_once_with(stale_account.id, session=session)
    session.merge.assert_not_called()
    session.commit.assert_not_called()

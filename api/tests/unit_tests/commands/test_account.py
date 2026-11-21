import pytest
from click.testing import CliRunner
from sqlalchemy.orm import Session

from commands.account import reset_email, reset_password
from extensions.ext_application_services import ApplicationServices
from models.account import Account


def _raise_keyboard_interrupt(*_args: object, **_kwargs: object) -> None:
    raise KeyboardInterrupt


def test_reset_password_does_not_swallow_keyboard_interrupt(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    sqlite_session.add(Account(name="Command User", email="a@example.com"))
    sqlite_session.commit()
    monkeypatch.setattr("commands.account.application_services", lambda: account_application_services)
    monkeypatch.setattr("commands.account.valid_password", _raise_keyboard_interrupt)

    result = CliRunner().invoke(
        reset_password,
        ["--email", "a@example.com", "--new-password", "whatever", "--password-confirm", "whatever"],
    )

    assert not isinstance(result.exception, SystemExit) or result.exception.code != 0
    assert "Invalid password" not in result.output


def test_reset_email_does_not_swallow_keyboard_interrupt(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    account_application_services: ApplicationServices,
) -> None:
    sqlite_session.add(Account(name="Command User", email="a@example.com"))
    sqlite_session.commit()
    monkeypatch.setattr("commands.account.application_services", lambda: account_application_services)
    monkeypatch.setattr("commands.account.email_validate", _raise_keyboard_interrupt)

    result = CliRunner().invoke(
        reset_email,
        ["--email", "a@example.com", "--new-email", "b@example.com", "--email-confirm", "b@example.com"],
    )

    assert not isinstance(result.exception, SystemExit) or result.exception.code != 0
    assert "Invalid email" not in result.output

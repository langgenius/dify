from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from commands import system as system_commands


def test_fix_app_site_missing_passes_loaded_session_to_signal(monkeypatch: pytest.MonkeyPatch) -> None:
    account = object()
    tenant = MagicMock()
    tenant.get_accounts.return_value = [account]
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")

    session = Session()
    phase_events: list[str] = []
    scalar = MagicMock(return_value=app)
    get = MagicMock(return_value=tenant)
    commit = MagicMock(side_effect=lambda: phase_events.append("commit"))
    monkeypatch.setattr(session, "scalar", scalar)
    monkeypatch.setattr(session, "get", get)
    monkeypatch.setattr(session, "commit", commit)

    scoped_session = MagicMock(return_value=session)
    scoped_session.scalar.return_value = app

    connection = MagicMock()
    connection.execute.side_effect = [[SimpleNamespace(id=app.id)], []]
    engine = MagicMock()
    engine.begin.return_value.__enter__.return_value = connection

    monkeypatch.setattr(system_commands, "db", SimpleNamespace(engine=engine, session=scoped_session))
    send = MagicMock(side_effect=lambda *_args, **_kwargs: phase_events.append("signal"))
    monkeypatch.setattr(system_commands.app_was_created, "send", send)

    system_commands.fix_app_site_missing.callback()

    scoped_session.assert_called_once_with()
    scalar.assert_called_once()
    get.assert_called_once_with(system_commands.Tenant, app.tenant_id)
    tenant.get_accounts.assert_called_once_with(session=session)
    send.assert_called_once_with(app, account=account, session=session)
    commit.assert_called_once_with()
    assert phase_events == ["signal", "commit"]
    assert isinstance(send.call_args.kwargs["session"], Session)


def test_fix_app_site_missing_rolls_back_when_signal_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    account = object()
    tenant = MagicMock()
    tenant.get_accounts.return_value = [account]
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    session = MagicMock()
    phase_events: list[str] = []
    session.scalar.return_value = app
    session.get.return_value = tenant
    session.rollback.side_effect = lambda: phase_events.append("rollback")

    connection = MagicMock()
    connection.execute.side_effect = [[SimpleNamespace(id=app.id)], []]
    engine = MagicMock()
    engine.begin.return_value.__enter__.return_value = connection

    monkeypatch.setattr(system_commands, "db", SimpleNamespace(engine=engine, session=MagicMock(return_value=session)))

    def fail_signal(*_args, **_kwargs) -> None:
        phase_events.append("signal")
        raise RuntimeError("failed")

    monkeypatch.setattr(system_commands.app_was_created, "send", MagicMock(side_effect=fail_signal))

    system_commands.fix_app_site_missing.callback()

    session.rollback.assert_called_once_with()
    session.commit.assert_not_called()
    assert phase_events == ["signal", "rollback"]

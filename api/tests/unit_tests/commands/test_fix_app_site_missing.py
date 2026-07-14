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
    scalar = MagicMock(return_value=app)
    get = MagicMock(return_value=tenant)
    monkeypatch.setattr(session, "scalar", scalar)
    monkeypatch.setattr(session, "get", get)

    scoped_session = MagicMock(return_value=session)
    scoped_session.scalar.return_value = app

    connection = MagicMock()
    connection.execute.side_effect = [[SimpleNamespace(id=app.id)], []]
    engine = MagicMock()
    engine.begin.return_value.__enter__.return_value = connection

    monkeypatch.setattr(system_commands, "db", SimpleNamespace(engine=engine, session=scoped_session))
    send = MagicMock()
    monkeypatch.setattr(system_commands.app_was_created, "send", send)

    system_commands.fix_app_site_missing.callback()

    scoped_session.assert_called_once_with()
    scalar.assert_called_once()
    get.assert_called_once_with(system_commands.Tenant, app.tenant_id)
    tenant.get_accounts.assert_called_once_with(session=session)
    send.assert_called_once_with(app, account=account, session=session)
    assert isinstance(send.call_args.kwargs["session"], Session)

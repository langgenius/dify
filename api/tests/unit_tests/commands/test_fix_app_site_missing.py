import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from commands import system as system_commands
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, IconType, Site


def _persist_missing_site_owner(session: Session) -> tuple[Account, App]:
    """Persist an app without a Site and its complete tenant owner chain."""
    tenant = Tenant(name="Command workspace")
    account = Account(name="Owner", email=f"owner-{uuid.uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    app = App(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        name="Missing Site App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=False,
        created_by=account.id,
    )
    session.add_all([tenant, account, membership, app])
    session.commit()
    return account, app


def _site_for(app: App) -> Site:
    return Site(
        app_id=app.id,
        title=app.name,
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code=f"site-{app.id}",
    )


def _bind_command_database(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> tuple[scoped_session[Session], Session]:
    """Expose a callable real scoped session through the Flask-SQLAlchemy shape."""
    command_sessions = scoped_session(sqlite_session_factory)
    command_session = command_sessions()
    monkeypatch.setattr(
        system_commands,
        "db",
        SimpleNamespace(engine=sqlite_engine, session=command_sessions),
    )
    return command_sessions, command_session


def test_fix_app_site_missing_passes_loaded_session_to_signal(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account, app = _persist_missing_site_owner(sqlite_session)
    command_sessions, command_session = _bind_command_database(monkeypatch, sqlite_engine, sqlite_session_factory)
    phase_events: list[str] = []
    event.listen(command_session, "after_commit", lambda _session: phase_events.append("commit"))

    def create_site(sender: App, *, account: Account, session: Session) -> None:
        phase_events.append("signal")
        assert sender.id == app.id
        assert account.id == account_id
        assert session is command_session
        session.add(_site_for(sender))

    account_id = account.id
    send = MagicMock(side_effect=create_site)
    monkeypatch.setattr(system_commands.app_was_created, "send", send)

    try:
        system_commands.fix_app_site_missing.callback()
    finally:
        command_sessions.remove()

    send.assert_called_once()
    assert phase_events == ["signal", "commit"]
    sqlite_session.expire_all()
    persisted_site = sqlite_session.query(Site).filter_by(app_id=app.id).one()
    assert persisted_site.title == app.name


def test_fix_app_site_missing_rolls_back_when_signal_fails(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _account, app = _persist_missing_site_owner(sqlite_session)
    command_sessions, command_session = _bind_command_database(monkeypatch, sqlite_engine, sqlite_session_factory)
    phase_events: list[str] = []
    event.listen(command_session, "after_rollback", lambda _session: phase_events.append("rollback"))

    def fail_signal(sender: App, **_kwargs: object) -> None:
        phase_events.append("signal")
        # Ensure the command's next raw scan terminates while its own transaction
        # still exercises the rollback path.
        with sqlite_session_factory() as observer:
            observer.add(_site_for(sender))
            observer.commit()
        raise RuntimeError("failed")

    monkeypatch.setattr(system_commands.app_was_created, "send", MagicMock(side_effect=fail_signal))

    try:
        system_commands.fix_app_site_missing.callback()
    finally:
        command_sessions.remove()

    assert phase_events == ["signal", "rollback"]
    sqlite_session.expire_all()
    assert sqlite_session.get(App, app.id) is not None

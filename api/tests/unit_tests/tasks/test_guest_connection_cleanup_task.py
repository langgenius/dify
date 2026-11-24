"""Scheduled cleanup uses the worker's configured cutoff and enable switch."""

from collections.abc import Callable
from dataclasses import replace
from datetime import timedelta
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.end_user_connection import EndUserConnection
from models.enums import EndUserType
from models.model import EndUser
from tasks.guest_connection_cleanup_task import cleanup_guest_connections
from tests.helpers.end_user_connection_contract import new_connection


def test_worker_uses_guest_retention_settings_and_is_safe_on_redelivery(
    sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None]
) -> None:
    """A queued job is inert when disabled and uses the independent cutoff when enabled."""
    seed = new_connection()
    owner = EndUser(tenant_id=seed.tenant_id, app_id=str(uuid4()), type=EndUserType.BROWSER, session_id=str(uuid4()))
    now = naive_utc_now()
    old = replace(seed, account_id=None, end_user_id=owner.id, last_active_at=now - timedelta(days=3))
    recent = replace(old, last_active_at=now - timedelta(days=1))
    with sqlite_session_factory.begin() as session:
        session.add_all([owner, old, recent])
    config_overrides(ENABLE_GUEST_CONNECTION_CLEANUP_TASK=False, GUEST_CONNECTION_INACTIVITY_DAYS=2)
    cleanup_guest_connections.run()
    with sqlite_session_factory() as session:
        assert session.get(EndUserConnection, old.id) is not None
    config_overrides(ENABLE_GUEST_CONNECTION_CLEANUP_TASK=True)
    cleanup_guest_connections.run()
    cleanup_guest_connections.run()
    with sqlite_session_factory() as session:
        assert session.get(EndUserConnection, old.id) is None
        assert session.get(EndUserConnection, recent.id) is not None

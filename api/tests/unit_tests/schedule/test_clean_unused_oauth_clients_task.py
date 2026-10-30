from datetime import UTC, datetime, timedelta
from types import ModuleType

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.orm import ORMExecuteState, Session

from models.oauth import OpenAPIOAuthClient
from tests.helpers.unit.schedule.task_module_loader import load_schedule_module

NOW = datetime(2026, 10, 26, 12, tzinfo=UTC)
CUTOFF = NOW - timedelta(days=7)


@pytest.fixture
def cleanup_module(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    return load_schedule_module(monkeypatch, "clean_unused_oauth_clients_task")


def _client(client_id: str) -> OpenAPIOAuthClient:
    return OpenAPIOAuthClient(
        client_id=client_id,
        display_name="Agent",
        redirect_uris=["http://127.0.0.1/callback"],
        grant_types=["authorization_code"],
    )


def _add(session: Session, client_id: str, *, created_at: datetime, last_token_at: datetime | None = None) -> None:
    row = _client(client_id)
    session.add(row)
    session.flush()
    row.created_at = created_at
    row.last_token_at = last_token_at
    session.commit()


def _remaining(session: Session) -> set[str]:
    session.expire_all()
    return set(session.scalars(select(OpenAPIOAuthClient.client_id)).all())


def test_deletes_old_never_used_clients_and_keeps_the_rest(sqlite_session: Session, cleanup_module: ModuleType) -> None:
    old = CUTOFF - timedelta(days=1)
    _add(sqlite_session, "dcr_old_unused", created_at=old)
    _add(sqlite_session, "dcr_old_used", created_at=old, last_token_at=old)
    _add(sqlite_session, "dcr_new_unused", created_at=CUTOFF + timedelta(days=1))

    deleted = cleanup_module.clean_unused_oauth_clients(sqlite_session, cutoff=CUTOFF)

    assert deleted == 1
    assert _remaining(sqlite_session) == {"dcr_old_used", "dcr_new_unused"}


def test_a_client_marked_between_the_select_and_the_delete_is_kept(
    sqlite_session: Session, cleanup_module: ModuleType
) -> None:
    old = CUTOFF - timedelta(days=1)
    _add(sqlite_session, "dcr_first_login", created_at=old)
    _add(sqlite_session, "dcr_idle", created_at=old)

    landed: list[bool] = []

    @event.listens_for(sqlite_session, "do_orm_execute")
    def _first_login_lands(state: ORMExecuteState) -> None:
        if state.is_delete and not landed:
            landed.append(True)
            sqlite_session.execute(
                update(OpenAPIOAuthClient)
                .where(OpenAPIOAuthClient.client_id == "dcr_first_login")
                .values(last_token_at=NOW)
            )

    deleted = cleanup_module.clean_unused_oauth_clients(sqlite_session, cutoff=CUTOFF)

    assert deleted == 1
    assert _remaining(sqlite_session) == {"dcr_first_login"}

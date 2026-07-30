from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import patch

import pytest
from sqlalchemy import event, literal, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from controllers.common import session as session_module
from models import Tenant


@contextmanager
def _bind_session_factory(session: Session):
    database_session_factory = sessionmaker(
        bind=session.get_bind(),
        expire_on_commit=False,
    )
    with patch("core.db.session_factory._session_maker", database_session_factory):
        yield


def _tenant_names(session: Session) -> list[str]:
    session.expire_all()
    return list(session.scalars(select(Tenant.name).order_by(Tenant.name)).all())


@pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
def test_with_session_write_commits_on_success(sqlite_session: Session) -> None:
    commit_observed = False
    injected_session: Session | None = None

    class Handler:
        @session_module.with_session(write=True)
        def post(self, session: Session):
            nonlocal commit_observed, injected_session
            injected_session = session

            def observe_commit(_session: Session) -> None:
                nonlocal commit_observed
                commit_observed = True

            event.listen(session, "after_commit", observe_commit)
            session.add(Tenant(name="committed tenant"))
            return "ok"

    with _bind_session_factory(sqlite_session):
        assert Handler().post() == "ok"

    assert commit_observed
    assert injected_session is not None
    assert not injected_session.in_transaction()
    assert _tenant_names(sqlite_session) == ["committed tenant"]


@pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
def test_with_session_default_write_commits_on_success(sqlite_session: Session) -> None:
    class Handler:
        @session_module.with_session
        def post(self, session: Session):
            session.add(Tenant(name="default write tenant"))
            return "ok"

    with _bind_session_factory(sqlite_session):
        assert Handler().post() == "ok"

    assert _tenant_names(sqlite_session) == ["default write tenant"]


@pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
def test_with_session_write_rolls_back_on_error(sqlite_session: Session) -> None:
    rollback_observed = False
    injected_session: Session | None = None

    class Handler:
        @session_module.with_session(write=True)
        def get(self, session: Session):
            nonlocal rollback_observed, injected_session
            injected_session = session

            def observe_rollback(_session: Session) -> None:
                nonlocal rollback_observed
                rollback_observed = True

            event.listen(session, "after_rollback", observe_rollback)
            session.add(Tenant(name="rolled back tenant"))
            session.flush()
            raise RuntimeError("boom")

    with _bind_session_factory(sqlite_session), pytest.raises(RuntimeError, match="boom"):
        Handler().get()

    assert rollback_observed
    assert injected_session is not None
    assert not injected_session.in_transaction()
    assert _tenant_names(sqlite_session) == []


def test_with_session_write_allows_commit_then_more_database_work(sqlite_engine: Engine) -> None:
    with Session(sqlite_engine) as sqlite_session, _bind_session_factory(sqlite_session):

        class Handler:
            @session_module.with_session
            def post(self, session: Session):
                session.commit()
                return session.scalar(select(literal(1)))

        assert Handler().post() == 1


@pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
def test_with_session_read_mode_does_not_commit(sqlite_session: Session) -> None:
    injected_session: Session | None = None

    class Handler:
        @session_module.with_session(write=False)
        def get(self, session: Session):
            nonlocal injected_session
            injected_session = session
            session.add(Tenant(name="uncommitted read tenant"))
            session.flush()
            return "ok"

    with _bind_session_factory(sqlite_session):
        assert Handler().get() == "ok"

    assert injected_session is not None
    assert not injected_session.in_transaction()
    assert _tenant_names(sqlite_session) == []


def test_with_session_preserves_wrapped_metadata() -> None:
    class Handler:
        @session_module.with_session
        def get(self, _session: Session):
            """handler docs"""
            return "ok"

    assert Handler.get.__name__ == "get"
    assert Handler.get.__doc__ == "handler docs"

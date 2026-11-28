"""SQLite-backed tests for the session helpers in ``core.db.session_factory``."""

import pytest
from sqlalchemy import Engine, event, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.db.session_factory import release_session_connection
from models.model import App, AppMode


def _app(app_id: str) -> App:
    return App(
        id=app_id,
        tenant_id="tenant-1",
        name="Release test app",
        mode=AppMode.CHAT,
        enable_site=False,
        enable_api=True,
    )


class TestReleaseSessionConnection:
    @pytest.mark.parametrize("expire_on_commit", [True, False])
    def test_ends_the_transaction_and_keeps_loaded_rows_readable(
        self, sqlite_engine: Engine, expire_on_commit: bool
    ) -> None:
        with Session(sqlite_engine) as setup:
            setup.add(_app("app-1"))
            setup.commit()
        statements: list[str] = []

        def record_statement(
            _connection: object,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: object,
            _executemany: bool,
        ) -> None:
            statements.append(statement)

        with Session(sqlite_engine, expire_on_commit=expire_on_commit) as session:
            app = session.get(App, "app-1")
            assert app is not None
            assert session.in_transaction()

            release_session_connection(session)

            assert not session.in_transaction()
            assert session.expire_on_commit is expire_on_commit
            assert not inspect(app).expired_attributes
            event.listen(sqlite_engine, "before_cursor_execute", record_statement)
            try:
                assert app.name == "Release test app"
            finally:
                event.remove(sqlite_engine, "before_cursor_execute", record_statement)
            assert statements == []
            assert app in session

    def test_restores_expiry_setting_when_the_commit_fails(self, sqlite_engine: Engine) -> None:
        with Session(sqlite_engine) as setup:
            setup.add(_app("app-1"))
            setup.commit()

        with Session(sqlite_engine, expire_on_commit=True) as session:
            session.add(_app("app-1"))

            with pytest.raises(IntegrityError):
                release_session_connection(session)

            assert session.expire_on_commit is True
            session.rollback()

"""Unit tests for libs.db_migration_utils."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from libs.db_migration_utils import try_create_db_if_not_exists

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PG_ARGS = {"host": "localhost", "port": 5432, "username": "postgres", "password": "secret", "database": "dify"}
_MY_ARGS = {"host": "localhost", "port": 3306, "username": "root", "password": "secret", "database": "dify"}


# ---------------------------------------------------------------------------
# Unsupported DB types
# ---------------------------------------------------------------------------


class TestUnsupportedDbType:
    def test_oceanbase_is_noop(self):
        """Unsupported db_type should not raise and should not touch SQLAlchemy."""
        with patch("libs.db_migration_utils.sa.create_engine") as mock_engine:
            try_create_db_if_not_exists(db_type="oceanbase", **_PG_ARGS)
            mock_engine.assert_not_called()

    def test_seekdb_is_noop(self):
        with patch("libs.db_migration_utils.sa.create_engine") as mock_engine:
            try_create_db_if_not_exists(db_type="seekdb", **_PG_ARGS)
            mock_engine.assert_not_called()


# ---------------------------------------------------------------------------
# PostgreSQL
# ---------------------------------------------------------------------------


class TestPostgreSQL:
    def _make_engine_mock(self, db_exists: bool) -> MagicMock:
        """Return a mock engine whose connection reports whether the DB exists."""
        scalar_result = 1 if db_exists else None
        conn = MagicMock()
        conn.execute.return_value.scalar.return_value = scalar_result
        conn.__enter__ = MagicMock(return_value=conn)
        conn.__exit__ = MagicMock(return_value=False)
        engine = MagicMock()
        engine.connect.return_value = conn
        return engine, conn

    def test_creates_database_when_not_exists(self):
        """Should issue CREATE DATABASE when pg_database lookup returns nothing."""
        engine, conn = self._make_engine_mock(db_exists=False)
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="postgresql", **_PG_ARGS)

        # First call: SELECT from pg_database; second call: CREATE DATABASE
        assert conn.execute.call_count == 2
        create_call_sql = str(conn.execute.call_args_list[1][0][0])
        assert "CREATE DATABASE" in create_call_sql

    def test_skips_create_when_database_exists(self):
        """Should NOT issue CREATE DATABASE when the database already exists."""
        engine, conn = self._make_engine_mock(db_exists=True)
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="postgresql", **_PG_ARGS)

        assert conn.execute.call_count == 1  # only the SELECT

    def test_connects_to_postgres_maintenance_db(self):
        """Admin connection must target the 'postgres' maintenance database, not the target DB."""
        engine, _ = self._make_engine_mock(db_exists=True)
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine) as mock_create:
            try_create_db_if_not_exists(db_type="postgresql", **_PG_ARGS)

        uri_used: str = mock_create.call_args[0][0]
        assert uri_used.endswith("/postgres"), f"Expected URI ending in /postgres, got: {uri_used}"

    def test_engine_disposed_on_success(self):
        engine, _ = self._make_engine_mock(db_exists=True)
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="postgresql", **_PG_ARGS)
        engine.dispose.assert_called_once()

    def test_engine_disposed_on_connection_error(self):
        """dispose() must be called even when the connection raises."""
        engine = MagicMock()
        engine.connect.side_effect = Exception("connection refused")
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            # Should not raise — failure is swallowed and logged as warning
            try_create_db_if_not_exists(db_type="postgresql", **_PG_ARGS)
        engine.dispose.assert_called_once()

    def test_exception_is_swallowed_not_raised(self):
        """Any exception during DB creation must be caught; caller must not see it."""
        engine = MagicMock()
        engine.connect.side_effect = RuntimeError("boom")
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="postgresql", **_PG_ARGS)  # must not raise


# ---------------------------------------------------------------------------
# MySQL
# ---------------------------------------------------------------------------


class TestMySQL:
    def _make_engine_mock(self) -> tuple[MagicMock, MagicMock]:
        conn = MagicMock()
        conn.__enter__ = MagicMock(return_value=conn)
        conn.__exit__ = MagicMock(return_value=False)
        engine = MagicMock()
        engine.connect.return_value = conn
        return engine, conn

    def test_issues_create_database_if_not_exists(self):
        """MySQL path should always call CREATE DATABASE IF NOT EXISTS."""
        engine, conn = self._make_engine_mock()
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="mysql", **_MY_ARGS)

        assert conn.execute.called
        sql = str(conn.execute.call_args[0][0])
        assert "CREATE DATABASE IF NOT EXISTS" in sql

    def test_commits_after_create(self):
        engine, conn = self._make_engine_mock()
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="mysql", **_MY_ARGS)
        conn.commit.assert_called_once()

    def test_connects_without_database_in_uri(self):
        """MySQL admin URI must not include the target database name."""
        engine, _ = self._make_engine_mock()
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine) as mock_create:
            try_create_db_if_not_exists(db_type="mysql", **_MY_ARGS)

        uri_used: str = mock_create.call_args[0][0]
        assert uri_used.endswith("/"), f"Expected URI ending in '/', got: {uri_used}"

    def test_engine_disposed_on_success(self):
        engine, _ = self._make_engine_mock()
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="mysql", **_MY_ARGS)
        engine.dispose.assert_called_once()

    def test_exception_is_swallowed_not_raised(self):
        engine = MagicMock()
        engine.connect.side_effect = RuntimeError("boom")
        with patch("libs.db_migration_utils.sa.create_engine", return_value=engine):
            try_create_db_if_not_exists(db_type="mysql", **_MY_ARGS)  # must not raise

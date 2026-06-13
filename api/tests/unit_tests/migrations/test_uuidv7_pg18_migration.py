"""Tests for the uuidv7 SQL migration's PostgreSQL 18 compatibility guard.

The migration file name is not a valid Python identifier (it starts with a date and
contains hyphens), so it is loaded directly from its path. The ``models`` import at the
top of the migration is stubbed because the migration never uses it during
``upgrade()``/``downgrade()`` and pulling in the real package would require a full app
context.
"""

import importlib.util
import sys
import types
from pathlib import Path
from unittest import mock

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations"
    / "versions"
    / "2025_07_02_2332-1c9ba48be8e4_add_uuidv7_function_in_sql.py"
)


def _load_migration():
    # The migration does `import models as models` but never references it, so a stub is
    # enough and keeps the test free of any database/app configuration.
    sys.modules.setdefault("models", types.ModuleType("models"))
    spec = importlib.util.spec_from_file_location("uuidv7_pg18_migration_under_test", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_sentinel = object()


def _make_bind(dialect_name, scalar_return=_sentinel, execute_return=_sentinel):
    """Create a mock bind.

    When ``execute_return`` is set, ``conn.execute()`` returns that value (e.g. None for
    Alembic offline mode). When ``scalar_return`` is set and ``execute_return`` is left
    at the sentinel, ``conn.execute()`` returns a mock whose ``.scalar()`` returns
    ``scalar_return``.
    """
    bind = mock.MagicMock()
    bind.dialect.name = dialect_name
    if execute_return is not _sentinel:
        bind.execute.return_value = execute_return
    elif scalar_return is not _sentinel:
        bind.execute.return_value.scalar.return_value = scalar_return
    return bind


def _executed_sql(fake_op):
    return [str(call.args[0]) for call in fake_op.execute.call_args_list]


@pytest.fixture
def migration():
    return _load_migration()


def test_upgrade_creates_both_functions_when_native_uuidv7_absent(migration):
    # PostgreSQL 13 to 17: no native pg_catalog.uuidv7(), so both functions are created.
    bind = _make_bind("postgresql", scalar_return=None)
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.upgrade()

    sql = _executed_sql(fake_op)
    assert any("CREATE FUNCTION uuidv7()" in stmt for stmt in sql)
    assert any("CREATE FUNCTION uuidv7_boundary(timestamptz)" in stmt for stmt in sql)


def test_upgrade_skips_uuidv7_but_keeps_boundary_when_native_present(migration):
    # PostgreSQL 18: native pg_catalog.uuidv7() exists, so we must not recreate it, but
    # uuidv7_boundary is still missing and has to be created unconditionally.
    bind = _make_bind("postgresql", scalar_return=1)
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.upgrade()

    sql = _executed_sql(fake_op)
    assert not any("CREATE FUNCTION uuidv7()" in stmt for stmt in sql)
    assert any("CREATE FUNCTION uuidv7_boundary(timestamptz)" in stmt for stmt in sql)

    # The presence check must look up uuidv7 in the pg_catalog schema.
    probe_sql = str(bind.execute.call_args.args[0])
    assert "pg_catalog" in probe_sql
    assert "uuidv7" in probe_sql


def test_upgrade_handles_offline_mode_where_execute_returns_none(migration):
    # Alembic offline mode: conn.execute() may return None because there is no real
    # database connection. The guard must not crash and should default to creating
    # the function (safe for SQL output generation).
    bind = _make_bind("postgresql", execute_return=None)
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.upgrade()

    # In offline mode we conservatively create uuidv7() since we cannot probe.
    sql = _executed_sql(fake_op)
    assert any("CREATE FUNCTION uuidv7()" in stmt for stmt in sql)
    assert any("CREATE FUNCTION uuidv7_boundary(timestamptz)" in stmt for stmt in sql)


def test_upgrade_is_noop_on_non_postgres(migration):
    bind = _make_bind("sqlite")
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.upgrade()

    fake_op.execute.assert_not_called()
    bind.execute.assert_not_called()


def test_downgrade_uses_if_exists_and_public_schema(migration):
    bind = _make_bind("postgresql")
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.downgrade()

    sql = _executed_sql(fake_op)
    assert "DROP FUNCTION IF EXISTS public.uuidv7()" in sql
    assert "DROP FUNCTION IF EXISTS public.uuidv7_boundary(timestamptz)" in sql


def test_downgrade_is_noop_on_non_postgres(migration):
    bind = _make_bind("sqlite")
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.downgrade()

    fake_op.execute.assert_not_called()

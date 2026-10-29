"""Tests for migration `9e7c4b8f2a31` (rebuild agent_tenant_invitable_idx concurrently).

Verifies the migration:

- on PostgreSQL, drops and recreates ``agent_tenant_invitable_idx`` with
  ``postgresql_concurrently=True``, both outside any transaction.
- on non-PostgreSQL dialects, drops and recreates the index without the
  ``CONCURRENTLY`` flag.
- on PostgreSQL downgrade, drops the index with ``postgresql_concurrently=True``.

The migration file name contains a date prefix and hyphens so it is loaded directly
via ``importlib`` (as in ``test_uuidv7_pg18_migration.py``).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest import mock

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations"
    / "versions"
    / "2026_07_26_1430-9e7c4b8f2a31_rebuild_agent_tenant_invitable_concurrently.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "rebuild_agent_tenant_invitable_concurrently_under_test", MIGRATION_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _make_bind(dialect_name):
    bind = mock.MagicMock()
    bind.dialect.name = dialect_name
    return bind


@pytest.fixture
def migration():
    return _load_migration()


def test_upgrade_postgresql_drops_then_creates_concurrently(migration):
    bind = _make_bind("postgresql")
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.upgrade()

        fake_op.get_context.return_value.autocommit_block.assert_called_once_with()
        assert fake_op.drop_index.call_count == 1
        assert fake_op.create_index.call_count == 1

        drop_kwargs = fake_op.drop_index.call_args.kwargs
        assert drop_kwargs["table_name"] == "agents"
        assert drop_kwargs["postgresql_concurrently"] is True

        create_kwargs = fake_op.create_index.call_args.kwargs
        assert create_kwargs["postgresql_concurrently"] is True


def test_upgrade_non_postgresql_skips_concurrently(migration):
    bind = _make_bind("mysql")
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.upgrade()

        fake_op.get_context.return_value.autocommit_block.assert_not_called()
        assert fake_op.drop_index.call_count == 1
        assert fake_op.create_index.call_count == 1

        drop_kwargs = fake_op.drop_index.call_args.kwargs
        assert "postgresql_concurrently" not in drop_kwargs

        create_kwargs = fake_op.create_index.call_args.kwargs
        assert "postgresql_concurrently" not in create_kwargs


def test_downgrade_postgresql_drops_concurrently(migration):
    bind = _make_bind("postgresql")
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.downgrade()

        fake_op.get_context.return_value.autocommit_block.assert_called_once_with()
        assert fake_op.drop_index.call_count == 1
        assert fake_op.create_index.call_count == 0
        drop_kwargs = fake_op.drop_index.call_args.kwargs
        assert drop_kwargs["postgresql_concurrently"] is True


def test_downgrade_non_postgresql_drops_normally(migration):
    bind = _make_bind("sqlite")
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = bind
        migration.downgrade()

        fake_op.get_context.return_value.autocommit_block.assert_not_called()
        assert fake_op.drop_index.call_count == 1
        drop_kwargs = fake_op.drop_index.call_args.kwargs
        assert "postgresql_concurrently" not in drop_kwargs


def test_index_definition_matches_original(migration):
    """The recreated index must match the definition from `9f4b7c2d1a80`."""
    assert migration._INDEX_NAME == "agent_tenant_invitable_idx"
    assert migration._INDEX_TABLE == "agents"
    assert migration._INDEX_COLUMNS == [
        "tenant_id",
        "scope",
        "status",
        "active_config_has_model",
        "updated_at",
    ]

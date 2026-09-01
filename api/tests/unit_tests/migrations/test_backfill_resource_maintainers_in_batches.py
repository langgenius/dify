"""Tests for migration ``f5a2c8e6b1d4`` (backfill resource maintainers in id-cursor batches).

The migration walks the ``apps`` and ``datasets`` tables in id-cursor
batches, populating ``maintainer = created_by`` for rows still NULL.
These tests mock ``conn.execute`` to drive the cursor through several
pages and assert on the SQL + bindings actually sent.
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
    / "2026_07_27_0900-f5a2c8e6b1d4_backfill_resource_maintainers_in_batches.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "backfill_resource_maintainers_in_batches_under_test", MIGRATION_PATH
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def migration():
    return _load_migration()


@pytest.fixture
def scripted_conn():
    """Mock alembic connection that runs scripted SELECT/UPDATE responses.

    Pass a list of ``("page-ids", "update-row-count", ...)`` triples to
    ``.set_script``; each page returns the SELECT ids and the matching
    UPDATE rowcount. Captures every execute() call for assertion.
    """
    conn = mock.MagicMock()
    captured = {"calls": [], "script": []}

    def _execute(stmt, params=None):
        kind = str(stmt).split()[0].upper()
        params = params or {}
        # Skip the cursor's own rowcount UPDATE call for verification - capture all.
        captured["calls"].append({"sql": str(stmt), "params": params, "kind": kind})
        if kind == "SELECT":
            page_index = sum(1 for c in captured["calls"] if c["kind"] == "SELECT") - 1
            script = captured["script"][page_index] if page_index < len(captured["script"]) else ([], 0)
            ids, rowcount = script
            # Mock SQLAlchemy result row proxy: only .scalars().all() is needed.
            result = mock.MagicMock()
            result.scalars.return_value.all.return_value = ids
            return result
        if kind == "UPDATE":
            result = mock.MagicMock()
            page_index = sum(1 for c in captured["calls"] if c["kind"] == "UPDATE") - 1
            script = captured["script"][page_index] if page_index < len(captured["script"]) else ([], 0)
            _, rowcount = script
            result.rowcount = rowcount
            return result
        raise AssertionError(f"unexpected statement: {stmt!r}")

    conn.execute.side_effect = _execute
    conn.dialect.name = "postgresql"
    conn.set_script = lambda script: captured.update({"script": script})
    conn.captured = captured
    return conn


def _select_calls(captured):
    return [c for c in captured["calls"] if c["kind"] == "SELECT"]


def _update_calls(captured):
    return [c for c in captured["calls"] if c["kind"] == "UPDATE"]


def test_batches_walk_table_by_keyset_cursor(migration, scripted_conn):
    # Three pages: ids, exhausted-empty.
    scripted_conn.set_script(
        [
            (["id-a", "id-b", "id-c"], 3),
            (["id-d"], 1),
            ([], 0),
        ]
    )

    total = migration._backfill_in_cursor_batches(scripted_conn, table="apps", batch_size=3)

    selects = _select_calls(scripted_conn.captured)
    updates = _update_calls(scripted_conn.captured)

    # Only the first two pages should trigger UPDATE; the empty page stops the cursor.
    assert len(updates) == 2
    assert len(selects) == 3
    # Cumulative row count: 3 + 1 = 4.
    assert total == 4

    # First SELECT has no id filter (cursor reset).
    assert "id > :last_id" not in selects[0]["sql"]
    assert "batch_size" in selects[0]["params"]

    # Subsequent SELECTs include the previous batch's last id.
    assert "id > :last_id" in selects[1]["sql"]
    assert selects[1]["params"]["last_id"] == "id-c"
    assert "batch_size" in selects[1]["params"]


def test_last_id_uses_final_uuid_of_previous_page(migration, scripted_conn):
    """Edge case: 2-page walk picks the trailing id of the first page."""
    scripted_conn.set_script([(["id-a", "id-b"], 2), ([], 0)])

    migration._backfill_in_cursor_batches(scripted_conn, table="apps", batch_size=2)

    selects = _select_calls(scripted_conn.captured)
    updates = _update_calls(scripted_conn.captured)
    assert selects[1]["params"]["last_id"] == "id-b"

    # UPDATE uses id = ANY(:ids) and the captured id list.
    for update_call, expected_ids in zip(updates, [["id-a", "id-b"]]):
        assert "id = ANY(:ids)" in update_call["sql"]
        assert list(update_call["params"]["ids"]) == expected_ids


def test_is_noop_when_no_null_rows(migration, scripted_conn):
    scripted_conn.set_script([([], 0)])

    total = migration._backfill_in_cursor_batches(scripted_conn, table="apps")

    assert total == 0
    assert len(_select_calls(scripted_conn.captured)) == 1
    assert _update_calls(scripted_conn.captured) == []


def test_upgrade_walks_both_tables(migration):
    """The migration's `upgrade()` iterates the apps + datasets tables once each."""
    with mock.patch.object(migration, "op") as fake_op:
        fake_op.get_bind.return_value = mock.MagicMock()
        fake_op.get_bind.return_value.dialect.name = "postgresql"

        # Track calls without driving real SQL; just record which tables were asked about.
        with mock.patch.object(
            migration, "_backfill_in_cursor_batches", autospec=True
        ) as patched:
            migration.upgrade()

    assert patched.call_count == 2
    tables_walked = [c.kwargs["table"] for c in patched.call_args_list]
    assert sorted(tables_walked) == sorted(["apps", "datasets"])


def test_downgrade_is_noop(migration):
    """Downgrade is intentionally a no-op because we cannot tell which rows we wrote."""
    with mock.patch.object(migration, "op") as fake_op:
        migration.downgrade()

    fake_op.get_bind.assert_not_called()


def test_batch_size_constant(migration):
    assert migration.BATCH_SIZE == 10_000


def test_revision_chain(migration):
    assert migration.revision == "f5a2c8e6b1d4"
    assert migration.down_revision == "d2825e7b9c10"
    assert migration.branch_labels is None
    assert migration.depends_on is None

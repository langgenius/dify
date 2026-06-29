"""backfill resource maintainers in id-cursor batches

Revision ID: b7c8d9e0f1a2
Revises: c8f4a6b2d3e1
Create Date: 2026-06-22 09:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "b7c8d9e0f1a2"
down_revision = "c8f4a6b2d3e1"
branch_labels = None
depends_on = None


BATCH_SIZE = 10_000
TABLES = ("apps", "datasets")


def _apply_in_id_cursor_batches(conn, *, table: str, set_clause: str, where_extra: str) -> None:
    """Apply `SET set_clause` to rows of `table` matching `WHERE where_extra`,
    advancing a keyset cursor over `id`.

    The `apps` and `datasets` tables use random StringUUID (uuid4) primary
    keys, so an id-range scan over the 128-bit UUID space would land roughly
    `BATCH_SIZE / 2^128` rows per batch — effectively empty. Cursor pagination
    (`ORDER BY id` + `id > :last_id`) instead walks the table deterministically
    in BATCH_SIZE-row steps.

    Each batch runs as its own transaction (via `autocommit_block`), so row
    locks acquired by the UPDATE are released between batches instead of
    being held for the entire backfill. Restarts cleanly from the last
    committed cursor id on re-run because completed batches no longer
    satisfy the WHERE clause.
    """
    last_id: str | None = None
    while True:
        if last_id is None:
            ids = conn.execute(
                sa.text(
                    f"SELECT id FROM {table} "
                    f"WHERE {where_extra} "
                    f"ORDER BY id LIMIT :batch_size"
                ),
                {"batch_size": BATCH_SIZE},
            ).scalars().all()
        else:
            ids = conn.execute(
                sa.text(
                    f"SELECT id FROM {table} "
                    f"WHERE {where_extra} AND id > :last_id "
                    f"ORDER BY id LIMIT :batch_size"
                ),
                {"last_id": last_id, "batch_size": BATCH_SIZE},
            ).scalars().all()
        if not ids:
            return
        conn.execute(
            sa.text(
                f"UPDATE {table} "
                f"SET {set_clause} "
                f"WHERE id = ANY(:ids)"
            ),
            {"ids": ids},
        )
        last_id = ids[-1]


def upgrade() -> None:
    # Split out from a7c4e9d2f681 so the backfill can release row locks
    # between batches instead of holding them across the full backfill.
    # Without batching, a single tenant with millions of rows in `apps` or
    # `datasets` would block all concurrent INSERT/UPDATE/DELETE against
    # either table for the entire backfill duration, surfacing as 504 /
    # timeouts on the application path.
    #
    # Idempotent: `maintainer IS NULL` matches only unfilled rows, so
    # re-running is a no-op once the backfill completes.
    with op.get_context().autocommit_block():
        conn = op.get_bind()
        for table in TABLES:
            _apply_in_id_cursor_batches(
                conn,
                table=table,
                set_clause="maintainer = created_by",
                where_extra="maintainer IS NULL",
            )


def downgrade() -> None:
    # Reverse the backfill: clear `maintainer` for rows that were set to
    # `created_by` by this migration. Batched identically to the upgrade.
    with op.get_context().autocommit_block():
        conn = op.get_bind()
        for table in TABLES:
            _apply_in_id_cursor_batches(
                conn,
                table=table,
                set_clause="maintainer = NULL",
                where_extra="maintainer = created_by",
            )

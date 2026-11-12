"""backfill resource maintainers in id-cursor batches

Revision ID: f5a2c8e6b1d4
Revises: d2825e7b9c10
Create Date: 2026-07-27 09:00:00.000000

Split the unbatched ``UPDATE apps`` / ``UPDATE datasets`` from migration
``a7c4e9d2f681`` into id-cursor batches with a commit between every
batch so row locks are released on the hot ``apps`` and ``datasets``
tables instead of being held for the entire backfill duration.

The original a7c4e9d2f681 migration adds the ``maintainer`` column,
``(tenant_id, maintainer)`` indexes, and runs two unbatched
``UPDATE ... SET maintainer = created_by WHERE maintainer IS NULL``
statements — one per table. Each statement holds a lock for the full
backfill duration on a hot table. If a7c4e9d2f681 was interrupted
mid-update (operator pause, DB restart, statement timeout), the
remaining NULL ``maintainer`` rows are left behind and standard
applications code that expects ``maintainer`` to be populated
(RBAC checks, ownership queries) silently picks up NULL.

This follow-up migration walks each table in ``BATCH_SIZE`` rows using
a keyset cursor over ``id`` (``ORDER BY id`` + ``id > :last_id``) and
commits implicitly between every statement. The ``WHERE maintainer
IS NULL`` filter makes it a no-op on fresh deployments
(a7c4e9d2f681 already populated every row) and restartable from the
last committed cursor id on a partial failure.

``down_revision`` is the current head (``d2825e7b9c10``) rather than
``a7c4e9d2f681`` — appending this fix to the head keeps the migration
graph linear and avoids branching the chain.

We cannot edit ``a7c4e9d2f681`` in place: alembic migrations are
immutable once shipped. Production databases that already ran it
will not pick up an in-place edit.

Mirrors the cursor-pagination and ``autocommit_block`` patterns used
elsewhere in the migrations directory.

Fixes #37706.

"""

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = "f5a2c8e6b1d4"
down_revision = "d2825e7b9c10"
branch_labels = None
depends_on = None


BATCH_SIZE = 10_000
_TABLES = ("apps", "datasets")


def _backfill_in_cursor_batches(conn, *, table: str, batch_size: int = BATCH_SIZE) -> int:
    """Walk `table` in `batch_size` chunks by keyset cursor over `id`,
    populating ``maintainer = created_by`` for any rows still NULL.

    Returns the number of rows updated. Each cursor page runs as its
    own statement so the row locks from the UPDATE are released before
    the next batch starts. Idempotent: re-running on a fully
    backfilled table returns 0 because no rows satisfy the WHERE
    filter.

    The `apps` and `datasets` tables use random ``StringUUID`` (uuid4)
    primary keys, so a fixed id-range scan over the 128-bit UUID space
    would land roughly ``batch_size / 2**128`` rows per batch —
    effectively empty. Cursor pagination instead walks the table
    deterministically in ``batch_size``-row steps.
    """
    total = 0
    last_id: str | None = None
    while True:
        if last_id is None:
            ids = conn.execute(
                sa.text(
                    f"SELECT id FROM {table} "
                    f"WHERE maintainer IS NULL "
                    f"ORDER BY id LIMIT :batch_size"
                ),
                {"batch_size": batch_size},
            ).scalars().all()
        else:
            ids = conn.execute(
                sa.text(
                    f"SELECT id FROM {table} "
                    f"WHERE maintainer IS NULL AND id > :last_id "
                    f"ORDER BY id LIMIT :batch_size"
                ),
                {"last_id": last_id, "batch_size": batch_size},
            ).scalars().all()
        if not ids:
            return total
        result = conn.execute(
            sa.text(
                f"UPDATE {table} SET maintainer = created_by "
                f"WHERE id = ANY(:ids)"
            ),
            {"ids": list(ids)},
        )
        total += result.rowcount or 0
        last_id = ids[-1]


def upgrade():
    conn = op.get_bind()
    for table in _TABLES:
        _backfill_in_cursor_batches(conn, table=table)


def downgrade():
    # Irreversible. We do not know which rows we wrote versus which were
    # set by application code after this migration ran, so we cannot
    # safely clear ``maintainer``. Operators wanting to undo this
    # migration must manually ``UPDATE <table> SET maintainer = NULL``
    # for rows where they recorded the backfill timestamp.
    pass

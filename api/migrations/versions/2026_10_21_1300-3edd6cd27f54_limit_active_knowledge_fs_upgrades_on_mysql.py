"""limit active KnowledgeFS legacy Dataset upgrades on MySQL

Revision ID: 3edd6cd27f54
Revises: b6e2c4d8f1a0
Create Date: 2026-10-21 13:00:00.000000

MySQL has no partial indexes, so e6b4a2c9d731 created an unconditional unique index there and
a finished job blocked every later upgrade of the same Dataset. MySQL instead indexes a
generated column that is NULL for terminal jobs; NULLs never collide in a unique index.
PostgreSQL keeps its partial index.
"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "3edd6cd27f54"
down_revision = "b6e2c4d8f1a0"
branch_labels = None
depends_on = None

_TABLE = "knowledge_fs_upgrade_jobs"
_INDEX = "kfs_upgrade_job_active_dataset_uq"
_ACTIVE_DATASET_COLUMN = "active_old_dataset_id"


def _is_mysql() -> bool:
    return op.get_context().dialect.name == "mysql"


def upgrade() -> None:
    if not _is_mysql():
        return
    op.drop_index(_INDEX, table_name=_TABLE)
    op.add_column(
        _TABLE,
        sa.Column(
            _ACTIVE_DATASET_COLUMN,
            models.types.StringUUID(),
            sa.Computed("CASE WHEN status IN ('queued', 'running') THEN old_dataset_id ELSE NULL END", persisted=True),
            nullable=True,
        ),
    )
    op.create_index(_INDEX, _TABLE, ["tenant_id", _ACTIVE_DATASET_COLUMN], unique=True)


def downgrade() -> None:
    if not _is_mysql():
        return
    op.drop_index(_INDEX, table_name=_TABLE)
    op.drop_column(_TABLE, _ACTIVE_DATASET_COLUMN)
    # The original unconditional unique index would reject finished jobs that share a Dataset
    # with a later upgrade; e6b4a2c9d731 only needs the name to exist for its own downgrade.
    op.create_index(_INDEX, _TABLE, ["tenant_id", "old_dataset_id"], unique=False)

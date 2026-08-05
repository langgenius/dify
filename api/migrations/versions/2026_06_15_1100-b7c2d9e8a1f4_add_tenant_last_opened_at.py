"""add tenant account join last opened at

Revision ID: b7c2d9e8a1f4
Revises: 9f4b7c2d1a80
Create Date: 2026-06-05 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import context, op

# revision identifiers, used by Alembic.
revision = "b7c2d9e8a1f4"
down_revision = "9f4b7c2d1a80"
branch_labels = None
depends_on = None


def upgrade():
    if _has_last_opened_at_column():
        return
    with op.batch_alter_table("tenant_account_joins", schema=None) as batch_op:
        batch_op.add_column(sa.Column("last_opened_at", sa.DateTime(), nullable=True))


def downgrade():
    if not _has_last_opened_at_column():
        return
    with op.batch_alter_table("tenant_account_joins", schema=None) as batch_op:
        batch_op.drop_column("last_opened_at")


def _has_last_opened_at_column() -> bool:
    if context.is_offline_mode():
        # Offline SQL generation cannot inspect the target schema. Assume the
        # linear migration path so generated SQL stays explicit.
        return False
    inspector = sa.inspect(op.get_bind())
    return "last_opened_at" in {column["name"] for column in inspector.get_columns("tenant_account_joins")}

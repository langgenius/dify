"""add plugin auto upgrade category

Revision ID: f6a7b8c9d012
Revises: b7c2d9e8a1f4
Create Date: 2026-05-15 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "f6a7b8c9d012"
down_revision = "b7c2d9e8a1f4"
branch_labels = None
depends_on = None


LEGACY_CATEGORY = "tool"
UNIQUE_CONSTRAINT_NAME = "unique_tenant_plugin_auto_upgrade_strategy"
UPGRADE_TIME_INDEX_NAME = "idx_tenant_plugin_auto_upgrade_strategy_time"
STRATEGY_TABLE_NAME = "tenant_plugin_auto_upgrade_strategies"


def upgrade():
    with op.batch_alter_table(STRATEGY_TABLE_NAME, schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("category", sa.String(length=32), server_default=LEGACY_CATEGORY, nullable=False)
        )
        batch_op.drop_constraint(UNIQUE_CONSTRAINT_NAME, type_="unique")
        batch_op.create_unique_constraint(UNIQUE_CONSTRAINT_NAME, ["tenant_id", "category"])
        batch_op.create_index(UPGRADE_TIME_INDEX_NAME, ["upgrade_time_of_day"])


def downgrade():
    op.execute(sa.text(f"DELETE FROM {STRATEGY_TABLE_NAME} WHERE category != '{LEGACY_CATEGORY}'"))

    with op.batch_alter_table(STRATEGY_TABLE_NAME, schema=None) as batch_op:
        batch_op.drop_index(UPGRADE_TIME_INDEX_NAME)
        batch_op.drop_constraint(UNIQUE_CONSTRAINT_NAME, type_="unique")
        batch_op.drop_column("category")
        batch_op.create_unique_constraint(UNIQUE_CONSTRAINT_NAME, ["tenant_id"])

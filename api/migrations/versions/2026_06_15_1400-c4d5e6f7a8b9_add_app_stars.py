"""add app stars

Revision ID: c4d5e6f7a8b9
Revises: f5e8a9c0d2b3
Create Date: 2026-06-08 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

# revision identifiers, used by Alembic.
revision = "c4d5e6f7a8b9"
down_revision = "f5e8a9c0d2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_stars",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="app_star_pkey"),
        sa.UniqueConstraint("tenant_id", "account_id", "app_id", name="app_star_tenant_account_app_unique"),
    )
    with op.batch_alter_table("app_stars", schema=None) as batch_op:
        batch_op.create_index("app_star_tenant_account_idx", ["tenant_id", "account_id"], unique=False)
        batch_op.create_index("app_star_app_idx", ["app_id"], unique=False)


def downgrade() -> None:
    op.drop_table("app_stars")

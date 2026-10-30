"""Record personal App usage independently of workspace installations.

Revision ID: b73e9c40a215
Revises: a91d5e7c3b20
Create Date: 2026-10-30 16:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "b73e9c40a215"
down_revision = "a91d5e7c3b20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_app_usages",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="account_app_usages_pkey"),
        sa.UniqueConstraint("account_id", "tenant_id", "app_id", name="account_app_usage_owner_key"),
    )
    op.create_index("account_app_usage_recent_idx", "account_app_usages", ["account_id", "last_used_at", "app_id"])


def downgrade() -> None:
    op.drop_table("account_app_usages")

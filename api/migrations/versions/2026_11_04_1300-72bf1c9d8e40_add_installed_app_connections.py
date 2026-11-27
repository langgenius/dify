"""Persist member Workspace credential selections for Installed Apps.

Revision ID: 72bf1c9d8e40
Revises: 6a1f3e8c2d47
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "72bf1c9d8e40"
down_revision = "6a1f3e8c2d47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "installed_app_connection_configurations",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("installed_app_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=False),
        sa.Column("scope_id", sa.String(36), nullable=False),
        sa.Column("connection_revision", StringUUID(), nullable=False),
        sa.Column("connections", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("installed_app_id", "account_id", "scope_id", name="installed_connection_owner_key"),
    )
    op.create_index("installed_connection_app_idx", "installed_app_connection_configurations", ["tenant_id", "app_id"])


def downgrade() -> None:
    op.drop_table("installed_app_connection_configurations")

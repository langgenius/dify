"""Persist deduplicated Web App connection authorization snapshots.

Revision ID: d92e7a1b604f
Revises: a57d8c91e024
Create Date: 2026-10-26 18:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "d92e7a1b604f"
down_revision = "a57d8c91e024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "end_user_connection_revisions",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("snapshot", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connection_revisions_pkey"),
        sa.UniqueConstraint("tenant_id", "app_id", "fingerprint", name="end_user_connection_revision_content_key"),
    )


def downgrade() -> None:
    op.drop_table("end_user_connection_revisions")

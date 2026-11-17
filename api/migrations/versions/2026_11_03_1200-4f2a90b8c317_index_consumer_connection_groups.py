"""Index Account-wide Connection group lookups.

Revision ID: 4f2a90b8c317
Revises: b73e9c40a215
Create Date: 2026-11-03 12:00:00.000000
"""

from alembic import op

revision = "4f2a90b8c317"
down_revision = "b73e9c40a215"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "end_user_connection_consumer_idx", "end_user_connections", ["account_id", "provider", "credential_type", "id"]
    )


def downgrade() -> None:
    op.drop_index("end_user_connection_consumer_idx", table_name="end_user_connections")

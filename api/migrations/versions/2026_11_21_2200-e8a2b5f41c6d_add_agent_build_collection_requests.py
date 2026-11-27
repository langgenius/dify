"""Keep Build binding collection requests discoverable until cleanup completes.

Revision ID: e8a2b5f41c6d
Revises: 6b1d2f4e8a90
Create Date: 2026-11-21 22:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision: str = "e8a2b5f41c6d"
down_revision: str | Sequence[str] | None = "6b1d2f4e8a90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create only the durable Build collection intent table and its indexes."""
    op.create_table(
        "agent_build_collection_requests",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("binding_id", StringUUID(), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.PrimaryKeyConstraint("id", name="agent_build_collection_request_pkey"),
    )
    op.create_index(
        "agent_build_collection_tenant_binding_unique",
        "agent_build_collection_requests",
        ["tenant_id", "binding_id"],
        unique=True,
    )
    op.create_index(
        "agent_build_collection_retry_idx",
        "agent_build_collection_requests",
        ["last_attempt_at", "attempt_count"],
        unique=False,
    )


def downgrade() -> None:
    """Drop the intent schema; callers must first handle every pending intent."""
    # Existing retired bindings are still discoverable through their old paths.
    # Do not downgrade with unprocessed Build collection requests: dropping
    # them here would remove the only durable recovery record.
    op.drop_index(
        "agent_build_collection_retry_idx",
        table_name="agent_build_collection_requests",
    )
    op.drop_index(
        "agent_build_collection_tenant_binding_unique",
        table_name="agent_build_collection_requests",
    )
    op.drop_table("agent_build_collection_requests")

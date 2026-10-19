"""add managed_by to resource access tokens

Revision ID: b4e8d2a6c913
Revises: c6f4a90d8b31
Create Date: 2026-10-19 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "b4e8d2a6c913"
down_revision = "c6f4a90d8b31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("resource_access_tokens", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("managed_by", sa.String(length=16), server_default=sa.text("'user'"), nullable=False)
        )
        batch_op.alter_column("created_by", existing_type=models.types.StringUUID(), nullable=True)


def downgrade() -> None:
    # Managed tokens may have no creator and cannot survive the restored NOT NULL constraint.
    op.execute(
        "DELETE FROM resource_access_tokens_relation WHERE token_id IN "
        "(SELECT id FROM resource_access_tokens WHERE managed_by <> 'user' OR created_by IS NULL)"
    )
    op.execute("DELETE FROM resource_access_tokens WHERE managed_by <> 'user' OR created_by IS NULL")
    with op.batch_alter_table("resource_access_tokens", schema=None) as batch_op:
        batch_op.alter_column("created_by", existing_type=models.types.StringUUID(), nullable=False)
        batch_op.drop_column("managed_by")

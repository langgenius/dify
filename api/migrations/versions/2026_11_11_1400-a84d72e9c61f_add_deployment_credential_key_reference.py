"""Persist the deployment credential key reference without provisioning material.

Revision ID: a84d72e9c61f
Revises: 6b7e2a9c4d10
"""

import sqlalchemy as sa
from alembic import op

revision = "a84d72e9c61f"
down_revision = "6b7e2a9c4d10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add nullable reference; existing installations require explicit provisioning."""
    with op.batch_alter_table("dify_setups") as batch_op:
        batch_op.add_column(sa.Column("credential_encryption_key_ref", sa.Text(), nullable=True))


def downgrade() -> None:
    """Remove only the reference column; external keys remain available for recovery."""
    with op.batch_alter_table("dify_setups") as batch_op:
        batch_op.drop_column("credential_encryption_key_ref")

"""Add current Workspace Builder cognition policy.

Revision ID: 3f51c8a6d902
Revises: db7f42c9a801
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "3f51c8a6d902"
down_revision = "db7f42c9a801"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dify_builder_cognition_policies",
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("policy", sa.JSON(), nullable=False),
        sa.Column("updated_by", StringUUID(), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", name="builder_cognition_policy_pkey"),
        sa.CheckConstraint("revision > 0", name="builder_cognition_policy_revision"),
    )


def downgrade():
    op.drop_table("dify_builder_cognition_policies")

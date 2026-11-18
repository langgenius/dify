"""add durable account Tokener signup intents

Revision ID: a6d8e0f2b413
Revises: d4e5f6a7b8c9
"""

import sqlalchemy as sa
from alembic import op

import models

revision = "a6d8e0f2b413"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "account_tokener_signup_intents",
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("plugin_unique_identifier", sa.String(length=255), nullable=True),
        sa.Column("consumed_tenant_id", models.types.StringUUID(), nullable=True),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["consumed_tenant_id"], ["tenants.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("account_id", name="account_tokener_signup_intent_pkey"),
        sa.UniqueConstraint("consumed_tenant_id", name="account_tokener_signup_intent_tenant_key"),
        sa.CheckConstraint(
            "consumed_tenant_id IS NULL OR consumed_at IS NOT NULL",
            name="account_tokener_signup_intent_consumed_check",
        ),
    )


def downgrade():
    op.drop_table("account_tokener_signup_intents")

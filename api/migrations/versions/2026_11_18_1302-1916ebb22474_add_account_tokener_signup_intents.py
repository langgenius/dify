"""add durable account Tokener signup intents

Revision ID: 1916ebb22474
Revises: 3bb4ecc03baa
"""

import sqlalchemy as sa
from alembic import op

import models.types

revision = "1916ebb22474"
down_revision = "3bb4ecc03baa"
branch_labels = None
depends_on = None


def upgrade():
    """Create the signup schema, retaining the consumption CHECK where its SET NULL foreign key permits it."""
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
        # MySQL rejects CHECKs on an ON DELETE SET NULL foreign-key column
        # (error 3823). Its consumption owner writes both fields atomically.
        *(
            [
                sa.CheckConstraint(
                    "consumed_tenant_id IS NULL OR consumed_at IS NOT NULL",
                    name="account_tokener_signup_intent_consumed_check",
                )
            ]
            if op.get_context().dialect.name != "mysql"
            else []
        ),
    )


def downgrade():
    op.drop_table("account_tokener_signup_intents")

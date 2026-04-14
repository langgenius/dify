"""tool builtin provider credential access scope

Revision ID: a1b2c3d4e5f6
Revises: 6b5f9f8b1a2c
Create Date: 2026-04-13 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models as models

revision = "a1b2c3d4e5f6"
down_revision = "6b5f9f8b1a2c"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "tool_builtin_providers",
        sa.Column(
            "access_scope",
            sa.String(length=32),
            nullable=False,
            server_default="workspace",
        ),
    )
    op.create_table(
        "tool_builtin_provider_allowed_accounts",
        sa.Column("credential_id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.ForeignKeyConstraint(
            ["credential_id"],
            ["tool_builtin_providers.id"],
            name="tool_builtin_provider_allowed_accounts_credential_id_fkey",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("credential_id", "account_id", name="tool_builtin_provider_allowed_accounts_pkey"),
    )
    op.create_index(
        "tool_builtin_provider_allowed_accounts_account_id_idx",
        "tool_builtin_provider_allowed_accounts",
        ["account_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(
        "tool_builtin_provider_allowed_accounts_account_id_idx",
        table_name="tool_builtin_provider_allowed_accounts",
    )
    op.drop_table("tool_builtin_provider_allowed_accounts")
    op.drop_column("tool_builtin_providers", "access_scope")

"""Add the Human Input email provider configuration.

Revision ID: 8a1c4e7f9b2d
Revises: 6d9f2b4c5e7a
Create Date: 2026-07-25 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

import models

revision = "8a1c4e7f9b2d"
down_revision = "6d9f2b4c5e7a"
branch_labels = None
depends_on = None


def _default_fields(table_name: str) -> tuple[sa.Column, sa.Column, sa.Column, sa.PrimaryKeyConstraint]:
    return (
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=f"{table_name}_pkey"),
    )


def upgrade() -> None:
    op.create_table(
        "human_input_email_providers",
        sa.Column("provider", sa.String(length=20), nullable=False, comment="Configured email provider discriminator."),
        sa.Column("sender_email", sa.String(length=320), nullable=False, comment="Configured sender email address."),
        sa.Column(
            "encrypted_credentials",
            models.types.LongText(),
            nullable=False,
            comment="Encrypted Resend credential Pydantic model serialized as JSON text.",
        ),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("sender_name", sa.String(length=255), nullable=False, comment="Optional sender display name."),
        sa.Column(
            "configured_by_account_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to accounts.id for the latest configuration write.",
        ),
        *_default_fields("human_input_email_providers"),
        sa.UniqueConstraint("tenant_id", name="human_input_email_providers_tenant_uq"),
        comment="Workspace-level Human Input email delivery configuration.",
    )


def downgrade() -> None:
    op.drop_table("human_input_email_providers")

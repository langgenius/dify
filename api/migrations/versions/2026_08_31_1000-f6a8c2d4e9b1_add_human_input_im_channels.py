"""Add Human Input v2 IM Channels.

Revision ID: f6a8c2d4e9b1
Revises: e5f7a9b2c4d6
Create Date: 2026-08-31 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision: str = "f6a8c2d4e9b1"
down_revision: str | None = "e5f7a9b2c4d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE_NAME = "human_input_im_channels"


def upgrade() -> None:
    op.create_table(
        _TABLE_NAME,
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column(
            "owner_key",
            sa.String(length=50),
            nullable=False,
            comment="Canonical owner slot: workspace:<tenant_id> or deployment.",
        ),
        sa.Column(
            "provider",
            sa.String(length=20),
            nullable=False,
            comment="Configured IM provider discriminator.",
        ),
        sa.Column(
            "provider_tenant_id",
            sa.String(length=255),
            nullable=False,
            comment="Confirmed provider-side organization, tenant, or workspace identifier.",
        ),
        sa.Column(
            "encrypted_credentials",
            LongText(),
            nullable=False,
            comment="Versioned opaque encrypted IM Channel credential envelope.",
        ),
        sa.Column(
            "app_identifier",
            sa.String(length=255),
            nullable=False,
            comment="Safe provider application identifier used by credential-free projections.",
        ),
        sa.Column(
            "webhook_id",
            sa.String(length=32),
            nullable=False,
            comment="Server-generated globally unique route ID used to derive webhook URLs.",
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            comment="Stored credential-safe Channel status snapshot.",
        ),
        sa.Column(
            "config_version",
            sa.Integer(),
            nullable=False,
            comment="Monotonic numeric version paired with the Channel ID for CAS.",
        ),
        sa.Column(
            "configured_by_account_id",
            StringUUID(),
            nullable=True,
            comment="Latest configuring Dify Account; null for deployment-owned writes.",
        ),
        sa.Column(
            "status_reason",
            LongText(),
            nullable=True,
            comment="Operator-safe status explanation without provider payload or credentials.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="human_input_im_channels_pkey"),
        sa.UniqueConstraint("owner_key", name="human_input_im_channels_owner_key_uq"),
        sa.UniqueConstraint("webhook_id", name="human_input_im_channels_webhook_id_uq"),
        sa.CheckConstraint(
            "config_version > 0",
            name="human_input_im_channels_config_version_positive_ck",
        ),
        comment=(
            "Current owner-scoped Human Input IM Channel configuration. "
            "Directory, Binding, Sync, and inbox records remain separately owned."
        ),
    )


def downgrade() -> None:
    op.drop_table(_TABLE_NAME)

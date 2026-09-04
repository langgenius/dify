"""Add the durable IM message inbox.

Revision ID: f1a2b3c4d5e6
Revises: 8a1c4e7f9b2d
Create Date: 2026-08-02 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import models.types

revision: str = "f1a2b3c4d5e6"
down_revision: str | None = "8a1c4e7f9b2d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PROVIDER_METADATA_MAX_LENGTH = 128


def upgrade() -> None:
    op.create_table(
        "im_message_inbox",
        sa.Column("integration_id", models.types.StringUUID(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column(
            "provider_tenant_id",
            sa.String(length=_PROVIDER_METADATA_MAX_LENGTH),
            nullable=False,
        ),
        sa.Column(
            "provider_event_id",
            sa.String(length=_PROVIDER_METADATA_MAX_LENGTH),
            nullable=True,
        ),
        sa.Column("provider_event_time", sa.DateTime(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.Column("provider_event_type", sa.String(length=_PROVIDER_METADATA_MAX_LENGTH), nullable=True),
        sa.Column("raw_payload", models.types.LongText(), nullable=False),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="im_message_inbox_pkey"),
        sa.UniqueConstraint(
            "provider", "provider_tenant_id", "provider_event_id", name="im_message_inbox_provider_event_uq"
        ),
        comment="Durable authenticated IM callback records.",
    )


def downgrade() -> None:
    op.drop_table("im_message_inbox")

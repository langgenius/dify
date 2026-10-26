"""Rename durable IM callbacks and deduplicate by provider and event ID.

Revision ID: f4a6c8e0b2d5
Revises: f7a9c4e2d681, b9e3f5a7c1d4
Create Date: 2026-10-26 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4a6c8e0b2d5"
down_revision: tuple[str, str] = ("f7a9c4e2d681", "b9e3f5a7c1d4")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PROVIDER_METADATA_MAX_LENGTH = 128


def upgrade() -> None:
    with op.batch_alter_table("im_message_inbox") as batch_op:
        # Establish the narrower identity before changing the old schema. If
        # historical events conflict, fail rather than discard callback facts.
        batch_op.create_unique_constraint("im_message_event_provider_event_uq", ["provider", "provider_event_id"])
        batch_op.drop_constraint("im_message_inbox_provider_event_uq", type_="unique")
        batch_op.alter_column(
            "provider_tenant_id",
            new_column_name="tenant_id",
            existing_type=sa.String(_PROVIDER_METADATA_MAX_LENGTH),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "provider_event_id",
            new_column_name="event_id",
            existing_type=sa.String(_PROVIDER_METADATA_MAX_LENGTH),
            existing_nullable=True,
        )
    op.rename_table("im_message_inbox", "im_message_event")


def downgrade() -> None:
    with op.batch_alter_table("im_message_event") as batch_op:
        batch_op.create_unique_constraint("im_message_inbox_provider_event_uq", ["provider", "tenant_id", "event_id"])
        batch_op.drop_constraint("im_message_event_provider_event_uq", type_="unique")
        batch_op.alter_column(
            "tenant_id",
            new_column_name="provider_tenant_id",
            existing_type=sa.String(_PROVIDER_METADATA_MAX_LENGTH),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "event_id",
            new_column_name="provider_event_id",
            existing_type=sa.String(_PROVIDER_METADATA_MAX_LENGTH),
            existing_nullable=True,
        )
    op.rename_table("im_message_event", "im_message_inbox")

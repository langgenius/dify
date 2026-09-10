"""Add Human Input v2 forms with persisted outcomes.

Revision ID: a7c9e1f3b5d8
Revises: f6a8c2d4e9b1
Create Date: 2026-09-09 12:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision: str = "a7c9e1f3b5d8"
down_revision: str | None = "f6a8c2d4e9b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hitlv2_forms",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_run_id", StringUUID(), nullable=True),
        sa.Column("node_execution_id", StringUUID(), nullable=True),
        sa.Column("form_kind", sa.String(20), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="waiting",
            comment="Persisted form outcome; terminal states are not recomputed from deadlines.",
        ),
        sa.Column("expiration_time", sa.DateTime(), nullable=False),
        sa.Column("global_timeout_deadline", sa.DateTime(), nullable=False),
        sa.Column("resolved_form", LongText(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("submitted_by_recipient_id", StringUUID(), nullable=True),
        sa.Column("selected_action_id", sa.String(200), nullable=True),
        sa.Column("raw_submission_inputs", sa.Text(), nullable=True),
        sa.Column("normalized_submission_data", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="hitlv2_forms_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "app_id",
            "workflow_run_id",
            "node_execution_id",
            name="hitlv2_forms_execution_uq",
        ),
    )


def downgrade() -> None:
    op.drop_table("hitlv2_forms")

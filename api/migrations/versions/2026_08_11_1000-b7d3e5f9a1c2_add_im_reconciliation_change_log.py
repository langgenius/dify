"""Add append-only IM reconciliation change history.

Revision ID: b7d3e5f9a1c2
Revises: f1a2b3c4d5e6
Create Date: 2026-08-11 10:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

import models.types

revision: str = "b7d3e5f9a1c2"
down_revision: str | None = "f1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("human_input_im_sync_results") as batch_op:
        batch_op.add_column(
            sa.Column(
                "operation_key",
                sa.String(length=255),
                nullable=True,
                comment="Deterministic run-local idempotency key; null only for historical results.",
            )
        )
        batch_op.create_unique_constraint(
            "human_input_im_sync_results_run_operation_uq",
            ["sync_run_id", "operation_key"],
        )

    op.create_table(
        "human_input_im_reconciliation_changes",
        sa.Column(
            "integration_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_im_integrations.id.",
        ),
        sa.Column(
            "sync_run_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_im_sync_runs.id.",
        ),
        sa.Column(
            "operation_key",
            sa.String(length=255),
            nullable=False,
            comment="Deterministic run-local idempotency key.",
        ),
        sa.Column("subject_kind", sa.String(length=20), nullable=False),
        sa.Column("operation", sa.String(length=20), nullable=False),
        sa.Column("reason_code", sa.String(length=100), nullable=False),
        sa.Column("im_identity_id", models.types.StringUUID(), nullable=False),
        sa.Column("committed_at", sa.DateTime(), nullable=False),
        sa.Column("im_binding_id", models.types.StringUUID(), nullable=True),
        sa.Column("contact_id", models.types.StringUUID(), nullable=True),
        sa.Column("before_snapshot", sa.Text(), nullable=True),
        sa.Column("after_snapshot", sa.Text(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_im_reconciliation_changes_pkey"),
        sa.UniqueConstraint(
            "sync_run_id",
            "operation_key",
            name="human_input_im_reconciliation_changes_run_operation_uq",
        ),
        sa.CheckConstraint(
            "before_snapshot IS NOT NULL OR after_snapshot IS NOT NULL",
            name="snapshot_present",
        ),
        sa.CheckConstraint(
            "(operation = 'create' AND before_snapshot IS NULL AND after_snapshot IS NOT NULL) OR "
            "(operation = 'delete' AND before_snapshot IS NOT NULL AND after_snapshot IS NULL) OR "
            "(operation NOT IN ('create', 'delete') AND before_snapshot IS NOT NULL AND after_snapshot IS NOT NULL)",
            name="snapshot_operation_shape",
        ),
        sa.CheckConstraint(
            "(subject_kind = 'identity' AND im_binding_id IS NULL) OR "
            "(subject_kind = 'binding' AND im_binding_id IS NOT NULL)",
            name="subject_identifier_shape",
        ),
        comment="Append-only IM identity and IM binding reconciliation mutation history.",
    )
    op.create_index(
        "hiimrc_run_subject_committed_idx",
        "human_input_im_reconciliation_changes",
        ["sync_run_id", "subject_kind", "committed_at", "id"],
    )
    op.create_index(
        "hiimrc_integration_committed_idx",
        "human_input_im_reconciliation_changes",
        ["integration_id", "committed_at", "id"],
    )


def downgrade() -> None:
    op.drop_table("human_input_im_reconciliation_changes")
    with op.batch_alter_table("human_input_im_sync_results") as batch_op:
        batch_op.drop_constraint("human_input_im_sync_results_run_operation_uq", type_="unique")
        batch_op.drop_column("operation_key")

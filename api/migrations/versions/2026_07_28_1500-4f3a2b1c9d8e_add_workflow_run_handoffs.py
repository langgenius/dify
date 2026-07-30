"""add workflow run handoffs

Revision ID: 4f3a2b1c9d8e
Revises: e4708db55c1d
Create Date: 2026-07-28 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "4f3a2b1c9d8e"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("handoff_duration", sa.Float(), server_default=sa.text("0"), nullable=False))

    with op.batch_alter_table("workflow_archive_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("run_handoff_duration", sa.Float(), server_default=sa.text("0"), nullable=False))

    op.create_table(
        "workflow_run_handoffs",
        sa.Column("workflow_run_id", models.types.StringUUID(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.String(length=255), nullable=False),
        sa.Column("snapshot_object_key", sa.String(length=255), nullable=False),
        sa.Column("snapshot_schema_version", sa.String(length=64), nullable=False),
        sa.Column("snapshot_checksum", sa.String(length=128), nullable=False),
        sa.Column("snapshot_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("resume_route", sa.String(length=64), nullable=False),
        sa.Column("source_worker_id", sa.String(length=255), nullable=False),
        sa.Column("rag_source_batch_id", sa.String(length=255), nullable=True),
        sa.Column("rag_tenant_id", models.types.StringUUID(), nullable=True),
        sa.Column("rag_queue_kind", sa.String(length=32), nullable=True),
        sa.Column("rag_dataset_id", models.types.StringUUID(), nullable=True),
        sa.Column("rag_document_id", models.types.StringUUID(), nullable=True),
        sa.Column("rag_tenant_isolated", sa.Boolean(), nullable=True),
        sa.Column("rag_group_sealed_at", sa.DateTime(), nullable=True),
        sa.Column("rag_tenant_slot_released_at", sa.DateTime(), nullable=True),
        sa.Column("rag_document_error_marked_at", sa.DateTime(), nullable=True),
        sa.Column("state", sa.String(length=32), server_default=sa.text("'prepared'"), nullable=False),
        sa.Column("target_worker_id", sa.String(length=255), nullable=True),
        sa.Column("lease_owner", sa.String(length=255), nullable=True),
        sa.Column("lease_token", models.types.StringUUID(), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", models.types.LongText(), nullable=True),
        sa.Column("cancel_requested_at", sa.DateTime(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("resumed_at", sa.DateTime(), nullable=True),
        sa.Column("failed_at", sa.DateTime(), nullable=True),
        sa.Column("terminal_compensated_at", sa.DateTime(), nullable=True),
        sa.Column("terminal_event_published_at", sa.DateTime(), nullable=True),
        sa.Column("terminal_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("terminal_last_error", models.types.LongText(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "attempts >= 0",
            name=op.f("workflow_run_handoffs_attempts_nonnegative_check"),
        ),
        sa.CheckConstraint(
            "terminal_attempts >= 0",
            name=op.f("workflow_run_handoffs_terminal_attempts_nonnegative_check"),
        ),
        sa.CheckConstraint(
            "state <> 'claimed' OR "
            "(lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
            name=op.f("workflow_run_handoffs_claim_lease_present_check"),
        ),
        sa.CheckConstraint(
            "state <> 'failed' OR failed_at IS NOT NULL",
            name=op.f("workflow_run_handoffs_failed_at_present_check"),
        ),
        sa.CheckConstraint(
            "generation > 0",
            name=op.f("workflow_run_handoffs_generation_positive_check"),
        ),
        sa.CheckConstraint(
            "(rag_source_batch_id IS NULL AND rag_tenant_id IS NULL AND rag_queue_kind IS NULL "
            "AND rag_dataset_id IS NULL AND rag_tenant_isolated IS NULL) OR "
            "(rag_source_batch_id IS NOT NULL AND rag_tenant_id IS NOT NULL AND rag_queue_kind IS NOT NULL "
            "AND rag_dataset_id IS NOT NULL AND rag_tenant_isolated IS NOT NULL)",
            name=op.f("workflow_run_handoffs_rag_group_metadata_complete_check"),
        ),
        sa.CheckConstraint(
            "rag_queue_kind IS NULL OR rag_queue_kind IN ('regular', 'priority')",
            name=op.f("workflow_run_handoffs_rag_queue_kind_valid_check"),
        ),
        sa.CheckConstraint(
            "rag_tenant_slot_released_at IS NULL OR rag_group_sealed_at IS NOT NULL",
            name=op.f("workflow_run_handoffs_rag_release_requires_seal_check"),
        ),
        sa.CheckConstraint(
            "resume_route IN ('workflow', 'snippet', 'advanced_chat', 'triggered_workflow', 'rag_pipeline')",
            name=op.f("workflow_run_handoffs_resume_route_valid_check"),
        ),
        sa.CheckConstraint(
            "state <> 'resumed' OR resumed_at IS NOT NULL",
            name=op.f("workflow_run_handoffs_resumed_at_present_check"),
        ),
        sa.CheckConstraint(
            "snapshot_size_bytes >= 0",
            name=op.f("workflow_run_handoffs_snapshot_size_nonnegative_check"),
        ),
        sa.CheckConstraint(
            "state IN ('preparing', 'prepared', 'ready', 'claimed', 'resumed', 'failed')",
            name=op.f("workflow_run_handoffs_state_valid_check"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_run_handoffs_pkey")),
        sa.UniqueConstraint(
            "workflow_run_id",
            "generation",
            name="workflow_run_handoffs_run_generation_key",
        ),
    )
    with op.batch_alter_table("workflow_run_handoffs", schema=None) as batch_op:
        batch_op.create_index(
            "workflow_run_handoffs_rag_reconcile_idx",
            ["rag_group_sealed_at", "rag_tenant_slot_released_at", "rag_source_batch_id"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_rag_group_release_idx",
            [
                "rag_source_batch_id",
                "rag_tenant_id",
                "rag_queue_kind",
                "rag_group_sealed_at",
                "rag_tenant_slot_released_at",
            ],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_dispatch_idx",
            ["state", "next_retry_at", "lease_expires_at", "dispatched_at", "created_at"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_run_state_idx",
            ["workflow_run_id", "state"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_snapshot_object_key_idx",
            ["snapshot_object_key"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_state_created_idx",
            ["state", "created_at", "id"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_resumed_retention_idx",
            ["state", "resumed_at", "id"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_failed_retention_idx",
            ["state", "failed_at", "id"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_task_state_idx",
            ["task_id", "state"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_run_handoffs_terminal_idx",
            ["state", "terminal_compensated_at", "terminal_event_published_at", "created_at"],
            unique=False,
        )

    op.create_table(
        "workflow_handoff_cancellations",
        sa.Column("task_id", sa.String(length=255), nullable=False),
        sa.Column("scope_tenant_id", models.types.StringUUID(), nullable=True),
        sa.Column("scope_app_id", models.types.StringUUID(), nullable=True),
        sa.Column("scope_created_by_role", sa.String(length=255), nullable=True),
        sa.Column("scope_created_by", models.types.StringUUID(), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("reason", models.types.LongText(), nullable=False),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "(scope_tenant_id IS NULL AND scope_app_id IS NULL) OR "
            "(scope_tenant_id IS NOT NULL AND scope_app_id IS NOT NULL)",
            name=op.f("workflow_handoff_cancellations_owner_scope_pair_check"),
        ),
        sa.CheckConstraint(
            "(scope_created_by_role IS NULL AND scope_created_by IS NULL) OR "
            "(scope_created_by_role IS NOT NULL AND scope_created_by IS NOT NULL)",
            name=op.f("workflow_handoff_cancellations_creator_scope_pair_check"),
        ),
        sa.CheckConstraint(
            "scope_created_by IS NULL OR (scope_tenant_id IS NOT NULL AND scope_app_id IS NOT NULL)",
            name=op.f("workflow_handoff_cancellations_creator_scope_app_check"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_handoff_cancellations_pkey")),
    )
    with op.batch_alter_table("workflow_handoff_cancellations", schema=None) as batch_op:
        batch_op.create_index(
            "workflow_handoff_cancellations_expires_idx",
            ["expires_at"],
            unique=False,
        )
        batch_op.create_index(
            "workflow_handoff_cancellations_task_scope_idx",
            [
                "task_id",
                "scope_tenant_id",
                "scope_app_id",
                "scope_created_by_role",
                "scope_created_by",
                "expires_at",
            ],
            unique=False,
        )

    op.create_table(
        "workflow_handoff_snapshot_gc",
        sa.Column("snapshot_object_key", sa.String(length=255), nullable=False),
        sa.Column("upload_completed_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", models.types.LongText(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "attempts >= 0",
            name=op.f("workflow_handoff_snapshot_gc_attempts_nonnegative_check"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_handoff_snapshot_gc_pkey")),
        sa.UniqueConstraint(
            "snapshot_object_key",
            name="workflow_handoff_snapshot_gc_object_key_key",
        ),
    )
    with op.batch_alter_table("workflow_handoff_snapshot_gc", schema=None) as batch_op:
        batch_op.create_index(
            "workflow_handoff_snapshot_gc_pending_idx",
            ["deleted_at", "next_retry_at", "created_at"],
            unique=False,
        )


def downgrade():
    op.drop_table("workflow_handoff_snapshot_gc")
    op.drop_table("workflow_handoff_cancellations")
    op.drop_table("workflow_run_handoffs")
    with op.batch_alter_table("workflow_archive_logs", schema=None) as batch_op:
        batch_op.drop_column("run_handoff_duration")
    with op.batch_alter_table("workflow_runs", schema=None) as batch_op:
        batch_op.drop_column("handoff_duration")

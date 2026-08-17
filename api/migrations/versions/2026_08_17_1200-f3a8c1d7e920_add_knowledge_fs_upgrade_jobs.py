"""add KnowledgeFS legacy Dataset upgrade jobs

Revision ID: f3a8c1d7e920
Revises: 4f8b2c7d9e10
Create Date: 2026-08-17 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

revision = "f3a8c1d7e920"
down_revision = "4f8b2c7d9e10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "knowledge_fs_upgrade_jobs",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("old_dataset_id", models.types.StringUUID(), nullable=False),
        sa.Column("requested_by_account_id", models.types.StringUUID(), nullable=False),
        sa.Column("owner_account_id", models.types.StringUUID(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("snapshot_at", sa.DateTime(), nullable=False),
        sa.Column("config_snapshot", sa.JSON(), nullable=False),
        sa.Column("permission_snapshot", sa.JSON(), nullable=False),
        sa.Column("app_binding_snapshot", sa.JSON(), nullable=False),
        sa.Column("tag_ids_snapshot", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'queued'"), nullable=False),
        sa.Column("stage", sa.String(length=32), server_default=sa.text("'validating'"), nullable=False),
        sa.Column("new_control_space_id", models.types.StringUUID(), nullable=True),
        sa.Column("resolved_configuration", sa.JSON(), nullable=True),
        sa.Column("total_documents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("completed_documents", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("total_sources", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("completed_sources", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("celery_task_id", sa.String(length=255), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", models.types.LongText(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint("attempt_count >= 0", name="kfs_upgrade_job_attempt_count_ck"),
        sa.CheckConstraint("completed_documents >= 0", name="kfs_upgrade_job_document_done_ck"),
        sa.CheckConstraint("total_documents >= 0", name="kfs_upgrade_job_document_total_ck"),
        sa.CheckConstraint("completed_sources >= 0", name="kfs_upgrade_job_source_done_ck"),
        sa.CheckConstraint("total_sources >= 0", name="kfs_upgrade_job_source_total_ck"),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenants.id"], name="kfs_upgrade_job_workspace_fk", ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "new_control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_upgrade_job_space_fk",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="kfs_upgrade_job_pkey"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="kfs_upgrade_job_idempotency_uq"),
    )
    op.create_index(
        "kfs_upgrade_job_dataset_created_idx",
        "knowledge_fs_upgrade_jobs",
        ["tenant_id", "old_dataset_id", "created_at"],
    )
    op.create_index("kfs_upgrade_job_status_updated_idx", "knowledge_fs_upgrade_jobs", ["status", "updated_at"])

    op.create_table(
        "knowledge_fs_upgrade_documents",
        sa.Column("job_id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("old_document_id", models.types.StringUUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("data_source_type", sa.String(length=32), nullable=False),
        sa.Column("data_source_info", sa.JSON(), nullable=False),
        sa.Column("metadata_snapshot", sa.JSON(), nullable=False),
        sa.Column("desired_enabled", sa.Boolean(), nullable=False),
        sa.Column("legacy_archived", sa.Boolean(), nullable=False),
        sa.Column("legacy_indexing_status", sa.String(length=32), nullable=False),
        sa.Column("legacy_display_status", sa.String(length=32), nullable=True),
        sa.Column("old_upload_file_id", models.types.StringUUID(), nullable=True),
        sa.Column("source_key", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("staged_upload_id", models.types.StringUUID(), nullable=True),
        sa.Column("new_document_asset_id", models.types.StringUUID(), nullable=True),
        sa.Column("new_logical_document_id", models.types.StringUUID(), nullable=True),
        sa.Column("compilation_job_id", models.types.StringUUID(), nullable=True),
        sa.Column("state_reconcile_attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("state_reconciled_at", sa.DateTime(), nullable=True),
        sa.Column("state_reconcile_error", models.types.LongText(), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", models.types.LongText(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "state_reconcile_attempt_count >= 0",
            name="kfs_upgrade_document_reconcile_attempt_ck",
        ),
        sa.ForeignKeyConstraint(
            ["job_id"], ["knowledge_fs_upgrade_jobs.id"], name="kfs_upgrade_document_job_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="kfs_upgrade_document_pkey"),
        sa.UniqueConstraint("job_id", "old_document_id", name="kfs_upgrade_document_identity_uq"),
    )
    op.create_index("kfs_upgrade_document_dispatch_idx", "knowledge_fs_upgrade_documents", ["job_id", "status", "id"])

    op.create_table(
        "knowledge_fs_upgrade_sources",
        sa.Column("job_id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("source_key", sa.String(length=255), nullable=False),
        sa.Column("payload_snapshot", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("new_connection_id", models.types.StringUUID(), nullable=True),
        sa.Column("new_source_id", models.types.StringUUID(), nullable=True),
        sa.Column("initial_sync_task_id", models.types.StringUUID(), nullable=True),
        sa.Column("last_error_code", sa.String(length=128), nullable=True),
        sa.Column("last_error_message", models.types.LongText(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id"], ["knowledge_fs_upgrade_jobs.id"], name="kfs_upgrade_source_job_fk", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="kfs_upgrade_source_pkey"),
        sa.UniqueConstraint("job_id", "source_key", name="kfs_upgrade_source_identity_uq"),
    )
    op.create_index("kfs_upgrade_source_dispatch_idx", "knowledge_fs_upgrade_sources", ["job_id", "status", "id"])

    op.create_table(
        "knowledge_fs_upgrade_file_leases",
        sa.Column("job_id", models.types.StringUUID(), nullable=False),
        sa.Column("old_upload_file_id", models.types.StringUUID(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'active'"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.Column("cleanup_requested_at", sa.DateTime(), nullable=True),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(
            ["job_id"],
            ["knowledge_fs_upgrade_jobs.id"],
            name="kfs_upgrade_file_lease_job_fk",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="kfs_upgrade_file_lease_pkey"),
        sa.UniqueConstraint("job_id", "old_upload_file_id", name="kfs_upgrade_file_lease_identity_uq"),
    )
    op.create_index(
        "kfs_upgrade_file_lease_active_idx",
        "knowledge_fs_upgrade_file_leases",
        ["old_upload_file_id", "status", "expires_at"],
    )


def downgrade() -> None:
    op.drop_index("kfs_upgrade_file_lease_active_idx", table_name="knowledge_fs_upgrade_file_leases")
    op.drop_table("knowledge_fs_upgrade_file_leases")
    op.drop_index("kfs_upgrade_source_dispatch_idx", table_name="knowledge_fs_upgrade_sources")
    op.drop_table("knowledge_fs_upgrade_sources")
    op.drop_index("kfs_upgrade_document_dispatch_idx", table_name="knowledge_fs_upgrade_documents")
    op.drop_table("knowledge_fs_upgrade_documents")
    op.drop_index("kfs_upgrade_job_status_updated_idx", table_name="knowledge_fs_upgrade_jobs")
    op.drop_index("kfs_upgrade_job_dataset_created_idx", table_name="knowledge_fs_upgrade_jobs")
    op.drop_table("knowledge_fs_upgrade_jobs")

"""add KnowledgeFS workspace cutover ledger and migration evidence

Revision ID: b7f2a9d41c60
Revises: a4e7c2f91b30
Create Date: 2026-07-21 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "b7f2a9d41c60"
down_revision = "a4e7c2f91b30"
branch_labels = None
depends_on = None


def _uuid_column(name: str, **kwargs):
    if op.get_bind().dialect.name == "postgresql":
        kwargs.setdefault("server_default", sa.text("uuidv7()"))
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def _timestamps() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )


def upgrade() -> None:
    op.create_table(
        "knowledge_fs_workspace_cutover_ledgers",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("phase", sa.String(length=32), server_default=sa.text("'inventory'"), nullable=False),
        sa.Column("source_revision_watermark", sa.JSON(), nullable=False),
        sa.Column("final_revision_watermark", sa.JSON(), nullable=True),
        sa.Column("applied_revision_watermark", sa.JSON(), nullable=False),
        sa.Column("source_task_watermark", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("final_task_watermark", sa.BigInteger(), nullable=True),
        sa.Column("applied_task_watermark", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("freeze_at", sa.DateTime(), nullable=True),
        sa.Column("cutover_at", sa.DateTime(), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(), nullable=True),
        sa.Column("rollback_cutoff_at", sa.DateTime(), nullable=True),
        sa.Column("observation_started_at", sa.DateTime(), nullable=True),
        sa.Column("observation_window_ends_at", sa.DateTime(), nullable=True),
        sa.Column("observation_completed_at", sa.DateTime(), nullable=True),
        sa.Column("maximum_task_expires_at", sa.DateTime(), nullable=True),
        sa.Column("irreversible_cleanup_at", sa.DateTime(), nullable=True),
        sa.Column("product_routes_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("capability_v2_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("integrated_mode_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("legacy_acl_read_only", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("smoke_results", sa.JSON(), nullable=True),
        sa.Column("legacy_dependency_report", sa.JSON(), nullable=True),
        sa.Column("legacy_dependency_checked_at", sa.DateTime(), nullable=True),
        sa.Column("legacy_dependency_ready", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("cas_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_workspace_cutover_ledger_pkey"),
        sa.UniqueConstraint("tenant_id", name="kfs_workspace_cutover_ledger_tenant_uq"),
        sa.UniqueConstraint("tenant_id", "id", name="kfs_workspace_cutover_ledger_tenant_id_uq"),
        sa.CheckConstraint("cas_version >= 0", name="kfs_workspace_cutover_cas_version_ck"),
        sa.CheckConstraint(
            "source_task_watermark >= 0 AND applied_task_watermark >= 0 "
            "AND (final_task_watermark IS NULL OR final_task_watermark >= 0)",
            name="kfs_workspace_cutover_task_watermark_ck",
        ),
        sa.CheckConstraint(
            "cutover_at IS NULL OR freeze_at IS NOT NULL",
            name="kfs_workspace_cutover_freeze_before_cutover_ck",
        ),
        sa.CheckConstraint(
            "rollback_cutoff_at IS NULL OR cutover_at IS NOT NULL",
            name="kfs_workspace_cutover_rollback_cutoff_ck",
        ),
    )
    op.create_index(
        "kfs_workspace_cutover_ledger_phase_updated_idx",
        "knowledge_fs_workspace_cutover_ledgers",
        ["phase", "updated_at"],
    )

    op.create_table(
        "knowledge_fs_migration_issues",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("ledger_id", models.types.StringUUID(), nullable=False),
        sa.Column("issue_key", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=48), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'open'"), nullable=False),
        sa.Column("resource_type", sa.String(length=64), nullable=True),
        sa.Column("resource_id", sa.String(length=255), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("approved_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_migration_issue_pkey"),
        sa.UniqueConstraint("tenant_id", "ledger_id", "issue_key", name="kfs_migration_issue_key_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_migration_issue_ledger_fk",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "kfs_migration_issue_gate_idx",
        "knowledge_fs_migration_issues",
        ["tenant_id", "ledger_id", "status", "kind"],
    )

    op.create_table(
        "knowledge_fs_migration_quarantine",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("ledger_id", models.types.StringUUID(), nullable=False),
        sa.Column("source_kind", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=255), nullable=False),
        sa.Column("reason_code", sa.String(length=64), nullable=False),
        sa.Column("disposition", sa.String(length=32), nullable=False),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_migration_quarantine_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "ledger_id",
            "source_kind",
            "source_id",
            name="kfs_migration_quarantine_source_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_migration_quarantine_ledger_fk",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "kfs_migration_quarantine_disposition_idx",
        "knowledge_fs_migration_quarantine",
        ["tenant_id", "ledger_id", "disposition"],
    )

    op.create_table(
        "knowledge_fs_shadow_authorization_diffs",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("ledger_id", models.types.StringUUID(), nullable=False),
        sa.Column("diff_key", sa.String(length=255), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=True),
        sa.Column("principal", sa.String(length=255), nullable=False),
        sa.Column("legacy_allowed", sa.Boolean(), nullable=True),
        sa.Column("dify_allowed", sa.Boolean(), nullable=False),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("reason", models.types.LongText(), nullable=False),
        sa.Column("observed_revision", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("approved_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_shadow_authorization_diff_pkey"),
        sa.UniqueConstraint("tenant_id", "ledger_id", "diff_key", name="kfs_shadow_authorization_diff_key_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_shadow_authorization_diff_ledger_fk",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "kfs_shadow_authorization_diff_gate_idx",
        "knowledge_fs_shadow_authorization_diffs",
        ["tenant_id", "ledger_id", "status", "decision"],
    )


def downgrade() -> None:
    op.drop_index(
        "kfs_shadow_authorization_diff_gate_idx",
        table_name="knowledge_fs_shadow_authorization_diffs",
    )
    op.drop_table("knowledge_fs_shadow_authorization_diffs")
    op.drop_index(
        "kfs_migration_quarantine_disposition_idx",
        table_name="knowledge_fs_migration_quarantine",
    )
    op.drop_table("knowledge_fs_migration_quarantine")
    op.drop_index("kfs_migration_issue_gate_idx", table_name="knowledge_fs_migration_issues")
    op.drop_table("knowledge_fs_migration_issues")
    op.drop_index(
        "kfs_workspace_cutover_ledger_phase_updated_idx",
        table_name="knowledge_fs_workspace_cutover_ledgers",
    )
    op.drop_table("knowledge_fs_workspace_cutover_ledgers")

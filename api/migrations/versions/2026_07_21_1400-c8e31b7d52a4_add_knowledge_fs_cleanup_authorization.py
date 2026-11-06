"""add guarded cleanup, cutover evidence, and capability issuance reservations

Revision ID: c8e31b7d52a4
Revises: b7f2a9d41c60
Create Date: 2026-07-21 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "c8e31b7d52a4"
down_revision = "b7f2a9d41c60"
branch_labels = None
depends_on = None


def _uuid_column(name: str, **kwargs):
    if op.get_bind().dialect.name == "postgresql":
        kwargs.setdefault("server_default", sa.text("uuidv7()"))
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def upgrade() -> None:
    op.create_table(
        "knowledge_fs_cleanup_authorizations",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("ledger_id", models.types.StringUUID(), nullable=False),
        sa.Column("request_id", models.types.StringUUID(), nullable=False),
        sa.Column("plan_schema_version", sa.String(length=32), nullable=False),
        sa.Column("plan_digest", sa.String(length=71), nullable=False),
        sa.Column("targets", sa.JSON(), nullable=False),
        sa.Column("readiness_evidence", sa.JSON(), nullable=False),
        sa.Column("requested_by_account_id", models.types.StringUUID(), nullable=False),
        sa.Column("requested_at", sa.DateTime(), nullable=False),
        sa.Column("readiness_ledger_cas_version", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'requested'"), nullable=False),
        sa.Column("approved_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("approval_expires_at", sa.DateTime(), nullable=True),
        sa.Column("approved_ledger_cas_version", sa.BigInteger(), nullable=True),
        sa.Column("started_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("started_ledger_cas_version", sa.BigInteger(), nullable=True),
        sa.Column("row_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="kfs_cleanup_authorization_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "ledger_id",
            "request_id",
            name="kfs_cleanup_authorization_request_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_cleanup_authorization_ledger_fk",
        ),
        sa.CheckConstraint("row_version >= 0", name="kfs_cleanup_authorization_version_ck"),
        sa.CheckConstraint(
            "readiness_ledger_cas_version >= 0 "
            "AND (approved_ledger_cas_version IS NULL OR approved_ledger_cas_version >= 0) "
            "AND (started_ledger_cas_version IS NULL OR started_ledger_cas_version >= 0)",
            name="kfs_cleanup_authorization_ledger_versions_ck",
        ),
        sa.CheckConstraint(
            "(status = 'requested' "
            "AND approved_by_account_id IS NULL AND approved_at IS NULL "
            "AND approval_expires_at IS NULL AND approved_ledger_cas_version IS NULL "
            "AND started_by_account_id IS NULL AND started_at IS NULL "
            "AND started_ledger_cas_version IS NULL) OR "
            "(status = 'approved' "
            "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
            "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
            "AND started_by_account_id IS NULL AND started_at IS NULL "
            "AND started_ledger_cas_version IS NULL) OR "
            "(status = 'started' "
            "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
            "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
            "AND started_by_account_id IS NOT NULL AND started_at IS NOT NULL "
            "AND started_ledger_cas_version IS NOT NULL)",
            name="kfs_cleanup_authorization_status_fields_ck",
        ),
        sa.CheckConstraint(
            "approval_expires_at IS NULL OR approval_expires_at > approved_at",
            name="kfs_cleanup_authorization_approval_window_ck",
        ),
    )
    op.create_index(
        "kfs_cleanup_authorization_status_idx",
        "knowledge_fs_cleanup_authorizations",
        ["tenant_id", "status", "updated_at"],
    )
    op.create_table(
        "knowledge_fs_capability_issuance_reservations",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("grant_id", models.types.StringUUID(), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("caller_kind", sa.String(length=32), nullable=False),
        sa.Column("request_summary", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default=sa.text("'reserved'"), nullable=False),
        sa.Column("issued_at", sa.DateTime(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(), nullable=True),
        sa.Column("failed_at", sa.DateTime(), nullable=True),
        sa.Column("failure_code", sa.String(length=128), nullable=True),
        sa.Column("cleanup_after", sa.DateTime(), nullable=True),
        sa.Column("row_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="kfs_capability_issuance_reservation_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "grant_id",
            name="kfs_capability_issuance_reservation_grant_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_capability_issuance_reservation_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "row_version >= 0",
            name="kfs_capability_issuance_reservation_version_ck",
        ),
        sa.CheckConstraint(
            "(status = 'reserved' AND issued_at IS NULL AND token_expires_at IS NULL "
            "AND failed_at IS NULL AND failure_code IS NULL AND cleanup_after IS NULL) OR "
            "(status = 'issued' AND issued_at IS NOT NULL AND token_expires_at IS NOT NULL "
            "AND failed_at IS NULL AND failure_code IS NULL AND cleanup_after IS NOT NULL) OR "
            "(status = 'failed' AND issued_at IS NULL AND token_expires_at IS NULL "
            "AND failed_at IS NOT NULL AND failure_code IS NOT NULL AND cleanup_after IS NOT NULL)",
            name="kfs_capability_issuance_reservation_status_fields_ck",
        ),
        sa.CheckConstraint(
            "token_expires_at IS NULL OR cleanup_after >= token_expires_at",
            name="kfs_capability_issuance_reservation_cleanup_window_ck",
        ),
    )
    op.create_index(
        "kfs_capability_issuance_reservation_subject_idx",
        "knowledge_fs_capability_issuance_reservations",
        ["tenant_id", "control_space_id", "subject", "caller_kind"],
    )
    op.create_index(
        "kfs_capability_issuance_reservation_trace_idx",
        "knowledge_fs_capability_issuance_reservations",
        ["tenant_id", "trace_id"],
    )
    with op.batch_alter_table("knowledge_fs_migration_quarantine", schema=None) as batch_op:
        batch_op.add_column(sa.Column("resolved_by_operator", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("resolved_by_account_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("evidence", sa.JSON(none_as_null=True), nullable=True))
        batch_op.add_column(sa.Column("row_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False))
        batch_op.create_check_constraint(
            "kfs_migration_quarantine_version_ck",
            "row_version >= 0",
        )
        batch_op.create_check_constraint(
            "kfs_migration_quarantine_resolution_fields_ck",
            "(disposition = 'resolved' "
            "AND resolved_by_operator IS NOT NULL AND resolved_by_account_id IS NOT NULL "
            "AND evidence IS NOT NULL AND resolved_at IS NOT NULL) OR "
            "(disposition <> 'resolved' "
            "AND resolved_by_operator IS NULL AND resolved_by_account_id IS NULL "
            "AND evidence IS NULL AND resolved_at IS NULL)",
        )
    with op.batch_alter_table("knowledge_fs_workspace_cutover_ledgers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("shadow_started_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("shadow_completed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("shadow_evidence_digest", sa.String(length=71), nullable=True))
        batch_op.add_column(
            sa.Column("shadow_observation_count", sa.BigInteger(), server_default=sa.text("0"), nullable=False)
        )
        batch_op.add_column(sa.Column("shadow_window_started_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("shadow_window_ended_at", sa.DateTime(), nullable=True))
        batch_op.add_column(
            sa.Column("shadow_traffic_zero", sa.Boolean(), server_default=sa.text("false"), nullable=False)
        )
        batch_op.add_column(sa.Column("shadow_traffic_zero_evidence", sa.JSON(none_as_null=True), nullable=True))
        batch_op.add_column(sa.Column("shadow_latest_observed_revision", sa.JSON(none_as_null=True), nullable=True))
        batch_op.add_column(sa.Column("shadow_producer", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("shadow_completed_by_operator", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("shadow_completed_by_account_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_id", sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_revision", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_digest", sa.String(length=71), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_control_space_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_activated_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_updated_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_acknowledged_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_applied", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("remote_activation_replayed", sa.Boolean(), nullable=True))
        batch_op.create_check_constraint(
            "kfs_workspace_cutover_shadow_count_ck",
            "shadow_observation_count >= 0",
        )
        batch_op.create_check_constraint(
            "kfs_workspace_cutover_shadow_window_ck",
            "shadow_window_ended_at IS NULL OR shadow_window_started_at IS NOT NULL",
        )
        batch_op.create_check_constraint(
            "kfs_workspace_cutover_shadow_completion_fields_ck",
            "(shadow_completed_at IS NULL "
            "AND shadow_evidence_digest IS NULL AND shadow_producer IS NULL "
            "AND shadow_completed_by_operator IS NULL AND shadow_completed_by_account_id IS NULL "
            "AND shadow_window_started_at IS NULL AND shadow_window_ended_at IS NULL "
            "AND shadow_traffic_zero = false AND shadow_traffic_zero_evidence IS NULL "
            "AND shadow_latest_observed_revision IS NULL) OR "
            "(shadow_completed_at IS NOT NULL AND shadow_started_at IS NOT NULL "
            "AND shadow_evidence_digest IS NOT NULL AND shadow_producer IS NOT NULL "
            "AND shadow_completed_by_operator IS NOT NULL AND shadow_completed_by_account_id IS NOT NULL "
            "AND ((shadow_traffic_zero = true AND shadow_observation_count = 0 "
            "AND shadow_traffic_zero_evidence IS NOT NULL AND shadow_window_started_at IS NULL "
            "AND shadow_window_ended_at IS NULL AND shadow_latest_observed_revision IS NULL) OR "
            "(shadow_traffic_zero = false AND shadow_observation_count > 0 "
            "AND shadow_traffic_zero_evidence IS NULL AND shadow_window_started_at IS NOT NULL "
            "AND shadow_window_ended_at IS NOT NULL AND shadow_latest_observed_revision IS NOT NULL)))",
        )
        batch_op.create_check_constraint(
            "kfs_workspace_cutover_remote_activation_fields_ck",
            "(remote_activation_id IS NULL AND remote_activation_revision IS NULL "
            "AND remote_activation_digest IS NULL AND remote_activation_control_space_id IS NULL "
            "AND remote_activation_activated_at IS NULL AND remote_activation_updated_at IS NULL "
            "AND remote_activation_acknowledged_at IS NULL AND remote_activation_applied IS NULL "
            "AND remote_activation_replayed IS NULL) OR "
            "(remote_activation_id IS NOT NULL AND remote_activation_revision BETWEEN 1 AND 9007199254740991 "
            "AND remote_activation_digest IS NOT NULL AND remote_activation_control_space_id IS NOT NULL "
            "AND remote_activation_activated_at IS NOT NULL AND remote_activation_updated_at IS NOT NULL "
            "AND remote_activation_acknowledged_at IS NOT NULL "
            "AND ((remote_activation_applied = true AND remote_activation_replayed = false) "
            "OR (remote_activation_applied = false AND remote_activation_replayed = true)))",
        )
        batch_op.create_check_constraint(
            "kfs_workspace_cutover_remote_activation_time_ck",
            "remote_activation_updated_at IS NULL OR remote_activation_updated_at >= remote_activation_activated_at",
        )
    with op.batch_alter_table("knowledge_fs_shadow_authorization_diffs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("current_evidence_digest", sa.String(length=71), nullable=True))
        batch_op.add_column(sa.Column("last_observed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("row_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False))
        batch_op.create_check_constraint(
            "kfs_shadow_authorization_diff_version_ck",
            "row_version >= 0",
        )
    op.execute(
        sa.text(
            "UPDATE knowledge_fs_shadow_authorization_diffs "
            "SET current_evidence_digest = 'sha256:legacy-unversioned', last_observed_at = created_at "
            "WHERE current_evidence_digest IS NULL OR last_observed_at IS NULL"
        )
    )
    with op.batch_alter_table("knowledge_fs_shadow_authorization_diffs", schema=None) as batch_op:
        batch_op.alter_column("current_evidence_digest", existing_type=sa.String(length=71), nullable=False)
        batch_op.alter_column("last_observed_at", existing_type=sa.DateTime(), nullable=False)
    op.create_table(
        "knowledge_fs_shadow_authorization_observations",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("ledger_id", models.types.StringUUID(), nullable=False),
        sa.Column("diff_key", sa.String(length=255), nullable=False),
        sa.Column("producer", sa.String(length=255), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=True),
        sa.Column("principal", sa.String(length=255), nullable=False),
        sa.Column("legacy_allowed", sa.Boolean(), nullable=True),
        sa.Column("dify_allowed", sa.Boolean(), nullable=False),
        sa.Column("decision", sa.String(length=32), nullable=False),
        sa.Column("reason", models.types.LongText(), nullable=False),
        sa.Column("observed_revision", sa.JSON(), nullable=False),
        sa.Column("observed_at", sa.DateTime(), nullable=False),
        sa.Column("evidence_digest", sa.String(length=71), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="kfs_shadow_authorization_observation_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "ledger_id",
            "diff_key",
            "evidence_digest",
            name="kfs_shadow_authorization_observation_evidence_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "ledger_id"],
            ["knowledge_fs_workspace_cutover_ledgers.tenant_id", "knowledge_fs_workspace_cutover_ledgers.id"],
            name="kfs_shadow_authorization_observation_ledger_fk",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "kfs_shadow_authorization_observation_window_idx",
        "knowledge_fs_shadow_authorization_observations",
        ["tenant_id", "ledger_id", "observed_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "kfs_shadow_authorization_observation_window_idx",
        table_name="knowledge_fs_shadow_authorization_observations",
    )
    op.drop_table("knowledge_fs_shadow_authorization_observations")
    with op.batch_alter_table("knowledge_fs_shadow_authorization_diffs", schema=None) as batch_op:
        batch_op.drop_constraint("kfs_shadow_authorization_diff_version_ck", type_="check")
        batch_op.drop_column("row_version")
        batch_op.drop_column("last_observed_at")
        batch_op.drop_column("current_evidence_digest")
    with op.batch_alter_table("knowledge_fs_workspace_cutover_ledgers", schema=None) as batch_op:
        batch_op.drop_constraint("kfs_workspace_cutover_remote_activation_time_ck", type_="check")
        batch_op.drop_constraint("kfs_workspace_cutover_remote_activation_fields_ck", type_="check")
        batch_op.drop_constraint("kfs_workspace_cutover_shadow_completion_fields_ck", type_="check")
        batch_op.drop_constraint("kfs_workspace_cutover_shadow_window_ck", type_="check")
        batch_op.drop_constraint("kfs_workspace_cutover_shadow_count_ck", type_="check")
        batch_op.drop_column("remote_activation_replayed")
        batch_op.drop_column("remote_activation_applied")
        batch_op.drop_column("remote_activation_acknowledged_at")
        batch_op.drop_column("remote_activation_updated_at")
        batch_op.drop_column("remote_activation_activated_at")
        batch_op.drop_column("remote_activation_control_space_id")
        batch_op.drop_column("remote_activation_digest")
        batch_op.drop_column("remote_activation_revision")
        batch_op.drop_column("remote_activation_id")
        batch_op.drop_column("shadow_completed_by_account_id")
        batch_op.drop_column("shadow_completed_by_operator")
        batch_op.drop_column("shadow_producer")
        batch_op.drop_column("shadow_latest_observed_revision")
        batch_op.drop_column("shadow_traffic_zero_evidence")
        batch_op.drop_column("shadow_traffic_zero")
        batch_op.drop_column("shadow_window_ended_at")
        batch_op.drop_column("shadow_window_started_at")
        batch_op.drop_column("shadow_observation_count")
        batch_op.drop_column("shadow_evidence_digest")
        batch_op.drop_column("shadow_completed_at")
        batch_op.drop_column("shadow_started_at")
    with op.batch_alter_table("knowledge_fs_migration_quarantine", schema=None) as batch_op:
        batch_op.drop_constraint(
            "kfs_migration_quarantine_resolution_fields_ck",
            type_="check",
        )
        batch_op.drop_constraint("kfs_migration_quarantine_version_ck", type_="check")
        batch_op.drop_column("row_version")
        batch_op.drop_column("evidence")
        batch_op.drop_column("resolved_by_account_id")
        batch_op.drop_column("resolved_by_operator")
    op.drop_index(
        "kfs_capability_issuance_reservation_trace_idx",
        table_name="knowledge_fs_capability_issuance_reservations",
    )
    op.drop_index(
        "kfs_capability_issuance_reservation_subject_idx",
        table_name="knowledge_fs_capability_issuance_reservations",
    )
    op.drop_table("knowledge_fs_capability_issuance_reservations")
    op.drop_index(
        "kfs_cleanup_authorization_status_idx",
        table_name="knowledge_fs_cleanup_authorizations",
    )
    op.drop_table("knowledge_fs_cleanup_authorizations")

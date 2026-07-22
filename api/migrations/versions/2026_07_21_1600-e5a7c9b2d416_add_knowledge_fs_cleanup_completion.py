"""add global KnowledgeFS cleanup completion evidence

Revision ID: e5a7c9b2d416
Revises: d4f6e8a1c305
Create Date: 2026-07-21 16:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "e5a7c9b2d416"
down_revision = "d4f6e8a1c305"
branch_labels = None
depends_on = None


_LEDGER_VERSIONS_CHECK = (
    "readiness_ledger_cas_version >= 0 "
    "AND (approved_ledger_cas_version IS NULL OR approved_ledger_cas_version >= 0) "
    "AND (started_ledger_cas_version IS NULL OR started_ledger_cas_version >= 0) "
    "AND (completed_ledger_cas_version IS NULL OR completed_ledger_cas_version >= 0)"
)
_STATUS_FIELDS_CHECK = (
    "(status = 'requested' "
    "AND approved_by_account_id IS NULL AND approved_at IS NULL "
    "AND approval_expires_at IS NULL AND approved_ledger_cas_version IS NULL "
    "AND started_by_account_id IS NULL AND started_at IS NULL "
    "AND started_ledger_cas_version IS NULL "
    "AND completed_by_account_id IS NULL AND completed_at IS NULL "
    "AND completion_evidence IS NULL AND completed_ledger_cas_version IS NULL) OR "
    "(status = 'approved' "
    "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
    "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
    "AND started_by_account_id IS NULL AND started_at IS NULL "
    "AND started_ledger_cas_version IS NULL "
    "AND completed_by_account_id IS NULL AND completed_at IS NULL "
    "AND completion_evidence IS NULL AND completed_ledger_cas_version IS NULL) OR "
    "(status = 'started' "
    "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
    "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
    "AND started_by_account_id IS NOT NULL AND started_at IS NOT NULL "
    "AND started_ledger_cas_version IS NOT NULL "
    "AND completed_by_account_id IS NULL AND completed_at IS NULL "
    "AND completion_evidence IS NULL AND completed_ledger_cas_version IS NULL) OR "
    "(status = 'completed' "
    "AND approved_by_account_id IS NOT NULL AND approved_at IS NOT NULL "
    "AND approval_expires_at IS NOT NULL AND approved_ledger_cas_version IS NOT NULL "
    "AND started_by_account_id IS NOT NULL AND started_at IS NOT NULL "
    "AND started_ledger_cas_version IS NOT NULL "
    "AND completed_by_account_id IS NOT NULL AND completed_at IS NOT NULL "
    "AND completion_evidence IS NOT NULL AND completed_ledger_cas_version IS NOT NULL)"
)


def upgrade() -> None:
    with op.batch_alter_table("knowledge_fs_cleanup_authorizations", schema=None) as batch_op:
        batch_op.drop_constraint("kfs_cleanup_authorization_status_fields_ck", type_="check")
        batch_op.drop_constraint("kfs_cleanup_authorization_ledger_versions_ck", type_="check")
        batch_op.add_column(sa.Column("completed_by_account_id", models.types.StringUUID(), nullable=True))
        batch_op.add_column(sa.Column("completed_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("completion_evidence", sa.JSON(none_as_null=True), nullable=True))
        batch_op.add_column(sa.Column("completed_ledger_cas_version", sa.BigInteger(), nullable=True))
        batch_op.create_check_constraint(
            "kfs_cleanup_authorization_ledger_versions_ck",
            _LEDGER_VERSIONS_CHECK,
        )
        batch_op.create_check_constraint(
            "kfs_cleanup_authorization_status_fields_ck",
            _STATUS_FIELDS_CHECK,
        )
        batch_op.create_check_constraint(
            "kfs_cleanup_authorization_completion_time_ck",
            "completed_at IS NULL OR completed_at >= started_at",
        )


def downgrade() -> None:
    with op.batch_alter_table("knowledge_fs_cleanup_authorizations", schema=None) as batch_op:
        batch_op.drop_constraint("kfs_cleanup_authorization_completion_time_ck", type_="check")
        batch_op.drop_constraint("kfs_cleanup_authorization_status_fields_ck", type_="check")
        batch_op.drop_constraint("kfs_cleanup_authorization_ledger_versions_ck", type_="check")
        batch_op.create_check_constraint(
            "kfs_cleanup_authorization_ledger_versions_ck",
            "readiness_ledger_cas_version >= 0 "
            "AND (approved_ledger_cas_version IS NULL OR approved_ledger_cas_version >= 0) "
            "AND (started_ledger_cas_version IS NULL OR started_ledger_cas_version >= 0)",
        )
        batch_op.create_check_constraint(
            "kfs_cleanup_authorization_status_fields_ck",
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
        )
        batch_op.drop_column("completed_ledger_cas_version")
        batch_op.drop_column("completion_evidence")
        batch_op.drop_column("completed_at")
        batch_op.drop_column("completed_by_account_id")

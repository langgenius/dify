"""add independent KnowledgeFS control-plane tables

Revision ID: a4e7c2f91b30
Revises: 3c9f8e2a1d7b
Create Date: 2026-07-21 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "a4e7c2f91b30"
down_revision = "3c9f8e2a1d7b"
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
        "knowledge_fs_control_spaces",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("knowledge_space_id", models.types.StringUUID(), nullable=True),
        sa.Column("knowledge_space_revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("owner_account_id", models.types.StringUUID(), nullable=False),
        sa.Column("visibility", sa.String(length=32), server_default=sa.text("'only_me'"), nullable=False),
        sa.Column("provisioning_key", sa.String(length=255), nullable=False),
        sa.Column("lifecycle_operation_id", models.types.StringUUID(), nullable=True),
        sa.Column("state", sa.String(length=32), server_default=sa.text("'provisioning'"), nullable=False),
        sa.Column("resource_version", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_code", sa.String(length=255), nullable=True),
        sa.Column("last_error_message", models.types.LongText(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("deletion_irreversible_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_control_space_pkey"),
        sa.UniqueConstraint("tenant_id", "id", name="kfs_control_space_tenant_id_uq"),
        sa.UniqueConstraint("provisioning_key", name="kfs_control_space_provisioning_key_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="kfs_control_space_workspace_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("resource_version >= 0", name="kfs_control_space_resource_version_ck"),
        sa.CheckConstraint("attempt_count >= 0", name="kfs_control_space_attempt_count_ck"),
        sa.CheckConstraint(
            "state != 'active' OR knowledge_space_id IS NOT NULL",
            name="kfs_control_space_active_registration_ck",
        ),
        sa.CheckConstraint(
            "deletion_irreversible_at IS NULL OR state IN ('deleting', 'deleted', 'error')",
            name="kfs_control_space_irreversible_state_ck",
        ),
        sa.CheckConstraint(
            "knowledge_space_revision >= 0",
            name="kfs_control_space_remote_revision_ck",
        ),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.create_index(
            "kfs_control_space_tenant_space_uq",
            "knowledge_fs_control_spaces",
            ["tenant_id", "knowledge_space_id"],
            unique=True,
            postgresql_where=sa.text("knowledge_space_id IS NOT NULL"),
        )
    else:
        op.create_index(
            "kfs_control_space_tenant_space_uq",
            "knowledge_fs_control_spaces",
            ["tenant_id", "knowledge_space_id"],
            unique=True,
        )
    op.create_index(
        "kfs_control_space_state_updated_idx",
        "knowledge_fs_control_spaces",
        ["state", "updated_at"],
    )
    op.create_index(
        "kfs_control_space_tenant_state_updated_idx",
        "knowledge_fs_control_spaces",
        ["tenant_id", "state", "updated_at"],
    )
    op.create_index(
        "kfs_control_space_tenant_owner_state_idx",
        "knowledge_fs_control_spaces",
        ["tenant_id", "owner_account_id", "state"],
    )

    op.create_table(
        "knowledge_fs_control_space_permissions",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
        sa.Column("revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("granted_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_account_id", models.types.StringUUID(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_control_space_permission_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "control_space_id",
            "account_id",
            name="kfs_control_space_permission_identity_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_control_space_permission_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("revision >= 0", name="kfs_control_space_permission_revision_ck"),
    )
    op.create_index(
        "kfs_control_space_permission_account_idx",
        "knowledge_fs_control_space_permissions",
        ["tenant_id", "account_id", "status"],
    )

    op.create_table(
        "knowledge_fs_external_access_policies",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("service_api_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("agent_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("workflow_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("mcp_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("updated_by_account_id", models.types.StringUUID(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_external_access_policy_pkey"),
        sa.UniqueConstraint("tenant_id", "control_space_id", name="kfs_external_access_policy_space_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_external_access_policy_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("revision >= 0", name="kfs_external_access_policy_revision_ck"),
    )

    op.create_table(
        "knowledge_fs_api_credentials",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("credential_hash", sa.String(length=255), nullable=False),
        sa.Column("credential_prefix", sa.String(length=32), nullable=False),
        sa.Column("credential_last4", sa.String(length=4), nullable=False),
        sa.Column("principal", sa.String(length=255), nullable=False),
        sa.Column("allowed_actions", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
        sa.Column("revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("revoke_reason", sa.String(length=255), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_api_credential_pkey"),
        sa.UniqueConstraint("credential_hash", name="kfs_api_credential_hash_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_api_credential_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("revision >= 0", name="kfs_api_credential_revision_ck"),
    )
    op.create_index(
        "kfs_api_credential_tenant_space_status_idx",
        "knowledge_fs_api_credentials",
        ["tenant_id", "control_space_id", "status"],
    )
    op.create_index(
        "kfs_api_credential_tenant_prefix_idx",
        "knowledge_fs_api_credentials",
        ["tenant_id", "credential_prefix"],
    )

    op.create_table(
        "app_knowledge_fs_space_joins",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("join_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
        sa.Column("revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_by_account_id", models.types.StringUUID(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="app_kfs_space_join_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "app_id",
            "control_space_id",
            "join_type",
            name="app_kfs_space_join_identity_uq",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="app_kfs_space_join_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("revision >= 0", name="app_kfs_space_join_revision_ck"),
    )
    op.create_index(
        "app_kfs_space_join_app_status_idx",
        "app_knowledge_fs_space_joins",
        ["tenant_id", "app_id", "status"],
    )

    op.create_table(
        "knowledge_fs_authorization_revisions",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("membership_epoch", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("space_acl_epoch", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("external_access_epoch", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("content_policy_revision", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column("revoke_sequence", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_authorization_revision_pkey"),
        sa.UniqueConstraint("tenant_id", "control_space_id", name="kfs_authorization_revision_space_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_authorization_revision_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("membership_epoch >= 0", name="kfs_authorization_membership_epoch_ck"),
        sa.CheckConstraint("space_acl_epoch >= 0", name="kfs_authorization_space_acl_epoch_ck"),
        sa.CheckConstraint("external_access_epoch >= 0", name="kfs_authorization_external_access_epoch_ck"),
        sa.CheckConstraint("content_policy_revision >= 0", name="kfs_authorization_content_policy_revision_ck"),
        sa.CheckConstraint("revoke_sequence >= 0", name="kfs_authorization_revoke_sequence_ck"),
    )

    op.create_table(
        "knowledge_fs_capability_issuance_audits",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("trace_id", sa.String(length=128), nullable=False),
        sa.Column("jti_hash", sa.String(length=80), nullable=False),
        sa.Column("claims_summary", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_capability_issuance_audit_pkey"),
        sa.UniqueConstraint("jti_hash", name="kfs_capability_issuance_audit_jti_hash_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_capability_issuance_audit_space_fk",
            ondelete="RESTRICT",
        ),
    )
    op.create_index(
        "kfs_capability_issuance_audit_space_created_idx",
        "knowledge_fs_capability_issuance_audits",
        ["tenant_id", "control_space_id", "created_at"],
    )
    op.create_index(
        "kfs_capability_issuance_audit_trace_idx",
        "knowledge_fs_capability_issuance_audits",
        ["tenant_id", "trace_id"],
    )

    op.create_table(
        "knowledge_fs_lifecycle_outbox",
        _uuid_column("id", nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("operation_id", models.types.StringUUID(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("operation", sa.String(length=32), nullable=False),
        sa.Column("command_payload", sa.JSON(), nullable=False),
        sa.Column("expected_control_space_version", sa.BigInteger(), nullable=False),
        sa.Column("expected_knowledge_space_revision", sa.BigInteger(), nullable=True),
        sa.Column("command_schema_version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("lease_owner", sa.String(length=255), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("last_error_code", sa.String(length=255), nullable=True),
        sa.Column("last_error_message", models.types.LongText(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("retain_until", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="kfs_lifecycle_outbox_pkey"),
        sa.UniqueConstraint("tenant_id", "operation_id", name="kfs_lifecycle_outbox_operation_uq"),
        sa.UniqueConstraint("tenant_id", "idempotency_key", name="kfs_lifecycle_outbox_idempotency_uq"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "control_space_id"],
            ["knowledge_fs_control_spaces.tenant_id", "knowledge_fs_control_spaces.id"],
            name="kfs_lifecycle_outbox_space_fk",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("command_schema_version >= 1", name="kfs_lifecycle_outbox_schema_version_ck"),
        sa.CheckConstraint("expected_control_space_version >= 0", name="kfs_lifecycle_outbox_expected_version_ck"),
        sa.CheckConstraint("attempt_count >= 0", name="kfs_lifecycle_outbox_attempt_count_ck"),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'succeeded', 'retry', 'dead_letter')",
            name="kfs_lifecycle_outbox_status_ck",
        ),
        sa.CheckConstraint(
            "(status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) "
            "OR (status != 'processing' AND lease_owner IS NULL AND lease_expires_at IS NULL)",
            name="kfs_lifecycle_outbox_lease_state_ck",
        ),
        sa.CheckConstraint(
            "(status IN ('succeeded', 'dead_letter') AND completed_at IS NOT NULL) "
            "OR (status NOT IN ('succeeded', 'dead_letter') AND completed_at IS NULL)",
            name="kfs_lifecycle_outbox_terminal_state_ck",
        ),
    )
    op.create_index(
        "kfs_lifecycle_outbox_dispatch_idx",
        "knowledge_fs_lifecycle_outbox",
        ["status", "next_attempt_at", "id"],
    )
    op.create_index(
        "kfs_lifecycle_outbox_space_created_idx",
        "knowledge_fs_lifecycle_outbox",
        ["tenant_id", "control_space_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("kfs_lifecycle_outbox_space_created_idx", table_name="knowledge_fs_lifecycle_outbox")
    op.drop_index("kfs_lifecycle_outbox_dispatch_idx", table_name="knowledge_fs_lifecycle_outbox")
    op.drop_table("knowledge_fs_lifecycle_outbox")
    op.drop_index(
        "kfs_capability_issuance_audit_trace_idx",
        table_name="knowledge_fs_capability_issuance_audits",
    )
    op.drop_index(
        "kfs_capability_issuance_audit_space_created_idx",
        table_name="knowledge_fs_capability_issuance_audits",
    )
    op.drop_table("knowledge_fs_capability_issuance_audits")
    op.drop_table("knowledge_fs_authorization_revisions")
    op.drop_index("app_kfs_space_join_app_status_idx", table_name="app_knowledge_fs_space_joins")
    op.drop_table("app_knowledge_fs_space_joins")
    op.drop_index("kfs_api_credential_tenant_prefix_idx", table_name="knowledge_fs_api_credentials")
    op.drop_index("kfs_api_credential_tenant_space_status_idx", table_name="knowledge_fs_api_credentials")
    op.drop_table("knowledge_fs_api_credentials")
    op.drop_table("knowledge_fs_external_access_policies")
    op.drop_index(
        "kfs_control_space_permission_account_idx",
        table_name="knowledge_fs_control_space_permissions",
    )
    op.drop_table("knowledge_fs_control_space_permissions")
    op.drop_index("kfs_control_space_tenant_owner_state_idx", table_name="knowledge_fs_control_spaces")
    op.drop_index("kfs_control_space_tenant_state_updated_idx", table_name="knowledge_fs_control_spaces")
    op.drop_index("kfs_control_space_state_updated_idx", table_name="knowledge_fs_control_spaces")
    op.drop_index("kfs_control_space_tenant_space_uq", table_name="knowledge_fs_control_spaces")
    op.drop_table("knowledge_fs_control_spaces")

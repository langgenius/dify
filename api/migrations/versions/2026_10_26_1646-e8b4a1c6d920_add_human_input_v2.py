"""Create the Human Input v2 schema.

Revision ID: e8b4a1c6d920
Revises: d7e9a1c3f502
Create Date: 2026-10-26 16:46:14
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "e8b4a1c6d920"
down_revision = "d7e9a1c3f502"
branch_labels = None
depends_on = None

_PROVIDER_METADATA_MAX_LENGTH = 128


def _default_fields(table_name: str) -> tuple[sa.Column, sa.Column, sa.Column, sa.PrimaryKeyConstraint]:
    return (
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=f"{table_name}_pkey"),
    )


def upgrade() -> None:
    op.create_table(
        "human_input_contact_identities",
        sa.Column(
            "subject_type",
            sa.String(length=20),
            nullable=False,
            comment="Immutable Account or External subject discriminator.",
        ),
        sa.Column(
            "account_id",
            StringUUID(),
            nullable=True,
            comment="Logical accounts.id reference for Account subjects only.",
        ),
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_contact_identities_pkey"),
        sa.UniqueConstraint("account_id", name="human_input_contact_identities_account_id_uq"),
        sa.CheckConstraint(
            "(subject_type = 'account' AND account_id IS NOT NULL) OR "
            "(subject_type = 'external' AND account_id IS NULL)",
            name="human_input_contact_identities_subject_type_ck",
        ),
        comment=(
            "Immutable Human Input Contact identities. Mutable Account and External Contact profile facts live "
            "with their source owners."
        ),
    )

    op.create_table(
        "human_input_external_contact_profiles",
        sa.Column(
            "contact_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_contact_identities.id reference for one External subject.",
        ),
        sa.Column(
            "tenant_id",
            StringUUID(),
            nullable=False,
            comment="Owning tenants.id used by every current External Contact lookup.",
        ),
        sa.Column("name", sa.String(length=255), nullable=False, comment="Workspace-managed display name."),
        sa.Column(
            "normalized_name",
            sa.String(length=255),
            nullable=False,
            comment="Canonical search value maintained by External Contact writes.",
        ),
        sa.Column(
            "email",
            sa.String(length=320),
            nullable=False,
            comment="Workspace-managed deliverable Email address.",
        ),
        sa.Column(
            "normalized_email",
            sa.String(length=320),
            nullable=False,
            comment="Canonical Email equality value maintained by External Contact writes.",
        ),
        sa.Column(
            "avatar_file_id",
            StringUUID(),
            nullable=True,
            comment="Logical upload_files.id reference owned by the same workspace.",
        ),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("contact_id", name="human_input_external_contact_profiles_pkey"),
        sa.UniqueConstraint("tenant_id", "normalized_email", name="hiecp_tenant_normalized_email_uq"),
        comment=(
            "Current workspace-owned External Contact profiles. Deletion removes both this profile and its "
            "Contact identity."
        ),
    )
    op.create_index(
        "hiecp_tenant_normalized_name_idx",
        "human_input_external_contact_profiles",
        ["tenant_id", "normalized_name"],
    )

    op.create_table(
        "human_input_platform_contact_workspace_entries",
        sa.Column("tenant_id", StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column(
            "contact_id",
            StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_contact_identities.id.",
        ),
        sa.Column(
            "added_by_account_id",
            StringUUID(),
            nullable=False,
            comment="Logical foreign key to accounts.id for the administrator who added this directory entry.",
        ),
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_platform_contact_workspace_entries_pkey"),
        sa.UniqueConstraint("tenant_id", "contact_id", name="hipcwe_tenant_contact_uq"),
        comment=(
            "EE-only workspace allow-list for Organization Account contacts. Workspace membership and External "
            "contact ownership must not create rows in this table."
        ),
    )
    op.create_index(
        "hipcwe_tenant_created_at_id_idx",
        "human_input_platform_contact_workspace_entries",
        ["tenant_id", "created_at", "id"],
    )
    op.create_index(
        "hipcwe_contact_id_idx",
        "human_input_platform_contact_workspace_entries",
        ["contact_id"],
    )

    op.create_table(
        "human_input_im_channels",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column(
            "owner_key",
            sa.String(length=50),
            nullable=False,
            comment="Canonical owner slot: workspace:<tenant_id> or deployment.",
        ),
        sa.Column(
            "provider",
            sa.String(length=20),
            nullable=False,
            comment="Configured IM provider discriminator.",
        ),
        sa.Column(
            "provider_tenant_id",
            sa.String(length=255),
            nullable=False,
            comment="Confirmed provider-side organization, tenant, or workspace identifier.",
        ),
        sa.Column(
            "encrypted_credentials",
            LongText(),
            nullable=False,
            comment="Versioned opaque encrypted IM Channel credential envelope.",
        ),
        sa.Column(
            "app_identifier",
            sa.String(length=255),
            nullable=False,
            comment="Safe provider application identifier used by credential-free projections.",
        ),
        sa.Column(
            "webhook_id",
            sa.String(length=32),
            nullable=False,
            comment="Server-generated globally unique route ID used to derive webhook URLs.",
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            comment="Stored credential-safe Channel status snapshot.",
        ),
        sa.Column(
            "config_version",
            sa.Integer(),
            nullable=False,
            comment="Monotonic numeric version paired with the Channel ID for CAS.",
        ),
        sa.Column(
            "configured_by_account_id",
            StringUUID(),
            nullable=True,
            comment="Latest configuring Dify Account; null for deployment-owned writes.",
        ),
        sa.Column(
            "status_reason",
            LongText(),
            nullable=True,
            comment="Operator-safe status explanation without provider payload or credentials.",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.current_timestamp(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="human_input_im_channels_pkey"),
        sa.UniqueConstraint("owner_key", name="human_input_im_channels_owner_key_uq"),
        sa.UniqueConstraint("webhook_id", name="human_input_im_channels_webhook_id_uq"),
        sa.CheckConstraint(
            "config_version > 0",
            name="human_input_im_channels_config_version_positive_ck",
        ),
        comment=(
            "Current owner-scoped Human Input IM Channel configuration. "
            "Directory, Binding, Sync, and inbox records remain separately owned."
        ),
    )

    op.create_table(
        "human_input_im_identities",
        sa.Column(
            "channel_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_channels.id reference.",
        ),
        sa.Column(
            "provider_user_id",
            sa.String(length=255),
            nullable=False,
            comment="Provider-native user identifier within the owning Channel.",
        ),
        sa.Column(
            "raw_payload",
            LongText(),
            nullable=False,
            comment="Latest opaque Provider payload retained for diagnostics.",
        ),
        sa.Column(
            "last_seen_sync_run_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_sync_runs.id reference for the latest observation.",
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(),
            nullable=False,
            comment="Timestamp of the latest successful Provider observation.",
        ),
        sa.Column(
            "display_name",
            sa.String(length=255),
            nullable=True,
            comment="Latest canonical non-blank Provider display name.",
        ),
        sa.Column(
            "normalized_name",
            sa.String(length=255),
            nullable=True,
            comment="Canonical display name used by persistence queries.",
        ),
        sa.Column(
            "email",
            sa.String(length=320),
            nullable=True,
            comment="Latest canonical non-blank Provider email.",
        ),
        sa.Column(
            "normalized_email",
            sa.String(length=320),
            nullable=True,
            comment="Canonical email used by matching and persistence queries.",
        ),
        sa.Column(
            "avatar_file_id",
            StringUUID(),
            nullable=True,
            comment="Logical upload_files.id reference for the current IM avatar.",
        ),
        *_default_fields("human_input_im_identities"),
        sa.UniqueConstraint(
            "channel_id",
            "provider_user_id",
            name="human_input_im_identities_channel_provider_user_uq",
        ),
        sa.CheckConstraint(
            "length(trim(provider_user_id)) > 0",
            name="human_input_im_identities_provider_user_nonblank",
        ),
        comment="Current Provider users synchronized through one IM Channel.",
    )
    op.create_index(
        "hiimi_channel_email_idx",
        "human_input_im_identities",
        ["channel_id", "normalized_email"],
    )
    op.create_index(
        "hiimi_channel_name_idx",
        "human_input_im_identities",
        ["channel_id", "normalized_name"],
    )
    op.create_table(
        "human_input_im_bindings",
        sa.Column(
            "channel_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_channels.id reference.",
        ),
        sa.Column(
            "contact_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_contact_identities.id reference.",
        ),
        sa.Column(
            "im_identity_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_identities.id reference.",
        ),
        sa.Column(
            "bound_by_account_id",
            StringUUID(),
            nullable=True,
            comment="Latest Dify Account that manually selected this Binding, when available.",
        ),
        *_default_fields("human_input_im_bindings"),
        sa.UniqueConstraint(
            "channel_id",
            "contact_id",
            name="human_input_im_bindings_channel_contact_uq",
        ),
        sa.UniqueConstraint(
            "channel_id",
            "im_identity_id",
            name="human_input_im_bindings_channel_identity_uq",
        ),
        comment="Default Contact-to-IM-identity Bindings for one IM Channel.",
    )
    op.create_table(
        "human_input_im_workspace_binding_overrides",
        sa.Column(
            "channel_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_channels.id reference.",
        ),
        sa.Column(
            "tenant_id",
            StringUUID(),
            nullable=False,
            comment="Target tenants.id whose effective Binding is overridden.",
        ),
        sa.Column(
            "contact_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_contact_identities.id reference.",
        ),
        sa.Column(
            "im_identity_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_identities.id reference.",
        ),
        sa.Column(
            "bound_by_account_id",
            StringUUID(),
            nullable=True,
            comment="Dify Account that selected this workspace override.",
        ),
        *_default_fields("human_input_im_workspace_binding_overrides"),
        sa.UniqueConstraint(
            "channel_id",
            "tenant_id",
            "contact_id",
            name="hiimwbo_channel_tenant_contact_uq",
        ),
        sa.UniqueConstraint(
            "channel_id",
            "tenant_id",
            "im_identity_id",
            name="hiimwbo_channel_tenant_identity_uq",
        ),
        comment="Workspace-specific Binding overrides for one IM Channel.",
    )
    op.create_index(
        "hiimwbo_channel_identity_idx",
        "human_input_im_workspace_binding_overrides",
        ["channel_id", "im_identity_id"],
    )

    op.create_table(
        "human_input_im_sync_runs",
        sa.Column(
            "integration_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_channels.id owner.",
        ),
        sa.Column(
            "integration_config_version",
            sa.Integer(),
            nullable=False,
            comment="Captured integration configuration revision.",
        ),
        sa.Column("provider", sa.String(length=20), nullable=False, comment="Captured provider discriminator."),
        sa.Column("status", sa.String(length=20), nullable=False, comment="Synchronization lifecycle state."),
        sa.Column("added_count", sa.Integer(), nullable=False, comment="Newly matched and bound entries."),
        sa.Column("not_matched_count", sa.Integer(), nullable=False, comment="Unmatched entries."),
        sa.Column("failed_count", sa.Integer(), nullable=False, comment="Failed entries."),
        sa.Column(
            "removed_count",
            sa.Integer(),
            nullable=False,
            comment="Removed binding facts, including one unbound-identity fact when applicable.",
        ),
        sa.Column("skipped_count", sa.Integer(), nullable=False, comment="Intentionally skipped entries."),
        sa.Column(
            "started_by_account_id",
            StringUUID(),
            nullable=True,
            comment="Logical accounts.id for the trigger actor.",
        ),
        sa.Column("started_at", sa.DateTime(), nullable=True, comment="Worker start timestamp."),
        sa.Column("finished_at", sa.DateTime(), nullable=True, comment="Terminal timestamp."),
        sa.Column("error_code", sa.String(length=100), nullable=True, comment="Machine-readable terminal error."),
        sa.Column("error_message", LongText(), nullable=True, comment="Operator-safe terminal error."),
        *_default_fields("human_input_im_sync_runs"),
        sa.CheckConstraint("integration_config_version > 0", name="captured_version_positive"),
        sa.CheckConstraint(
            "added_count >= 0 AND not_matched_count >= 0 AND failed_count >= 0 AND removed_count >= 0 "
            "AND skipped_count >= 0",
            name="result_counts_nonnegative",
        ),
        comment="Manual IM directory synchronization lifecycle and counts.",
    )
    op.create_index(
        "hiimsr_integration_created_idx",
        "human_input_im_sync_runs",
        ["integration_id", "created_at", "id"],
    )
    op.create_index(
        "hiimsr_integration_status_created_idx",
        "human_input_im_sync_runs",
        ["integration_id", "status", "created_at"],
    )

    op.create_table(
        "human_input_im_sync_results",
        sa.Column(
            "integration_id",
            StringUUID(),
            nullable=False,
            comment="Denormalized logical human_input_im_channels.id.",
        ),
        sa.Column(
            "sync_run_id",
            StringUUID(),
            nullable=False,
            comment="Logical human_input_im_sync_runs.id.",
        ),
        sa.Column("result_type", sa.String(length=20), nullable=False, comment="Stable result bucket."),
        sa.Column("provider_user_id", sa.String(length=255), nullable=True, comment="Observed provider user ID."),
        sa.Column("display_name", sa.String(length=255), nullable=True, comment="Observed provider display name."),
        sa.Column("email", sa.String(length=320), nullable=True, comment="Observed provider email."),
        sa.Column("normalized_email", sa.String(length=320), nullable=True, comment="Normalized matching email."),
        sa.Column("contact_id", StringUUID(), nullable=True, comment="Historical logical Contact identity."),
        sa.Column(
            "im_identity_id",
            StringUUID(),
            nullable=True,
            comment="Historical logical IM identity.",
        ),
        sa.Column("im_binding_id", StringUUID(), nullable=True, comment="Historical logical IM binding."),
        sa.Column("removal_reason", sa.String(length=32), nullable=True, comment="Stable removal reason."),
        sa.Column("reason_code", sa.String(length=100), nullable=True, comment="Machine-readable diagnostic reason."),
        sa.Column("reason_message", LongText(), nullable=True, comment="Operator-safe diagnostic."),
        sa.Column(
            "directory_entry_payload",
            LongText(),
            nullable=True,
            comment="Immutable provider entry JSON observed by this run.",
        ),
        sa.Column(
            "contact_snapshot",
            LongText(),
            nullable=True,
            comment="Immutable Contact display snapshot JSON.",
        ),
        sa.Column(
            "identity_snapshot",
            LongText(),
            nullable=True,
            comment="Immutable removed identity snapshot JSON.",
        ),
        sa.Column(
            "operation_key",
            sa.String(length=255),
            nullable=True,
            comment="Deterministic run-local idempotency key; null only for historical results.",
        ),
        *_default_fields("human_input_im_sync_results"),
        sa.UniqueConstraint(
            "sync_run_id",
            "operation_key",
            name="human_input_im_sync_results_run_operation_uq",
        ),
        comment="Append-only per-entry, removed-binding, and diagnostic IM synchronization outcomes.",
    )
    op.create_index(
        "hiimsres_run_type_created_idx",
        "human_input_im_sync_results",
        ["sync_run_id", "result_type", "created_at", "id"],
    )
    op.create_index(
        "hiimsres_integration_contact_created_idx",
        "human_input_im_sync_results",
        ["integration_id", "contact_id", "created_at"],
    )
    op.create_index(
        "hiimsres_integration_identity_created_idx",
        "human_input_im_sync_results",
        ["integration_id", "im_identity_id", "created_at"],
    )

    op.create_table(
        "human_input_email_providers",
        sa.Column("provider", sa.String(length=20), nullable=False, comment="Configured email provider discriminator."),
        sa.Column("sender_email", sa.String(length=320), nullable=False, comment="Configured sender email address."),
        sa.Column(
            "encrypted_credentials",
            LongText(),
            nullable=False,
            comment="Encrypted Resend credential Pydantic model serialized as JSON text.",
        ),
        sa.Column("tenant_id", StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("sender_name", sa.String(length=255), nullable=False, comment="Optional sender display name."),
        sa.Column(
            "configured_by_account_id",
            StringUUID(),
            nullable=True,
            comment="Logical foreign key to accounts.id for the latest configuration write.",
        ),
        sa.Column(
            "config_version",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("1"),
            comment="Monotonic Email configuration revision used for compare-and-swap.",
        ),
        *_default_fields("human_input_email_providers"),
        sa.UniqueConstraint("tenant_id", name="human_input_email_providers_tenant_uq"),
        comment="Workspace-level Human Input email delivery configuration.",
    )

    op.create_table(
        "im_message_event",
        sa.Column("integration_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column(
            "tenant_id",
            sa.String(length=_PROVIDER_METADATA_MAX_LENGTH),
            nullable=False,
        ),
        sa.Column(
            "event_id",
            sa.String(length=_PROVIDER_METADATA_MAX_LENGTH),
            nullable=True,
        ),
        sa.Column("provider_event_time", sa.DateTime(), nullable=True),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.Column("provider_event_type", sa.String(length=_PROVIDER_METADATA_MAX_LENGTH), nullable=True),
        sa.Column("ingress_kind", sa.String(length=20), nullable=False),
        sa.Column("payload", LongText(), nullable=False),
        sa.Column(
            "request_ip_address",
            sa.Text(),
            nullable=True,
            comment="HTTP request IP when available; absent for stream and historical events.",
        ),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="im_message_inbox_pkey"),
        sa.UniqueConstraint("provider", "event_id", name="im_message_event_provider_event_uq"),
        comment="Durable authenticated IM callback records.",
    )

    op.create_table(
        "human_input_im_reconciliation_changes",
        sa.Column(
            "integration_id",
            StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_im_channels.id.",
        ),
        sa.Column(
            "sync_run_id",
            StringUUID(),
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
        sa.Column("im_identity_id", StringUUID(), nullable=False),
        sa.Column("committed_at", sa.DateTime(), nullable=False),
        sa.Column("im_binding_id", StringUUID(), nullable=True),
        sa.Column("contact_id", StringUUID(), nullable=True),
        sa.Column("before_snapshot", sa.Text(), nullable=True),
        sa.Column("after_snapshot", sa.Text(), nullable=True),
        sa.Column("id", StringUUID(), nullable=False),
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
        sa.Column("submitted_by_delivery_id", StringUUID(), nullable=True),
        sa.Column("selected_action_id", sa.String(200), nullable=True),
        sa.Column("raw_submission_inputs", sa.Text(), nullable=True),
        sa.Column("normalized_submission_data", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="hitlv2_forms_pkey"),
        sa.UniqueConstraint(
            "workflow_run_id",
            "node_execution_id",
            name="hitlv2_forms_execution_uq",
        ),
    )
    op.create_index(
        "hitlv2_forms_expiration_scan_idx",
        "hitlv2_forms",
        ["tenant_id", "app_id", "form_kind", "status", "id"],
    )
    op.create_index("hitlv2_forms_node_deadline_idx", "hitlv2_forms", ["form_kind", "status", "expiration_time", "id"])
    op.create_index(
        "hitlv2_forms_global_deadline_idx", "hitlv2_forms", ["form_kind", "status", "global_timeout_deadline", "id"]
    )

    op.create_table(
        "hitlv2_recipients",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("subject_type", sa.String(20), nullable=False),
        sa.Column("subject_value", sa.String(255), nullable=False),
        sa.Column("sources", LongText(), nullable=False),
        sa.Column("snapshot", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="hitlv2_recipients_pkey"),
        sa.UniqueConstraint("form_id", "subject_type", "subject_value", name="hitlv2_recipients_subject_uq"),
    )

    op.create_table(
        "hitlv2_deliveries",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("recipient_id", StringUUID(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("auth_type", sa.Text(), nullable=False),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_snapshot", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )
    op.create_index("hitlv2_deliveries_token_idx", "hitlv2_deliveries", ["token_hash"])
    op.create_index("hitlv2_deliveries_form_target_idx", "hitlv2_deliveries", ["form_id", "target_type"])
    op.create_table(
        "hitlv2_delivery_attempts",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("delivery_id", StringUUID(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("error_message", sa.String(200), nullable=True),
        sa.Column("response", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )

    op.create_table(
        "hitlv2_audit_events",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("form_id", StringUUID(), nullable=False),
        sa.Column("payload", LongText(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
    )


def downgrade() -> None:
    op.drop_table("hitlv2_audit_events")
    op.drop_table("hitlv2_delivery_attempts")
    op.drop_table("hitlv2_deliveries")
    op.drop_table("hitlv2_recipients")
    op.drop_table("hitlv2_forms")
    op.drop_table("human_input_im_reconciliation_changes")
    op.drop_table("im_message_event")
    op.drop_table("human_input_email_providers")
    op.drop_table("human_input_im_sync_results")
    op.drop_table("human_input_im_sync_runs")
    op.drop_table("human_input_im_workspace_binding_overrides")
    op.drop_table("human_input_im_bindings")
    op.drop_table("human_input_im_identities")
    op.drop_table("human_input_im_channels")
    op.drop_table("human_input_platform_contact_workspace_entries")
    op.drop_table("human_input_external_contact_profiles")
    op.drop_table("human_input_contact_identities")

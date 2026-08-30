"""add human input v2 form core

Revision ID: 8a1c4e7f9b2d
Revises: 6d9f2b4c5e7a
Create Date: 2026-07-25 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "8a1c4e7f9b2d"
down_revision = "6d9f2b4c5e7a"
branch_labels = None
depends_on = None


def _default_fields(table_name: str) -> tuple[sa.Column, sa.Column, sa.Column, sa.PrimaryKeyConstraint]:
    return (
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=f"{table_name}_pkey"),
    )


def upgrade() -> None:
    op.create_table(
        "human_input_email_providers",
        sa.Column("provider", sa.String(length=20), nullable=False, comment="Configured email provider discriminator."),
        sa.Column("sender_email", sa.String(length=320), nullable=False, comment="Configured sender email address."),
        sa.Column(
            "encrypted_credentials",
            models.types.LongText(),
            nullable=False,
            comment="Encrypted Resend credential Pydantic model serialized as JSON text.",
        ),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("sender_name", sa.String(length=255), nullable=False, comment="Optional sender display name."),
        sa.Column(
            "configured_by_account_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to accounts.id for the latest configuration write.",
        ),
        *_default_fields("human_input_email_providers"),
        sa.UniqueConstraint("tenant_id", name="human_input_email_providers_tenant_uq"),
        comment="Workspace-level Human Input email delivery configuration.",
    )

    op.create_table(
        "human_input_v2_forms",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("app_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to apps.id."),
        sa.Column(
            "form_definition",
            models.types.LongText(),
            nullable=False,
            comment="Frozen Human Input v2 form definition serialized as JSON text.",
        ),
        sa.Column("rendered_content", models.types.LongText(), nullable=False, comment="Frozen rendered content."),
        sa.Column("node_timeout_at", sa.DateTime(), nullable=False, comment="Frozen node-level timeout timestamp."),
        sa.Column("global_expires_at", sa.DateTime(), nullable=False, comment="Frozen global expiration timestamp."),
        sa.Column("form_kind", sa.String(length=20), nullable=False, comment="Human Input v2 form ownership kind."),
        sa.Column("status", sa.String(length=20), nullable=False, comment="Current form lifecycle state."),
        sa.Column(
            "workflow_pause_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to workflow_pauses.id.",
        ),
        sa.Column(
            "node_execution_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to workflow_node_executions.id.",
        ),
        *_default_fields("human_input_v2_forms"),
        sa.UniqueConstraint("workflow_pause_id", name="hiv2_forms_workflow_pause_uq"),
        sa.UniqueConstraint("node_execution_id", name="hiv2_forms_node_execution_uq"),
        sa.CheckConstraint(
            "form_kind <> 'runtime' OR (workflow_pause_id IS NOT NULL AND node_execution_id IS NOT NULL)",
            name="runtime_owner",
        ),
        comment="Independent Human Input v2 form roots bound only to shared workflow pause infrastructure.",
    )
    op.create_index(
        "hiv2_forms_tenant_status_node_timeout_idx",
        "human_input_v2_forms",
        ["tenant_id", "status", "node_timeout_at"],
    )
    op.create_index(
        "hiv2_forms_tenant_status_global_expiry_idx",
        "human_input_v2_forms",
        ["tenant_id", "status", "global_expires_at"],
    )

    op.create_table(
        "human_input_v2_form_approver_grants",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column(
            "form_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_v2_forms.id.",
        ),
        sa.Column("subject_type", sa.String(length=20), nullable=False, comment="Approval subject discriminator."),
        sa.Column("subject_key", sa.String(length=255), nullable=False, comment="Portable subject deduplication key."),
        sa.Column(
            "matched_sources",
            models.types.LongText(),
            nullable=False,
            comment="Immutable ordered recipient source snapshots serialized as JSON text.",
        ),
        sa.Column(
            "subject_snapshot",
            models.types.LongText(),
            nullable=False,
            comment="Immutable display-only subject snapshot serialized as JSON text.",
        ),
        sa.Column(
            "contact_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical human_input_contact_identities.id.",
        ),
        sa.Column("end_user_id", models.types.StringUUID(), nullable=True, comment="Logical end_users.id."),
        sa.Column("normalized_email", sa.String(length=320), nullable=True, comment="Normalized Email subject."),
        *_default_fields("human_input_v2_form_approver_grants"),
        sa.UniqueConstraint("form_id", "subject_key", name="hiv2_form_grants_form_subject_uq"),
        sa.CheckConstraint(
            "(subject_type = 'contact' AND contact_id IS NOT NULL AND end_user_id IS NULL "
            "AND normalized_email IS NULL) OR "
            "(subject_type = 'end_user' AND contact_id IS NULL AND end_user_id IS NOT NULL "
            "AND normalized_email IS NULL) OR "
            "(subject_type = 'email_address' AND contact_id IS NULL AND end_user_id IS NULL "
            "AND normalized_email IS NOT NULL)",
            name="subject_identity",
        ),
        comment="Frozen Human Input v2 form approval grants resolved from runtime recipients.",
    )
    op.create_index(
        "hiv2_form_grants_form_contact_idx",
        "human_input_v2_form_approver_grants",
        ["form_id", "contact_id"],
    )
    op.create_index(
        "hiv2_form_grants_form_end_user_idx",
        "human_input_v2_form_approver_grants",
        ["form_id", "end_user_id"],
    )
    op.create_index(
        "hiv2_form_grants_form_email_idx",
        "human_input_v2_form_approver_grants",
        ["form_id", "normalized_email"],
    )

    op.create_table(
        "human_input_v2_form_delivery_endpoints",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("form_id", models.types.StringUUID(), nullable=False, comment="Logical human_input_v2_forms.id."),
        sa.Column(
            "approver_grant_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_v2_form_approver_grants.id.",
        ),
        sa.Column("channel", sa.String(length=20), nullable=False, comment="Delivery or interaction channel."),
        sa.Column("address_hash", sa.String(length=64), nullable=False, comment="Canonical endpoint SHA-256."),
        sa.Column("email_address", sa.String(length=320), nullable=True, comment="Frozen Email endpoint address."),
        sa.Column("integration_id", models.types.StringUUID(), nullable=True, comment="Logical IM integration id."),
        sa.Column("provider", sa.String(length=20), nullable=True, comment="Frozen IM provider."),
        sa.Column("provider_user_id", sa.String(length=255), nullable=True, comment="Frozen provider user id."),
        sa.Column("provider_tenant_id", sa.String(length=255), nullable=True, comment="Frozen provider tenant id."),
        sa.Column("im_identity_id", models.types.StringUUID(), nullable=True, comment="Historical IM identity id."),
        sa.Column("im_binding_id", models.types.StringUUID(), nullable=True, comment="Historical IM binding id."),
        sa.Column("access_token_hash", sa.String(length=64), nullable=True, comment="Hashed endpoint capability."),
        *_default_fields("human_input_v2_form_delivery_endpoints"),
        sa.UniqueConstraint(
            "form_id",
            "approver_grant_id",
            "channel",
            "address_hash",
            name="hiv2_form_endpoints_grant_channel_address_uq",
        ),
        sa.UniqueConstraint("access_token_hash", name="hiv2_form_endpoints_token_uq"),
        comment="Immutable notification and interaction endpoints for Human Input v2 approver grants.",
    )
    op.create_index(
        "hiv2_form_endpoints_identity_form_idx",
        "human_input_v2_form_delivery_endpoints",
        ["im_identity_id", "form_id"],
    )

    op.create_table(
        "human_input_v2_form_delivery_attempts",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("form_id", models.types.StringUUID(), nullable=False, comment="Logical human_input_v2_forms.id."),
        sa.Column(
            "endpoint_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_v2_form_delivery_endpoints.id.",
        ),
        sa.Column("attempt_number", sa.Integer(), nullable=False, comment="One-based endpoint retry sequence."),
        sa.Column("status", sa.String(length=20), nullable=False, comment="Delivery attempt lifecycle."),
        sa.Column("scheduled_at", sa.DateTime(), nullable=False, comment="Eligibility timestamp."),
        sa.Column("started_at", sa.DateTime(), nullable=True, comment="Provider delivery start timestamp."),
        sa.Column("finished_at", sa.DateTime(), nullable=True, comment="Terminal timestamp."),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True, comment="Provider message id."),
        sa.Column("failure_code", sa.String(length=100), nullable=True, comment="Failure code."),
        sa.Column("failure_reason", models.types.LongText(), nullable=True, comment="Failure diagnostic."),
        sa.Column("provider_response", models.types.LongText(), nullable=True, comment="Provider response JSON."),
        *_default_fields("human_input_v2_form_delivery_attempts"),
        sa.UniqueConstraint("endpoint_id", "attempt_number", name="hiv2_form_attempts_endpoint_number_uq"),
        comment="Append-oriented delivery attempts for Human Input v2 form endpoints.",
    )
    op.create_index(
        "hiv2_form_attempts_form_status_created_idx",
        "human_input_v2_form_delivery_attempts",
        ["form_id", "status", "created_at", "id"],
    )
    op.create_index(
        "hiv2_form_attempts_status_scheduled_idx",
        "human_input_v2_form_delivery_attempts",
        ["status", "scheduled_at", "id"],
    )

    op.create_table(
        "human_input_v2_form_upload_tokens",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("app_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to apps.id."),
        sa.Column("form_id", models.types.StringUUID(), nullable=False, comment="Logical human_input_v2_forms.id."),
        sa.Column(
            "endpoint_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_v2_form_delivery_endpoints.id.",
        ),
        sa.Column("upload_token_hash", sa.String(length=64), nullable=False, comment="Hashed upload capability."),
        *_default_fields("human_input_v2_form_upload_tokens"),
        sa.UniqueConstraint("upload_token_hash", name="hiv2_form_upload_tokens_hash_uq"),
        comment="Hashed endpoint-scoped upload capabilities for Human Input v2 forms.",
    )
    op.create_index(
        "hiv2_form_upload_tokens_form_endpoint_idx",
        "human_input_v2_form_upload_tokens",
        ["form_id", "endpoint_id"],
    )

    op.create_table(
        "human_input_v2_form_upload_files",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column("app_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to apps.id."),
        sa.Column("form_id", models.types.StringUUID(), nullable=False, comment="Logical human_input_v2_forms.id."),
        sa.Column(
            "endpoint_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_v2_form_delivery_endpoints.id.",
        ),
        sa.Column("upload_file_id", models.types.StringUUID(), nullable=False, comment="Logical upload_files.id."),
        sa.Column(
            "upload_token_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_v2_form_upload_tokens.id.",
        ),
        *_default_fields("human_input_v2_form_upload_files"),
        sa.UniqueConstraint("upload_file_id", name="hiv2_form_upload_files_file_uq"),
        comment="Durable Human Input v2 form, endpoint, upload-token, and file associations.",
    )
    op.create_index(
        "hiv2_form_upload_files_form_endpoint_idx",
        "human_input_v2_form_upload_files",
        ["form_id", "endpoint_id"],
    )
    op.create_index(
        "hiv2_form_upload_files_token_idx",
        "human_input_v2_form_upload_files",
        ["upload_token_id"],
    )


def downgrade() -> None:
    op.drop_table("human_input_v2_form_upload_files")
    op.drop_table("human_input_v2_form_upload_tokens")
    op.drop_table("human_input_v2_form_delivery_attempts")
    op.drop_table("human_input_v2_form_delivery_endpoints")
    op.drop_table("human_input_v2_form_approver_grants")
    op.drop_table("human_input_v2_forms")
    op.drop_table("human_input_email_providers")

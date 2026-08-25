"""add human input v2 im control plane

Revision ID: 6d9f2b4c5e7a
Revises: 5c8f1a2b3d4e
Create Date: 2026-07-25 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "6d9f2b4c5e7a"
down_revision = "5c8f1a2b3d4e"
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
        "human_input_im_integrations",
        sa.Column("provider", sa.String(length=20), nullable=False, comment="Configured IM provider discriminator."),
        sa.Column(
            "encrypted_credentials",
            models.types.LongText(),
            nullable=False,
            comment="Versioned opaque encrypted IM credential envelope serialized as JSON text.",
        ),
        sa.Column(
            "tenant_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical tenants.id owner in CE/SaaS; null for an EE deployment-wide integration.",
        ),
        sa.Column(
            "provider_tenant_id",
            sa.String(length=255),
            nullable=False,
            comment="Confirmed provider-side organization or workspace identity.",
        ),
        sa.Column(
            "app_identifier",
            sa.String(length=255),
            nullable=False,
            comment="Safe provider application identifier used by credential-free channel projections.",
        ),
        sa.Column("status", sa.String(length=20), nullable=False, comment="Last connectivity diagnostic status."),
        sa.Column(
            "config_version",
            sa.Integer(),
            nullable=False,
            comment="Monotonic configuration revision used with the integration ID for CAS.",
        ),
        sa.Column(
            "configured_by_account_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical accounts.id for the latest configuration writer.",
        ),
        sa.Column("callback_url", sa.String(length=1024), nullable=True, comment="Configured callback URL."),
        sa.Column(
            "safe_status_reason",
            models.types.LongText(),
            nullable=True,
            comment="Operator-safe connection diagnostic.",
        ),
        sa.Column("last_checked_at", sa.DateTime(), nullable=True, comment="Latest connectivity check timestamp."),
        *_default_fields("human_input_im_integrations"),
        sa.UniqueConstraint("tenant_id", name="human_input_im_integrations_tenant_uq"),
        sa.CheckConstraint("config_version > 0", name="config_version_positive"),
        comment="Organization-level Human Input IM integration configuration.",
    )

    op.create_table(
        "human_input_im_identities",
        sa.Column(
            "integration_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_im_integrations.id owner.",
        ),
        sa.Column("provider", sa.String(length=20), nullable=False, comment="Provider identity discriminator."),
        sa.Column(
            "provider_user_id", sa.String(length=255), nullable=False, comment="Provider user matching identity."
        ),
        sa.Column("display_name", sa.String(length=255), nullable=True, comment="Latest provider display name."),
        sa.Column("normalized_name", sa.String(length=255), nullable=True, comment="Case-folded provider name."),
        sa.Column("email", sa.String(length=320), nullable=True, comment="Latest provider email."),
        sa.Column(
            "normalized_email", sa.String(length=320), nullable=True, comment="Case-folded fallback matching email."
        ),
        sa.Column(
            "raw_payload",
            models.types.LongText(),
            nullable=False,
            comment="Opaque provider payload serialized as JSON text for diagnostics.",
        ),
        sa.Column(
            "last_seen_sync_run_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical human_input_im_sync_runs.id that last observed this identity.",
        ),
        sa.Column("last_seen_at", sa.DateTime(), nullable=True, comment="Timestamp last observed."),
        *_default_fields("human_input_im_identities"),
        sa.UniqueConstraint(
            "integration_id",
            "provider",
            "provider_user_id",
            name="human_input_im_identities_integration_provider_user_uq",
        ),
        sa.CheckConstraint(
            "(email IS NULL AND normalized_email IS NULL) OR (email IS NOT NULL AND normalized_email IS NOT NULL)",
            name="email_normalization_pair",
        ),
        comment="Current synchronized IM directory identities.",
    )
    op.create_index(
        "hiimi_integration_provider_email_idx",
        "human_input_im_identities",
        ["integration_id", "provider", "normalized_email"],
    )
    op.create_index(
        "hiimi_integration_provider_name_idx",
        "human_input_im_identities",
        ["integration_id", "provider", "normalized_name"],
    )
    op.create_index(
        "hiimi_integration_last_seen_run_idx",
        "human_input_im_identities",
        ["integration_id", "last_seen_sync_run_id"],
    )

    op.create_table(
        "human_input_im_bindings",
        sa.Column(
            "integration_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_im_integrations.id owner.",
        ),
        sa.Column("scope", sa.String(length=20), nullable=False, comment="Organization or workspace scope."),
        sa.Column("scope_id", models.types.StringUUID(), nullable=False, comment="Scope owner identity."),
        sa.Column("contact_id", models.types.StringUUID(), nullable=False, comment="Logical human_input_contacts.id."),
        sa.Column(
            "im_identity_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_im_identities.id.",
        ),
        sa.Column("provider", sa.String(length=20), nullable=False, comment="Denormalized provider discriminator."),
        sa.Column(
            "bound_by_account_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical accounts.id for an administrative override.",
        ),
        *_default_fields("human_input_im_bindings"),
        sa.UniqueConstraint(
            "scope",
            "scope_id",
            "contact_id",
            "provider",
            name="human_input_im_bindings_scope_contact_provider_uq",
        ),
        sa.UniqueConstraint("scope", "scope_id", "im_identity_id", name="human_input_im_bindings_scope_identity_uq"),
        sa.CheckConstraint(
            "scope <> 'organization' OR scope_id = integration_id",
            name="organization_scope_owner",
        ),
        comment="Current organization binding or workspace override.",
    )
    op.create_index(
        "hiimb_integration_contact_provider_scope_idx",
        "human_input_im_bindings",
        ["integration_id", "contact_id", "provider", "scope", "scope_id"],
    )
    op.create_index(
        "hiimb_identity_scope_idx",
        "human_input_im_bindings",
        ["im_identity_id", "scope", "scope_id"],
    )

    op.create_table(
        "human_input_im_sync_runs",
        sa.Column(
            "integration_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_im_integrations.id owner.",
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
            models.types.StringUUID(),
            nullable=True,
            comment="Logical accounts.id for the trigger actor.",
        ),
        sa.Column("started_at", sa.DateTime(), nullable=True, comment="Worker start timestamp."),
        sa.Column("finished_at", sa.DateTime(), nullable=True, comment="Terminal timestamp."),
        sa.Column("error_code", sa.String(length=100), nullable=True, comment="Machine-readable terminal error."),
        sa.Column("error_message", models.types.LongText(), nullable=True, comment="Operator-safe terminal error."),
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
            models.types.StringUUID(),
            nullable=False,
            comment="Denormalized logical human_input_im_integrations.id.",
        ),
        sa.Column(
            "sync_run_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical human_input_im_sync_runs.id.",
        ),
        sa.Column("result_type", sa.String(length=20), nullable=False, comment="Stable result bucket."),
        sa.Column("provider_user_id", sa.String(length=255), nullable=True, comment="Observed provider user ID."),
        sa.Column("display_name", sa.String(length=255), nullable=True, comment="Observed provider display name."),
        sa.Column("email", sa.String(length=320), nullable=True, comment="Observed provider email."),
        sa.Column("normalized_email", sa.String(length=320), nullable=True, comment="Normalized matching email."),
        sa.Column(
            "contact_id", models.types.StringUUID(), nullable=True, comment="Historical logical Contact identity."
        ),
        sa.Column(
            "im_identity_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Historical logical IM identity.",
        ),
        sa.Column("im_binding_id", models.types.StringUUID(), nullable=True, comment="Historical logical IM binding."),
        sa.Column("removal_reason", sa.String(length=32), nullable=True, comment="Stable removal reason."),
        sa.Column("reason_code", sa.String(length=100), nullable=True, comment="Machine-readable diagnostic reason."),
        sa.Column("reason_message", models.types.LongText(), nullable=True, comment="Operator-safe diagnostic."),
        sa.Column(
            "directory_entry_payload",
            models.types.LongText(),
            nullable=True,
            comment="Immutable provider entry JSON observed by this run.",
        ),
        sa.Column(
            "contact_snapshot",
            models.types.LongText(),
            nullable=True,
            comment="Immutable Contact display snapshot JSON.",
        ),
        sa.Column(
            "identity_snapshot",
            models.types.LongText(),
            nullable=True,
            comment="Immutable removed identity snapshot JSON.",
        ),
        *_default_fields("human_input_im_sync_results"),
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


def downgrade() -> None:
    op.drop_table("human_input_im_sync_results")
    op.drop_table("human_input_im_sync_runs")
    op.drop_table("human_input_im_bindings")
    op.drop_table("human_input_im_identities")
    op.drop_table("human_input_im_integrations")

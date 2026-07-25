"""add human input v2 submission runtime

Revision ID: ad4f6b8c2e1d
Revises: 9c2e5f7a1b3d
Create Date: 2026-07-25 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "ad4f6b8c2e1d"
down_revision = "9c2e5f7a1b3d"
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
        "human_input_v2_form_audit_events",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column(
            "form_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_v2_forms.id.",
        ),
        sa.Column("event_type", sa.String(length=64), nullable=False, comment="Stable append-only event name."),
        sa.Column("occurred_at", sa.DateTime(), nullable=False, comment="Business timestamp for the audited fact."),
        sa.Column(
            "approver_grant_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to human_input_v2_form_approver_grants.id.",
        ),
        sa.Column(
            "endpoint_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to human_input_v2_form_delivery_endpoints.id.",
        ),
        sa.Column("channel", sa.String(length=20), nullable=True, comment="Originating interaction channel."),
        sa.Column("reason_code", sa.String(length=100), nullable=True, comment="Stable rejection reason code."),
        sa.Column("reason_message", models.types.LongText(), nullable=True, comment="Operator-safe diagnostic detail."),
        sa.Column(
            "authorization_proof",
            models.types.LongText(),
            nullable=True,
            comment="Secret-free verified proof serialized as structured JSON text.",
        ),
        sa.Column(
            "event_payload",
            models.types.LongText(),
            nullable=True,
            comment="Immutable event-specific structured JSON text.",
        ),
        *_default_fields("human_input_v2_form_audit_events"),
        sa.CheckConstraint(
            "event_type <> 'submission_authorized' OR "
            "(approver_grant_id IS NOT NULL AND authorization_proof IS NOT NULL)",
            name="hiv2_form_audit_authorized_proof_ck",
        ),
        sa.CheckConstraint(
            "event_type <> 'submission_rejected' OR reason_code IS NOT NULL",
            name="hiv2_form_audit_rejection_reason_ck",
        ),
        comment="Append-only Human Input v2 audit facts for proof sessions and submission authorization.",
    )
    op.create_index(
        "hiv2_form_audit_form_occurred_idx",
        "human_input_v2_form_audit_events",
        ["form_id", "occurred_at", "id"],
    )
    op.create_index(
        "hiv2_form_audit_tenant_occurred_idx",
        "human_input_v2_form_audit_events",
        ["tenant_id", "occurred_at", "id"],
    )

    op.create_table(
        "human_input_v2_form_submissions",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False, comment="Logical foreign key to tenants.id."),
        sa.Column(
            "form_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_v2_forms.id.",
        ),
        sa.Column(
            "approver_grant_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to human_input_v2_form_approver_grants.id.",
        ),
        sa.Column("actor_type", sa.String(length=20), nullable=False, comment="Submission actor discriminator."),
        sa.Column(
            "authorization_audit_event_id",
            models.types.StringUUID(),
            nullable=False,
            comment="Logical foreign key to the authorized human_input_v2_form_audit_events.id.",
        ),
        sa.Column(
            "selected_action_id",
            sa.String(length=200),
            nullable=False,
            comment="Selected action from the frozen form definition.",
        ),
        sa.Column(
            "input_snapshot",
            models.types.LongText(),
            nullable=False,
            comment="Unvalidated request.inputs object serialized as structured JSON text.",
        ),
        sa.Column(
            "canonical_values",
            models.types.LongText(),
            nullable=False,
            comment="Validated runtime values serialized as structured JSON text.",
        ),
        sa.Column("submitted_at", sa.DateTime(), nullable=False, comment="Winning commit business timestamp."),
        sa.Column(
            "actor_account_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical accounts.id for an Account actor.",
        ),
        sa.Column(
            "actor_end_user_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical end_users.id for an EndUser actor.",
        ),
        sa.Column(
            "actor_normalized_email",
            sa.String(length=320),
            nullable=True,
            comment="Normalized EmailAddress actor identity.",
        ),
        sa.Column(
            "endpoint_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical foreign key to human_input_v2_form_delivery_endpoints.id.",
        ),
        *_default_fields("human_input_v2_form_submissions"),
        sa.UniqueConstraint("form_id", name="hiv2_form_submissions_form_uq"),
        sa.UniqueConstraint(
            "authorization_audit_event_id",
            name="hiv2_submission_authorization_audit_event_uq",
        ),
        sa.CheckConstraint(
            "(actor_type = 'account' AND actor_account_id IS NOT NULL AND actor_end_user_id IS NULL "
            "AND actor_normalized_email IS NULL) OR "
            "(actor_type = 'end_user' AND actor_account_id IS NULL AND actor_end_user_id IS NOT NULL "
            "AND actor_normalized_email IS NULL) OR "
            "(actor_type = 'email_address' AND actor_account_id IS NULL AND actor_end_user_id IS NULL "
            "AND actor_normalized_email IS NOT NULL)",
            name="hiv2_form_submissions_actor_identity_ck",
        ),
        comment="Immutable first successful Human Input v2 submission and business actor.",
    )
    op.create_index(
        "hiv2_form_submissions_tenant_submitted_idx",
        "human_input_v2_form_submissions",
        ["tenant_id", "submitted_at", "id"],
    )


def downgrade() -> None:
    op.drop_table("human_input_v2_form_submissions")
    op.drop_table("human_input_v2_form_audit_events")

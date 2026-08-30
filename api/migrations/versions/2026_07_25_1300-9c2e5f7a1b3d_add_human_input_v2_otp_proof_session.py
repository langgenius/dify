"""add human input v2 otp proof session

Revision ID: 9c2e5f7a1b3d
Revises: 8a1c4e7f9b2d
Create Date: 2026-07-25 13:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "9c2e5f7a1b3d"
down_revision = "8a1c4e7f9b2d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "human_input_v2_form_otp_challenges",
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
        sa.Column("subject_type", sa.String(length=20), nullable=False, comment="OTP proof subject discriminator."),
        sa.Column(
            "challenge_token_hash",
            sa.String(length=64),
            nullable=False,
            comment="SHA-256 hash of the ephemeral challenge token.",
        ),
        sa.Column(
            "code_hash",
            sa.String(length=255),
            nullable=False,
            comment="Slow password hash of the one-time verification code.",
        ),
        sa.Column(
            "code_hash_algorithm",
            sa.String(length=50),
            nullable=False,
            comment="Verifier algorithm discriminator for code_hash.",
        ),
        sa.Column("email_hash", sa.String(length=64), nullable=False, comment="SHA-256 of the normalized Email."),
        sa.Column("email", sa.String(length=320), nullable=False, comment="Normalized destination Email."),
        sa.Column("status", sa.String(length=20), nullable=False, comment="Current proof-session usability."),
        sa.Column("expires_at", sa.DateTime(), nullable=False, comment="Challenge expiration timestamp."),
        sa.Column("resend_after", sa.DateTime(), nullable=False, comment="Earliest replacement timestamp."),
        sa.Column(
            "contact_id",
            models.types.StringUUID(),
            nullable=True,
            comment="Logical human_input_contact_identities.id captured for a Contact incarnation.",
        ),
        sa.Column("send_count", sa.Integer(), nullable=False, comment="One-based send count for the grant scope."),
        sa.Column("attempt_count", sa.Integer(), nullable=False, comment="Consumed verification attempts."),
        sa.Column("verified_at", sa.DateTime(), nullable=True, comment="Successful verification timestamp."),
        sa.Column("invalidated_at", sa.DateTime(), nullable=True, comment="Replacement or stale-identity timestamp."),
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="human_input_v2_form_otp_challenges_pkey"),
        sa.UniqueConstraint("challenge_token_hash", name="hiv2_form_otp_challenges_token_uq"),
        sa.CheckConstraint(
            "(subject_type = 'contact' AND contact_id IS NOT NULL) OR "
            "(subject_type = 'email_address' AND contact_id IS NULL)",
            name="hiv2_form_otp_challenges_subject_identity_ck",
        ),
        sa.CheckConstraint(
            "send_count >= 1 AND send_count <= 5",
            name="hiv2_form_otp_challenges_send_count_ck",
        ),
        sa.CheckConstraint(
            "attempt_count >= 0 AND attempt_count <= 5",
            name="hiv2_form_otp_challenges_attempt_count_ck",
        ),
        sa.CheckConstraint(
            "(status = 'verified' AND verified_at IS NOT NULL AND invalidated_at IS NULL) OR "
            "(status = 'invalidated' AND verified_at IS NULL AND invalidated_at IS NOT NULL) OR "
            "(status IN ('pending', 'expired') AND verified_at IS NULL AND invalidated_at IS NULL)",
            name="hiv2_form_otp_challenges_terminal_timestamps_ck",
        ),
        comment="Hashed OTP proof sessions for Email-based Human Input v2 approval.",
    )
    op.create_index(
        "hiv2_form_otp_scope_created_idx",
        "human_input_v2_form_otp_challenges",
        ["tenant_id", "form_id", "approver_grant_id", "created_at", "id"],
    )


def downgrade() -> None:
    op.drop_table("human_input_v2_form_otp_challenges")

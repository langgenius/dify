"""add one-shot Builder real-call consents

Revision ID: d82f9a6c31e0
Revises: c84e6a217b90
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, StringUUID

revision = "d82f9a6c31e0"
down_revision = "c84e6a217b90"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dify_builder_real_call_consents",
        sa.Column("id", StringUUID(), nullable=False),
        *(
            sa.Column(name, StringUUID(), nullable=False)
            for name in (
                "tenant_id",
                "app_id",
                "workflow_id",
                "actor_id",
                "session_id",
                "prepared_commit_id",
                "test_input_id",
            )
        ),
        sa.Column("prepared_version", sa.Integer(), nullable=False),
        sa.Column("binding", AdjustedJSON(), nullable=False),
        sa.Column("scope_digest", sa.String(64), nullable=False),
        sa.Column("disclosure", AdjustedJSON(), nullable=False),
        sa.Column("disclosure_digest", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("decision", sa.String(16), nullable=True),
        sa.Column("execution_request_id", StringUUID(), nullable=True),
        sa.Column("command_id", StringUUID(), nullable=True),
        sa.Column("reserved_version", sa.Integer(), nullable=True),
        sa.Column("reserved_commit_id", StringUUID(), nullable=True),
        sa.Column("prepare_key", sa.String(128), nullable=False),
        sa.Column("prepare_body_digest", sa.String(64), nullable=False),
        sa.Column("prepare_receipt", AdjustedJSON(), nullable=False),
        sa.Column("confirm_key", sa.String(128), nullable=True),
        sa.Column("confirm_body_digest", sa.String(64), nullable=True),
        sa.Column("confirm_receipt", AdjustedJSON(), nullable=True),
        sa.Column("execute_key", sa.String(128), nullable=True),
        sa.Column("execute_body_digest", sa.String(64), nullable=True),
        sa.Column("execute_receipt", AdjustedJSON(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("refresh_claimed_at", sa.DateTime(), nullable=True),
        sa.Column("business_claimed_at", sa.DateTime(), nullable=True),
        sa.Column("refresh_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("business_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("initial_credential_revision", sa.String(64), nullable=False),
        sa.Column("derived_credential_revision", sa.String(64), nullable=True),
        sa.Column("oauth_client_revision", sa.String(64), nullable=False),
        sa.Column("native_run_id", StringUUID(), nullable=True),
        sa.Column("native_node_execution_id", sa.String(128), nullable=True),
        sa.Column("outcome_state", sa.String(16), nullable=True),
        sa.Column("reason_code", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.PrimaryKeyConstraint("id", name="dify_builder_real_call_consent_pkey"),
        sa.UniqueConstraint(
            "tenant_id", "actor_id", "session_id", "prepare_key", name="dify_builder_real_call_consent_prepare_key"
        ),
        sa.UniqueConstraint("execution_request_id", name="dify_builder_real_call_consent_request_key"),
        sa.UniqueConstraint("command_id", name="dify_builder_real_call_consent_command_key"),
        sa.CheckConstraint(
            "state IN ('prepared', 'confirmed', 'claimed', 'completed', 'failed', 'unknown', 'declined', "
            "'expired', 'invalidated')",
            name="builder_real_call_consent_state",
        ),
        sa.CheckConstraint(
            "decision IS NULL OR decision IN ('confirm', 'decline')", name="builder_real_call_consent_decision"
        ),
        sa.CheckConstraint(
            "outcome_state IS NULL OR outcome_state IN ('completed', 'failed', 'unknown')",
            name="builder_real_call_consent_outcome",
        ),
        sa.CheckConstraint(
            "(refresh_count = 0 AND refresh_claimed_at IS NULL) "
            "OR (refresh_count = 1 AND refresh_claimed_at IS NOT NULL)",
            name="builder_real_call_consent_refresh_once",
        ),
        sa.CheckConstraint(
            "(business_count = 0 AND business_claimed_at IS NULL) "
            "OR (business_count = 1 AND business_claimed_at IS NOT NULL)",
            name="builder_real_call_consent_business_once",
        ),
        sa.CheckConstraint(
            "claimed_at IS NOT NULL OR (refresh_claimed_at IS NULL AND business_claimed_at IS NULL)",
            name="builder_real_call_consent_phase_after_claim",
        ),
    )
    op.create_index("dify_builder_real_call_consent_session_idx", "dify_builder_real_call_consents", ["session_id"])


def downgrade():
    op.drop_index("dify_builder_real_call_consent_session_idx", table_name="dify_builder_real_call_consents")
    op.drop_table("dify_builder_real_call_consents")

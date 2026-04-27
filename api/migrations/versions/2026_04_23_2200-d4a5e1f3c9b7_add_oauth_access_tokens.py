"""add oauth_access_tokens table

Revision ID: d4a5e1f3c9b7
Revises: 227822d22895, b69ca54b9208, 2a3aebbbf4bb
Create Date: 2026-04-23 22:00:00.000000

Merges the three open heads at time of authoring (add_workflow_comments_table,
add_chatbot_color_theme, add_app_tracing) into a single parent so the new
oauth_access_tokens table sits on a definite linear chain thereafter.

Table stores user-level OAuth bearer tokens minted via the device-flow grant
(difyctl auth login). PAT storage (personal_access_tokens) is a separate
table not added in this migration.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "d4a5e1f3c9b7"
down_revision = ("227822d22895", "b69ca54b9208", "2a3aebbbf4bb")
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "oauth_access_tokens",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
            primary_key=True,
        ),
        sa.Column("subject_email", sa.Text(), nullable=False),
        sa.Column("subject_issuer", sa.Text(), nullable=True),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("device_label", sa.Text(), nullable=False),
        sa.Column("prefix", sa.String(length=8), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=True, unique=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("NOW()"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["accounts.id"],
            name="fk_oauth_access_tokens_account_id",
            ondelete="SET NULL",
        ),
    )

    op.create_index(
        "idx_oauth_subject_email",
        "oauth_access_tokens",
        ["subject_email"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "idx_oauth_account",
        "oauth_access_tokens",
        ["account_id"],
        postgresql_where=sa.text("revoked_at IS NULL AND account_id IS NOT NULL"),
    )
    op.create_index(
        "idx_oauth_client",
        "oauth_access_tokens",
        ["subject_email", "client_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index(
        "idx_oauth_token_hash",
        "oauth_access_tokens",
        ["token_hash"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    # Partial unique index — rotate-in-place keyed on (subject, client, device).
    # The app always writes a non-NULL subject_issuer (account flow uses a
    # sentinel, external-SSO uses the verified IdP issuer); without that the
    # composite key would never collide because Postgres treats NULLs as
    # distinct in unique indices.
    op.create_index(
        "uq_oauth_active_per_device",
        "oauth_access_tokens",
        ["subject_email", "subject_issuer", "client_id", "device_label"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade():
    op.drop_index("uq_oauth_active_per_device", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_token_hash", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_client", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_account", table_name="oauth_access_tokens")
    op.drop_index("idx_oauth_subject_email", table_name="oauth_access_tokens")
    op.drop_table("oauth_access_tokens")

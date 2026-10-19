"""Add account-owned personal access tokens.

Revision ID: b2e4c6d8a013
Revises: f1d3c5b7a902
Create Date: 2026-10-16 12:00:00
"""

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "b2e4c6d8a013"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "personal_access_tokens",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("secret_digest", sa.String(64), nullable=False),
        sa.Column("secret_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("secret_last_four", sa.String(4), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("resource_scope_mode", sa.String(16), nullable=False),
        sa.Column("workspace_scope_mode", sa.String(16), nullable=False),
        sa.Column("creation_key", sa.String(128), nullable=True),
        sa.Column("creation_fingerprint", sa.String(64), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="personal_access_tokens_pkey"),
        sa.UniqueConstraint("account_id", "creation_key", name="personal_access_token_creation_unique"),
        sa.CheckConstraint("resource_scope_mode IN ('all', 'selected', 'none')", name="pat_resource_scope_mode"),
        sa.CheckConstraint("workspace_scope_mode IN ('all', 'selected', 'none')", name="pat_workspace_scope_mode"),
        sa.CheckConstraint("version >= 1", name="pat_version"),
    )
    op.create_index("personal_access_token_account_idx", "personal_access_tokens", ["account_id"])
    op.create_index("personal_access_token_digest_idx", "personal_access_tokens", ["secret_digest"], unique=True)
    op.create_table(
        "personal_access_token_resources",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("token_id", StringUUID(), nullable=False),
        sa.Column("resource_id", StringUUID(), nullable=False),
        sa.Column("resource_type", sa.String(16), nullable=False),
        sa.Column("workspace_id", StringUUID(), nullable=False),
        sa.Column("display_name_snapshot", sa.Text(), nullable=False),
        sa.Column("workspace_name_snapshot", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="personal_access_token_resources_pkey"),
        sa.UniqueConstraint("token_id", "resource_type", "resource_id", name="personal_access_token_resource_unique"),
        sa.CheckConstraint("resource_type IN ('app', 'dataset', 'app_runner')", name="pat_resource_type"),
    )
    op.create_index("personal_access_token_resource_token_idx", "personal_access_token_resources", ["token_id"])
    op.create_table(
        "personal_access_token_workspaces",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("token_id", StringUUID(), nullable=False),
        sa.Column("workspace_id", StringUUID(), nullable=False),
        sa.Column("display_name_snapshot", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="personal_access_token_workspaces_pkey"),
        sa.UniqueConstraint("token_id", "workspace_id", name="personal_access_token_workspace_unique"),
    )
    op.create_index("personal_access_token_workspace_token_idx", "personal_access_token_workspaces", ["token_id"])


def downgrade() -> None:
    op.drop_table("personal_access_token_workspaces")
    op.drop_table("personal_access_token_resources")
    op.drop_table("personal_access_tokens")

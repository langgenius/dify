"""add knowledge-agent connections for personal agents over MCP

Revision ID: 6b1d2f4e8a90
Revises: 53c10126d551
Create Date: 2026-11-10 12:00:00.000000

Personal agents (Claude Code, Codex, any MCP client) read Agent Knowledge Bases as a member.
A connection is an OAuth authorization of one MCP client or one personal token, in one
workspace, for the knowledge bases chosen for it. Its bearer is a ``dfok_`` row of
``oauth_access_tokens`` (new nullable ``knowledge_agent_grant_id``), so it stays in the account's
token list and revocation path. Knowledge bases get a ``personal_agent_enabled`` switch that
defaults to allowed; workspaces get a switch that defaults to allowed (no row).

Cross-dialect notes follow ``d4a5e1f3c9b7``: UUIDs are ``StringUUID``; indexed text is bounded
``VARCHAR`` (a metadata-document client id is a URL up to 2 KiB, so it is unique by its hash).
"""

import sqlalchemy as sa
from alembic import op

import models

revision = "6b1d2f4e8a90"
down_revision = "53c10126d551"
branch_labels = None
depends_on = None


def _id_kwargs() -> dict:
    kwargs: dict = {"nullable": False}
    if op.get_bind().dialect.name == "postgresql":
        kwargs["server_default"] = sa.text("uuidv7()")
    return kwargs


def upgrade():
    op.create_table(
        "knowledge_agent_clients",
        sa.Column("id", models.types.StringUUID(), **_id_kwargs()),
        sa.Column("client_id", models.types.LongText(), nullable=False),
        sa.Column("client_id_hash", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("redirect_uris", models.types.AdjustedJSON(), nullable=False),
        sa.Column("metadata_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="knowledge_agent_client_pkey"),
        sa.UniqueConstraint("client_id_hash", name="knowledge_agent_client_id_hash_uq"),
        sa.CheckConstraint("kind IN ('cimd', 'dcr')", name="knowledge_agent_client_kind_ck"),
    )

    op.create_table(
        "knowledge_agent_grants",
        sa.Column("id", models.types.StringUUID(), **_id_kwargs()),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("client_ref", models.types.StringUUID(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="knowledge_agent_grant_pkey"),
        sa.CheckConstraint("kind IN ('oauth', 'personal')", name="knowledge_agent_grant_kind_ck"),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name="knowledge_agent_grant_account_fk", ondelete="CASCADE"
        ),
    )
    op.create_index("knowledge_agent_grant_account_idx", "knowledge_agent_grants", ["account_id", "tenant_id"])
    op.create_index("knowledge_agent_grant_tenant_idx", "knowledge_agent_grants", ["tenant_id"])

    op.create_table(
        "knowledge_agent_grant_spaces",
        sa.Column("grant_id", models.types.StringUUID(), nullable=False),
        sa.Column("control_space_id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.PrimaryKeyConstraint("grant_id", "control_space_id", name="knowledge_agent_grant_space_pkey"),
        sa.ForeignKeyConstraint(
            ["grant_id"], ["knowledge_agent_grants.id"], name="knowledge_agent_grant_space_grant_fk", ondelete="CASCADE"
        ),
    )

    op.create_table(
        "knowledge_agent_refresh_tokens",
        sa.Column("id", models.types.StringUUID(), **_id_kwargs()),
        sa.Column("grant_id", models.types.StringUUID(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="knowledge_agent_refresh_token_pkey"),
        sa.UniqueConstraint("token_hash", name="knowledge_agent_refresh_token_hash_uq"),
        sa.ForeignKeyConstraint(
            ["grant_id"],
            ["knowledge_agent_grants.id"],
            name="knowledge_agent_refresh_token_grant_fk",
            ondelete="CASCADE",
        ),
    )
    op.create_index("knowledge_agent_refresh_token_grant_idx", "knowledge_agent_refresh_tokens", ["grant_id"])

    op.create_table(
        "knowledge_agent_workspace_settings",
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("updated_by_account_id", models.types.StringUUID(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", name="knowledge_agent_workspace_setting_pkey"),
    )

    with op.batch_alter_table("oauth_access_tokens") as batch_op:
        batch_op.add_column(sa.Column("knowledge_agent_grant_id", models.types.StringUUID(), nullable=True))
        batch_op.create_index("idx_oauth_knowledge_agent_grant", ["knowledge_agent_grant_id"])

    with op.batch_alter_table("knowledge_fs_external_access_policies") as batch_op:
        batch_op.add_column(
            sa.Column("personal_agent_enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False)
        )


def downgrade():
    with op.batch_alter_table("knowledge_fs_external_access_policies") as batch_op:
        batch_op.drop_column("personal_agent_enabled")
    with op.batch_alter_table("oauth_access_tokens") as batch_op:
        batch_op.drop_index("idx_oauth_knowledge_agent_grant")
        batch_op.drop_column("knowledge_agent_grant_id")
    op.drop_table("knowledge_agent_workspace_settings")
    op.drop_index("knowledge_agent_refresh_token_grant_idx", table_name="knowledge_agent_refresh_tokens")
    op.drop_table("knowledge_agent_refresh_tokens")
    op.drop_table("knowledge_agent_grant_spaces")
    op.drop_index("knowledge_agent_grant_tenant_idx", table_name="knowledge_agent_grants")
    op.drop_index("knowledge_agent_grant_account_idx", table_name="knowledge_agent_grants")
    op.drop_table("knowledge_agent_grants")
    op.drop_table("knowledge_agent_clients")

"""Add personal Connections and App/Session selections.

Revision ID: c91e4a7b2d60
Revises: b27e8d49a103
Create Date: 2026-10-21 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import LongText, StringUUID

revision = "c91e4a7b2d60"
down_revision = "b27e8d49a103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "end_user_connections",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=True),
        sa.Column("end_user_id", StringUUID(), nullable=True),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("credential_type", sa.String(20), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("encrypted_credentials", LongText(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("oauth_client_source", sa.String(20), nullable=True),
        sa.Column("oauth_client_configuration_id", StringUUID(), nullable=True),
        sa.Column("oauth_client_id", LongText(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("last_active_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="end_user_connections_pkey"),
        sa.CheckConstraint(
            "(account_id IS NOT NULL AND end_user_id IS NULL) OR (account_id IS NULL AND end_user_id IS NOT NULL)",
            name=sa.schema.conv("end_user_connection_owner_check"),
        ),
        sa.CheckConstraint(
            "credential_type IN ('api-key', 'oauth2')", name=sa.schema.conv("end_user_connection_credential_type_check")
        ),
        sa.CheckConstraint(
            "status IN ('connected', 'reconnect_required', 'invalid')",
            name=sa.schema.conv("end_user_connection_status_check"),
        ),
        sa.CheckConstraint("revision > 0", name=sa.schema.conv("end_user_connection_revision_check")),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("name")).between(1, 100),
            name=sa.schema.conv("end_user_connection_name_check"),
        ),
        sa.CheckConstraint(
            "(credential_type = 'api-key' AND oauth_client_source IS NULL "
            "AND oauth_client_configuration_id IS NULL AND oauth_client_id IS NULL AND expires_at IS NULL) OR "
            "(credential_type = 'oauth2' AND oauth_client_source IS NOT NULL "
            "AND oauth_client_source IN ('workspace', 'platform'))",
            name=sa.schema.conv("end_user_connection_oauth_check"),
        ),
        sa.UniqueConstraint("id", "tenant_id", "provider", name="end_user_connection_scope_key"),
    )
    op.create_index("end_user_connection_account_idx", "end_user_connections", ["tenant_id", "account_id", "id"])
    op.create_index("end_user_connection_end_user_idx", "end_user_connections", ["tenant_id", "end_user_id", "id"])
    op.create_index("end_user_connection_activity_idx", "end_user_connections", ["last_active_at", "id"])

    op.create_table(
        "app_connections",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(255), nullable=False),
        sa.Column("end_user_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("connection_id", StringUUID(), nullable=False),
        sa.Column("source_run_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="app_connections_pkey"),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("node_id")).between(1, 255),
            name=sa.schema.conv("app_connection_node_id_check"),
        ),
        sa.UniqueConstraint("app_id", "end_user_id", "node_id", name="app_connection_selection_key"),
        sa.ForeignKeyConstraint(
            ["connection_id", "tenant_id", "provider"],
            ["end_user_connections.id", "end_user_connections.tenant_id", "end_user_connections.provider"],
            name="app_connection_scope_fkey",
            ondelete="CASCADE",
        ),
    )
    op.create_index("app_connection_connection_idx", "app_connections", ["connection_id"])

    op.create_table(
        "session_connections",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(255), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(255), nullable=False),
        sa.Column("connection_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="session_connections_pkey"),
        sa.CheckConstraint(
            sa.func.char_length(sa.column("node_id")).between(1, 255),
            name=sa.schema.conv("session_connection_node_id_check"),
        ),
        sa.UniqueConstraint("app_id", "session_id", "node_id", name="session_connection_selection_key"),
        sa.ForeignKeyConstraint(
            ["connection_id", "tenant_id", "provider"],
            ["end_user_connections.id", "end_user_connections.tenant_id", "end_user_connections.provider"],
            name="session_connection_scope_fkey",
            ondelete="CASCADE",
        ),
    )
    op.create_index("session_connection_connection_idx", "session_connections", ["connection_id"])


def downgrade() -> None:
    op.drop_table("session_connections")
    op.drop_table("app_connections")
    op.drop_table("end_user_connections")

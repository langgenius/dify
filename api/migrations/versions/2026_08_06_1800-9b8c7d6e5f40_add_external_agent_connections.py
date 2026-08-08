"""add external agent connections

Revision ID: 9b8c7d6e5f40
Revises: e4708db55c1d
Create Date: 2026-08-06 18:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "9b8c7d6e5f40"
down_revision = "e4708db55c1d"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "external_agent_connections",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("encrypted_endpoint", models.types.LongText(), nullable=False),
        sa.Column("endpoint_hash", sa.String(length=64), nullable=False),
        sa.Column("auth_type", sa.String(length=32), server_default=sa.text("'none'"), nullable=False),
        sa.Column("encrypted_bearer_token", models.types.LongText(), nullable=True),
        sa.Column("last_verified_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_connection_pkey"),
    )
    op.create_index(
        "external_agent_connection_tenant_agent_idx",
        "external_agent_connections",
        ["tenant_id", "agent_id"],
    )

    op.create_table(
        "external_agent_config_snapshots",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_config_snapshot_id", models.types.StringUUID(), nullable=False),
        sa.Column("connection_id", models.types.StringUUID(), nullable=False),
        sa.Column("encrypted_agent_card", models.types.LongText(), nullable=False),
        sa.Column("agent_card_hash", sa.String(length=64), nullable=False),
        sa.Column("protocol_version", sa.String(length=32), nullable=False),
        sa.Column("remote_agent_id", sa.String(length=255), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_config_snapshot_pkey"),
        sa.UniqueConstraint(
            "tenant_id",
            "agent_config_snapshot_id",
            name="external_agent_config_snapshot_tenant_config_unique",
        ),
    )
    op.create_index(
        "external_agent_config_snapshot_tenant_agent_idx",
        "external_agent_config_snapshots",
        ["tenant_id", "agent_id"],
    )
    op.create_index(
        "external_agent_config_snapshot_connection_idx",
        "external_agent_config_snapshots",
        ["tenant_id", "connection_id"],
    )


def downgrade():
    op.drop_index(
        "external_agent_config_snapshot_connection_idx",
        table_name="external_agent_config_snapshots",
    )
    op.drop_index(
        "external_agent_config_snapshot_tenant_agent_idx",
        table_name="external_agent_config_snapshots",
    )
    op.drop_table("external_agent_config_snapshots")

    op.drop_index(
        "external_agent_connection_tenant_agent_idx",
        table_name="external_agent_connections",
    )
    op.drop_table("external_agent_connections")

"""add agent domain models

Revision ID: c6a9f4b12d3e
Revises: a4f2d8c9b731
Create Date: 2026-05-18 13:30:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "c6a9f4b12d3e"
down_revision = "a4f2d8c9b731"
branch_labels = None
depends_on = None


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def _uuid_column(name: str, *, nullable: bool = False, primary_key: bool = False) -> sa.Column:
    kwargs = {"nullable": nullable, "primary_key": primary_key}
    if primary_key and _is_pg(op.get_bind()):
        kwargs["server_default"] = sa.text("uuidv7()")
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def upgrade():
    op.create_table(
        "agents",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", models.types.LongText(), nullable=False),
        sa.Column("icon_type", sa.String(length=32), nullable=True),
        sa.Column(
            "icon",
            sa.String(length=255),
            nullable=True,
            comment="Icon payload interpreted by icon_type: emoji character, image file id, or external URL.",
        ),
        sa.Column("icon_background", sa.String(length=255), nullable=True),
        sa.Column("agent_kind", sa.String(length=32), server_default=sa.text("'dify_agent'"), nullable=False),
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=True),
        sa.Column("workflow_id", models.types.StringUUID(), nullable=True),
        sa.Column("workflow_node_id", sa.String(length=255), nullable=True),
        sa.Column("active_config_snapshot_id", models.types.StringUUID(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default=sa.text("'active'"), nullable=False),
        sa.Column(
            "roster_unique_name",
            sa.String(length=255),
            sa.Computed("CASE WHEN scope = 'roster' AND status = 'active' THEN name ELSE NULL END"),
            nullable=True,
        ),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("archived_by", models.types.StringUUID(), nullable=True),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_pkey")),
        sa.UniqueConstraint("tenant_id", "roster_unique_name", name=op.f("agents_tenant_id_key")),
    )
    op.create_index("agent_tenant_updated_at_idx", "agents", ["tenant_id", "updated_at"])
    op.create_index("agent_tenant_scope_idx", "agents", ["tenant_id", "scope"])
    op.create_index("agent_tenant_workflow_id_idx", "agents", ["tenant_id", "workflow_id"])
    op.create_index("agent_tenant_app_id_idx", "agents", ["tenant_id", "app_id"])
    op.create_index("agent_active_config_snapshot_id_idx", "agents", ["active_config_snapshot_id"])

    op.create_table(
        "agent_config_snapshots",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column(
            "config_snapshot",
            models.types.LongText(),
            nullable=False,
            comment="Serialized services.entities.agent_entities.AgentSoulConfig JSON.",
        ),
        sa.Column("summary", models.types.LongText(), nullable=True),
        sa.Column("version_note", models.types.LongText(), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_config_snapshot_pkey")),
        sa.UniqueConstraint("agent_id", "version", name=op.f("agent_config_snapshot_agent_version_unique")),
    )
    op.create_index(
        "agent_config_snapshot_tenant_agent_created_at_idx",
        "agent_config_snapshots",
        ["tenant_id", "agent_id", "created_at"],
    )
    op.create_index(
        "agent_config_snapshot_tenant_created_at_idx",
        "agent_config_snapshots",
        ["tenant_id", "created_at"],
    )

    op.create_table(
        "workflow_agent_node_bindings",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_id", models.types.StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("binding_type", sa.String(length=32), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=True),
        sa.Column("current_snapshot_id", models.types.StringUUID(), nullable=True),
        sa.Column("node_job_config", models.types.LongText(), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("workflow_agent_node_binding_pkey")),
        sa.UniqueConstraint(
            "tenant_id",
            "workflow_id",
            "node_id",
            name=op.f("workflow_agent_node_binding_node_unique"),
        ),
    )
    op.create_index(
        "workflow_agent_node_binding_agent_idx",
        "workflow_agent_node_bindings",
        ["tenant_id", "agent_id"],
    )
    op.create_index(
        "workflow_agent_node_binding_current_snapshot_idx",
        "workflow_agent_node_bindings",
        ["tenant_id", "current_snapshot_id"],
    )
    op.create_index(
        "workflow_agent_node_binding_app_idx",
        "workflow_agent_node_bindings",
        ["tenant_id", "app_id"],
    )


def downgrade():
    op.drop_index("workflow_agent_node_binding_app_idx", table_name="workflow_agent_node_bindings")
    op.drop_index("workflow_agent_node_binding_current_snapshot_idx", table_name="workflow_agent_node_bindings")
    op.drop_index("workflow_agent_node_binding_agent_idx", table_name="workflow_agent_node_bindings")
    op.drop_table("workflow_agent_node_bindings")

    op.drop_index("agent_config_snapshot_tenant_created_at_idx", table_name="agent_config_snapshots")
    op.drop_index("agent_config_snapshot_tenant_agent_created_at_idx", table_name="agent_config_snapshots")
    op.drop_table("agent_config_snapshots")

    op.drop_index("agent_active_config_snapshot_id_idx", table_name="agents")
    op.drop_index("agent_tenant_app_id_idx", table_name="agents")
    op.drop_index("agent_tenant_workflow_id_idx", table_name="agents")
    op.drop_index("agent_tenant_scope_idx", table_name="agents")
    op.drop_index("agent_tenant_updated_at_idx", table_name="agents")
    op.drop_table("agents")

"""merge skill and agent debug conversation heads

Revision ID: e9f4a1b2c3d5
Revises: a4f8d2c9e1b0, d2825e7b9c10
Create Date: 2026-07-23 15:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

import models

# revision identifiers, used by Alembic.
revision = "e9f4a1b2c3d5"
down_revision = ("a4f8d2c9e1b0", "d2825e7b9c10")
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table_name)


def _is_pg(conn) -> bool:
    return conn.dialect.name == "postgresql"


def _uuid_column(name: str, *, nullable: bool = False, primary_key: bool = False) -> sa.Column:
    kwargs = {"nullable": nullable, "primary_key": primary_key}
    if primary_key and _is_pg(op.get_bind()):
        kwargs["server_default"] = sa.text("uuidv7()")
    return sa.Column(name, models.types.StringUUID(), **kwargs)


def _create_account_step_by_step_tour_states():
    op.create_table(
        "account_step_by_step_tour_states",
        sa.Column("id", models.types.StringUUID(), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=False),
        sa.Column("first_workspace_id", models.types.StringUUID(), nullable=True),
        sa.Column("skipped", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("completed_task_ids", models.types.AdjustedJSON(), nullable=False),
        sa.Column("manually_enabled_workspace_ids", models.types.AdjustedJSON(), nullable=False),
        sa.Column("manually_disabled_workspace_ids", models.types.AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="account_step_by_step_tour_state_pkey"),
        sa.UniqueConstraint("account_id", name="account_step_by_step_tour_state_account_id_key"),
    )


def _create_agents():
    op.create_table(
        "agents",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", models.types.LongText(), nullable=False),
        sa.Column("role", sa.String(length=255), server_default=sa.text("''"), nullable=False),
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
        sa.Column(
            "backing_app_id",
            models.types.StringUUID(),
            nullable=True,
            comment=(
                "Runtime Agent App used for chat/log/monitoring. For workflow-only agents, "
                "app_id remains the parent workflow app id and this points to the hidden backing app."
            ),
        ),
        sa.Column("workflow_id", models.types.StringUUID(), nullable=True),
        sa.Column("workflow_node_id", sa.String(length=255), nullable=True),
        sa.Column("active_config_snapshot_id", models.types.StringUUID(), nullable=True),
        sa.Column("active_config_has_model", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "active_config_is_published",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
            comment=(
                "Whether the normal shared Agent draft has been published into the active config snapshot. "
                "User-scoped debug drafts do not affect this flag."
            ),
        ),
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
    op.create_index("agent_tenant_backing_app_id_idx", "agents", ["tenant_id", "backing_app_id"])
    op.create_index("agent_active_config_snapshot_id_idx", "agents", ["active_config_snapshot_id"])
    op.create_index(
        "agent_tenant_invitable_idx",
        "agents",
        ["tenant_id", "scope", "status", "active_config_has_model", "updated_at"],
    )


def _create_agent_config_snapshots():
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


def _create_agent_config_revisions():
    op.create_table(
        "agent_config_revisions",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("previous_snapshot_id", models.types.StringUUID(), nullable=True),
        sa.Column("current_snapshot_id", models.types.StringUUID(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("operation", sa.String(length=64), nullable=False),
        sa.Column("summary", models.types.LongText(), nullable=True),
        sa.Column("version_note", models.types.LongText(), nullable=True),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_config_revision_pkey")),
        sa.UniqueConstraint(
            "agent_id",
            "revision",
            name=op.f("agent_config_revision_agent_revision_unique"),
        ),
    )
    op.create_index(
        "agent_config_revision_tenant_agent_created_at_idx",
        "agent_config_revisions",
        ["tenant_id", "agent_id", "created_at"],
    )
    op.create_index(
        "agent_config_revision_tenant_current_snapshot_created_at_idx",
        "agent_config_revisions",
        ["tenant_id", "current_snapshot_id", "created_at"],
    )


def _create_workflow_agent_node_bindings():
    op.create_table(
        "workflow_agent_node_bindings",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("app_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_id", models.types.StringUUID(), nullable=False),
        sa.Column("workflow_version", sa.String(length=255), nullable=False),
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
            "workflow_version",
            "node_id",
            name=op.f("workflow_agent_node_binding_node_version_unique"),
        ),
    )
    op.create_index("workflow_agent_node_binding_agent_idx", "workflow_agent_node_bindings", ["tenant_id", "agent_id"])
    op.create_index(
        "workflow_agent_node_binding_current_snapshot_idx",
        "workflow_agent_node_bindings",
        ["tenant_id", "current_snapshot_id"],
    )
    op.create_index("workflow_agent_node_binding_app_idx", "workflow_agent_node_bindings", ["tenant_id", "app_id"])
    op.create_index(
        "workflow_agent_node_binding_workflow_version_idx",
        "workflow_agent_node_bindings",
        ["tenant_id", "workflow_id", "workflow_version"],
    )


def _create_agent_config_drafts():
    op.create_table(
        "agent_config_drafts",
        _uuid_column("id", primary_key=True),
        sa.Column("tenant_id", models.types.StringUUID(), nullable=False),
        sa.Column("agent_id", models.types.StringUUID(), nullable=False),
        sa.Column("draft_type", sa.String(length=32), nullable=False),
        sa.Column("account_id", models.types.StringUUID(), nullable=True),
        sa.Column("draft_owner_key", sa.String(length=255), nullable=False),
        sa.Column("base_snapshot_id", models.types.StringUUID(), nullable=True),
        sa.Column("config_snapshot", models.types.LongText(), nullable=False),
        sa.Column("created_by", models.types.StringUUID(), nullable=True),
        sa.Column("updated_by", models.types.StringUUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("agent_config_draft_pkey")),
        sa.UniqueConstraint(
            "tenant_id",
            "agent_id",
            "draft_type",
            "draft_owner_key",
            name=op.f("agent_config_draft_agent_type_account_unique"),
        ),
    )
    op.create_index("agent_config_draft_tenant_agent_idx", "agent_config_drafts", ["tenant_id", "agent_id"])
    op.create_index("agent_config_draft_base_snapshot_idx", "agent_config_drafts", ["tenant_id", "base_snapshot_id"])


def upgrade():
    if not _has_table("account_step_by_step_tour_states"):
        _create_account_step_by_step_tour_states()
    if not _has_table("agents"):
        _create_agents()
    if not _has_table("agent_config_snapshots"):
        _create_agent_config_snapshots()
    if not _has_table("agent_config_revisions"):
        _create_agent_config_revisions()
    if not _has_table("workflow_agent_node_bindings"):
        _create_workflow_agent_node_bindings()
    if not _has_table("agent_config_drafts"):
        _create_agent_config_drafts()


def downgrade():
    if _has_table("agent_config_drafts"):
        op.drop_table("agent_config_drafts")
    if _has_table("workflow_agent_node_bindings"):
        op.drop_table("workflow_agent_node_bindings")
    if _has_table("agent_config_revisions"):
        op.drop_table("agent_config_revisions")
    if _has_table("agent_config_snapshots"):
        op.drop_table("agent_config_snapshots")
    if _has_table("agents"):
        op.drop_table("agents")
    if _has_table("account_step_by_step_tour_states"):
        op.drop_table("account_step_by_step_tour_states")

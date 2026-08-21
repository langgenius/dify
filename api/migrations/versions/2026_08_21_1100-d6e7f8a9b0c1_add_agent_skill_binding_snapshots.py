"""add published Agent Skill binding snapshots

Revision ID: d6e7f8a9b0c1
Revises: a4f8d2c9e1b0
Create Date: 2026-08-21 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import context, op

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "d6e7f8a9b0c1"
down_revision = "a4f8d2c9e1b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if not _has_table("agent_skill_binding_snapshots"):
        op.create_table(
            "agent_skill_binding_snapshots",
            sa.Column("id", StringUUID(), nullable=False),
            sa.Column("tenant_id", StringUUID(), nullable=False),
            sa.Column("agent_id", StringUUID(), nullable=False),
            sa.Column("config_snapshot_id", StringUUID(), nullable=False),
            sa.Column("skill_id", StringUUID(), nullable=False),
            sa.Column("priority", sa.Integer(), nullable=False),
            sa.Column("created_by", StringUUID(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.PrimaryKeyConstraint("id", name="agent_skill_binding_snapshot_pkey"),
            sa.UniqueConstraint(
                "tenant_id",
                "agent_id",
                "config_snapshot_id",
                "skill_id",
                name="agent_skill_binding_snapshot_skill_unique",
            ),
            sa.UniqueConstraint(
                "tenant_id",
                "agent_id",
                "config_snapshot_id",
                "priority",
                name="agent_skill_binding_snapshot_priority_unique",
            ),
        )

    if not _has_index("agent_skill_binding_snapshots", "agent_skill_binding_snapshots_agent_snapshot_idx"):
        op.create_index(
            "agent_skill_binding_snapshots_agent_snapshot_idx",
            "agent_skill_binding_snapshots",
            ["tenant_id", "agent_id", "config_snapshot_id"],
        )

    op.execute(
        sa.text(
            """
            INSERT INTO agent_skill_binding_snapshots
                (id, tenant_id, agent_id, config_snapshot_id, skill_id, priority, created_by, created_at, updated_at)
            SELECT
                binding.id,
                binding.tenant_id,
                binding.agent_id,
                agent.active_config_snapshot_id,
                binding.skill_id,
                binding.priority,
                binding.created_by,
                binding.created_at,
                binding.updated_at
            FROM agent_skill_bindings AS binding
            JOIN agents AS agent
              ON agent.id = binding.agent_id
             AND agent.tenant_id = binding.tenant_id
            WHERE agent.active_config_snapshot_id IS NOT NULL
              AND agent.active_config_is_published IS TRUE
              AND NOT EXISTS (
                  SELECT 1
                  FROM agent_skill_binding_snapshots AS snapshot_binding
                  WHERE snapshot_binding.id = binding.id
              )
            """
        )
    )


def downgrade() -> None:
    if context.is_offline_mode() or _has_table("agent_skill_binding_snapshots"):
        if context.is_offline_mode() or _has_index(
            "agent_skill_binding_snapshots", "agent_skill_binding_snapshots_agent_snapshot_idx"
        ):
            op.drop_index(
                "agent_skill_binding_snapshots_agent_snapshot_idx",
                table_name="agent_skill_binding_snapshots",
            )
        op.drop_table("agent_skill_binding_snapshots")


def _has_table(table_name: str) -> bool:
    if context.is_offline_mode():
        return False
    return sa.inspect(op.get_bind()).has_table(table_name)


def _has_index(table_name: str, index_name: str) -> bool:
    if context.is_offline_mode() or not _has_table(table_name):
        return False
    return any(index["name"] == index_name for index in sa.inspect(op.get_bind()).get_indexes(table_name))

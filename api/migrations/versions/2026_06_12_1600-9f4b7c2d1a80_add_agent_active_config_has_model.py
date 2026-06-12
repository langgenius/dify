"""add agent active config has model

Revision ID: 9f4b7c2d1a80
Revises: 0b2f2c8a9d1e
Create Date: 2026-06-12 16:00:00.000000

"""

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "9f4b7c2d1a80"
down_revision = "0b2f2c8a9d1e"
branch_labels = None
depends_on = None


def _snapshot_has_model(config_snapshot: Any) -> bool:
    if not config_snapshot:
        return False
    if isinstance(config_snapshot, str):
        try:
            config_snapshot = json.loads(config_snapshot)
        except json.JSONDecodeError:
            return False
    if not isinstance(config_snapshot, dict):
        return False
    return config_snapshot.get("model") is not None


def _backfill_active_config_has_model() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            """
            SELECT a.id AS agent_id, s.config_snapshot AS config_snapshot
            FROM agents a
            JOIN agent_config_snapshots s
              ON s.id = a.active_config_snapshot_id
             AND s.agent_id = a.id
            WHERE a.active_config_snapshot_id IS NOT NULL
            """
        )
    )
    for row in rows:
        if not _snapshot_has_model(row.config_snapshot):
            continue
        conn.execute(
            sa.text("UPDATE agents SET active_config_has_model = :has_model WHERE id = :agent_id"),
            {"agent_id": row.agent_id, "has_model": True},
        )


def upgrade():
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "active_config_has_model",
                sa.Boolean(),
                server_default=sa.text("false"),
                nullable=False,
            )
        )

    _backfill_active_config_has_model()

    op.create_index(
        "agent_tenant_invitable_idx",
        "agents",
        ["tenant_id", "scope", "status", "active_config_has_model", "updated_at"],
    )


def downgrade():
    op.drop_index("agent_tenant_invitable_idx", table_name="agents")
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_column("active_config_has_model")

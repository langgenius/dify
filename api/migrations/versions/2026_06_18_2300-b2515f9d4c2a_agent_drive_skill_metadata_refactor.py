"""agent drive skill metadata refactor

Revision ID: b2515f9d4c2a
Revises: 4f7b2c8d9a10
Create Date: 2026-06-18 23:00:00.000000

"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql
from sqlalchemy.engine.mock import MockConnection

# revision identifiers, used by Alembic.
revision = "b2515f9d4c2a"
down_revision = "4f7b2c8d9a10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_drive_files",
        sa.Column("is_skill", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "agent_drive_files",
        sa.Column("skill_metadata", sa.Text().with_variant(mysql.LONGTEXT(), "mysql"), nullable=True),
    )
    op.create_index(
        "agent_drive_files_tenant_agent_is_skill_key_idx",
        "agent_drive_files",
        ["tenant_id", "agent_id", "is_skill", "key"],
    )
    _remove_skills_files_from_snapshots()


def downgrade() -> None:
    op.drop_index("agent_drive_files_tenant_agent_is_skill_key_idx", table_name="agent_drive_files")
    op.drop_column("agent_drive_files", "skill_metadata")
    op.drop_column("agent_drive_files", "is_skill")


def _remove_skills_files_from_snapshots() -> None:
    connection = op.get_bind()
    if connection is None or isinstance(connection, MockConnection):
        return
    snapshots = sa.table(
        "agent_config_snapshots",
        sa.column("id", sa.String()),
        sa.column("config_snapshot", sa.Text()),
    )
    rows = connection.execute(sa.select(snapshots.c.id, snapshots.c.config_snapshot)).fetchall()
    for row in rows:
        cleaned = _strip_skills_files(row.config_snapshot)
        if cleaned is None:
            continue
        connection.execute(
            snapshots.update()
            .where(snapshots.c.id == row.id)
            .values(config_snapshot=json.dumps(cleaned, separators=(",", ":"), sort_keys=True))
        )


def _strip_skills_files(raw_snapshot: Any) -> dict[str, Any] | None:
    if raw_snapshot is None:
        return None
    if isinstance(raw_snapshot, str):
        snapshot = json.loads(raw_snapshot)
    elif isinstance(raw_snapshot, dict):
        snapshot = dict(raw_snapshot)
    else:
        snapshot = dict(raw_snapshot)
    if not isinstance(snapshot, dict) or "skills_files" not in snapshot:
        return None
    snapshot.pop("skills_files", None)
    return snapshot

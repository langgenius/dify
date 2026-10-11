"""remove agent drive

Revision ID: 89919253ca7a
Revises: 56124e050600
Create Date: 2026-08-17 17:40:52.081816

"""

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "89919253ca7a"
down_revision = "56124e050600"
branch_labels = None
depends_on = None


def _rewrite_json_rows(table_name: str, column_name: str, transform) -> None:
    # Offline SQL generation cannot run this read-modify-write cleanup.
    if op.get_context().as_sql:
        return

    connection = op.get_bind()
    rows = connection.execute(sa.text(f"SELECT id, {column_name} FROM {table_name}"))
    for row_id, raw_value in rows:
        if raw_value is None:
            continue
        value = json.loads(raw_value)
        if not transform(value):
            continue
        connection.execute(
            sa.text(f"UPDATE {table_name} SET {column_name} = :value WHERE id = :id"),
            {"id": row_id, "value": json.dumps(value, ensure_ascii=False, separators=(",", ":"))},
        )


def _remove_soul_files(value: object) -> bool:
    if not isinstance(value, dict) or "files" not in value:
        return False
    del value["files"]
    return True


def _remove_node_job_drive_keys(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    changed = False
    metadata = value.get("metadata")
    if isinstance(metadata, dict):
        file_refs = metadata.get("file_refs")
        if isinstance(file_refs, list):
            for file_ref in file_refs:
                if isinstance(file_ref, dict) and "drive_key" in file_ref:
                    del file_ref["drive_key"]
                    changed = True
    declared_outputs = value.get("declared_outputs")
    if isinstance(declared_outputs, list):
        for output in declared_outputs:
            if not isinstance(output, dict):
                continue
            check = output.get("check")
            if not isinstance(check, dict):
                continue
            benchmark_file_ref = check.get("benchmark_file_ref")
            if isinstance(benchmark_file_ref, dict) and "drive_key" in benchmark_file_ref:
                del benchmark_file_ref["drive_key"]
                changed = True
    return changed


def upgrade() -> None:
    _rewrite_json_rows("agent_config_snapshots", "config_snapshot", _remove_soul_files)
    _rewrite_json_rows("agent_config_drafts", "config_snapshot", _remove_soul_files)
    _rewrite_json_rows("workflow_agent_node_bindings", "node_job_config", _remove_node_job_drive_keys)
    op.drop_table("agent_drive_files")


def downgrade() -> None:
    op.create_table(
        "agent_drive_files",
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("key", sa.String(length=512), nullable=False),
        sa.Column("file_kind", sa.String(length=32), nullable=False),
        sa.Column("file_id", StringUUID(), nullable=False),
        sa.Column("value_owned_by_drive", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_skill", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("skill_metadata", sa.Text().with_variant(mysql.LONGTEXT(), "mysql"), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("hash", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("created_by", StringUUID(), nullable=True),
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="agent_drive_file_pkey"),
        sa.UniqueConstraint("tenant_id", "agent_id", "key", name="agent_drive_file_scope_key_unique"),
    )
    op.create_index(
        "agent_drive_files_tenant_agent_is_skill_key_idx",
        "agent_drive_files",
        ["tenant_id", "agent_id", "is_skill", "key"],
    )

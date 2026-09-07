"""add workspace skill management

Revision ID: a4f8d2c9e1b0
Revises: 925e75620b69
Create Date: 2026-08-24 10:52:00.000000

"""

import sqlalchemy as sa
from alembic import context, op
from sqlalchemy.dialects import mysql

from models.types import StringUUID

# revision identifiers, used by Alembic.
revision = "a4f8d2c9e1b0"
down_revision = "925e75620b69"
branch_labels = None
depends_on = None


def _uuid_column(name: str, *, nullable: bool = False) -> sa.Column:
    return sa.Column(name, StringUUID(), nullable=nullable)


def _long_text() -> sa.types.TypeEngine:
    return sa.Text().with_variant(mysql.LONGTEXT(), "mysql")


def upgrade() -> None:
    if not _has_table("skills"):
        op.create_table(
            "skills",
            _uuid_column("id"),
            _uuid_column("tenant_id"),
            sa.Column("name", sa.String(length=64), nullable=False),
            sa.Column("display_name", sa.String(length=128), nullable=False),
            sa.Column("icon", sa.String(length=16), nullable=False, server_default="📄"),
            sa.Column("description", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("name_manually_edited", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("visibility", sa.String(length=32), nullable=False, server_default="workspace"),
            _uuid_column("latest_published_version_id", nullable=True),
            _uuid_column("created_by", nullable=True),
            _uuid_column("updated_by", nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.PrimaryKeyConstraint("id", name="skill_pkey"),
            sa.UniqueConstraint("tenant_id", "name", name="skill_tenant_name_unique"),
        )
    if not _has_index("skills", "skills_tenant_updated_at_idx"):
        op.create_index("skills_tenant_updated_at_idx", "skills", ["tenant_id", "updated_at"])

    if not _has_table("skill_draft_files"):
        op.create_table(
            "skill_draft_files",
            _uuid_column("id"),
            _uuid_column("skill_id"),
            sa.Column("path", sa.String(length=512), nullable=False),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("storage", sa.String(length=32), nullable=True),
            sa.Column("mime_type", sa.String(length=255), nullable=True),
            sa.Column("content_text", _long_text(), nullable=True),
            _uuid_column("tool_file_id", nullable=True),
            sa.Column("size", sa.BigInteger(), nullable=True),
            sa.Column("hash", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.PrimaryKeyConstraint("id", name="skill_draft_file_pkey"),
            sa.UniqueConstraint("skill_id", "path", name="skill_draft_file_skill_path_unique"),
        )
    if not _has_index("skill_draft_files", "skill_draft_files_skill_path_idx"):
        op.create_index("skill_draft_files_skill_path_idx", "skill_draft_files", ["skill_id", "path"])

    if not _has_table("skill_versions"):
        op.create_table(
            "skill_versions",
            _uuid_column("id"),
            _uuid_column("skill_id"),
            sa.Column("version_number", sa.Integer(), nullable=False),
            sa.Column("version_name", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("publish_note", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("manifest", _long_text(), nullable=False),
            _uuid_column("archive_tool_file_id"),
            sa.Column("hash_code", sa.String(length=255), nullable=False),
            sa.Column("archive_size", sa.BigInteger(), nullable=False),
            _uuid_column("published_by", nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.PrimaryKeyConstraint("id", name="skill_version_pkey"),
            sa.UniqueConstraint("skill_id", "version_number", name="skill_version_skill_number_unique"),
        )
    if not _has_index("skill_versions", "skill_versions_skill_created_at_idx"):
        op.create_index("skill_versions_skill_created_at_idx", "skill_versions", ["skill_id", "created_at"])

    if not _has_table("agent_skill_bindings"):
        op.create_table(
            "agent_skill_bindings",
            _uuid_column("id"),
            _uuid_column("tenant_id"),
            _uuid_column("agent_id"),
            _uuid_column("skill_id"),
            sa.Column("priority", sa.Integer(), nullable=False),
            _uuid_column("created_by", nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
            sa.PrimaryKeyConstraint("id", name="agent_skill_binding_pkey"),
            sa.UniqueConstraint("tenant_id", "agent_id", "skill_id", name="agent_skill_binding_unique"),
            sa.UniqueConstraint("tenant_id", "agent_id", "priority", name="agent_skill_binding_priority_unique"),
        )
    if not _has_index("agent_skill_bindings", "agent_skill_bindings_skill_idx"):
        op.create_index("agent_skill_bindings_skill_idx", "agent_skill_bindings", ["tenant_id", "skill_id"])

    if not _has_table("agent_skill_binding_snapshots"):
        op.create_table(
            "agent_skill_binding_snapshots",
            _uuid_column("id"),
            _uuid_column("tenant_id"),
            _uuid_column("agent_id"),
            _uuid_column("config_snapshot_id"),
            _uuid_column("skill_id"),
            sa.Column("priority", sa.Integer(), nullable=False),
            _uuid_column("created_by", nullable=True),
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
    if context.is_offline_mode() or _has_table("agent_skill_bindings"):
        if context.is_offline_mode() or _has_index("agent_skill_bindings", "agent_skill_bindings_skill_idx"):
            op.drop_index("agent_skill_bindings_skill_idx", table_name="agent_skill_bindings")
        op.drop_table("agent_skill_bindings")
    if context.is_offline_mode() or _has_table("skill_versions"):
        if context.is_offline_mode() or _has_index("skill_versions", "skill_versions_skill_created_at_idx"):
            op.drop_index("skill_versions_skill_created_at_idx", table_name="skill_versions")
        op.drop_table("skill_versions")
    if context.is_offline_mode() or _has_table("skill_draft_files"):
        if context.is_offline_mode() or _has_index("skill_draft_files", "skill_draft_files_skill_path_idx"):
            op.drop_index("skill_draft_files_skill_path_idx", table_name="skill_draft_files")
        op.drop_table("skill_draft_files")
    if context.is_offline_mode() or _has_table("skills"):
        if context.is_offline_mode() or _has_index("skills", "skills_tenant_updated_at_idx"):
            op.drop_index("skills_tenant_updated_at_idx", table_name="skills")
        op.drop_table("skills")


def _has_table(table_name: str) -> bool:
    if context.is_offline_mode():
        return False
    return sa.inspect(op.get_bind()).has_table(table_name)


def _has_index(table_name: str, index_name: str) -> bool:
    if context.is_offline_mode() or not _has_table(table_name):
        return False
    return any(index["name"] == index_name for index in sa.inspect(op.get_bind()).get_indexes(table_name))

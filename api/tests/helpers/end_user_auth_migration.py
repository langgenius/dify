"""Shared parent-schema fixture for the squashed End User revision."""

from importlib import import_module
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from models.types import StringUUID

end_user_auth_revision = import_module("migrations.versions.2026_11_27_1755-6ef794ace1e2_add_end_user_auth")


def _id() -> sa.Column[UUID | str | None]:
    """Return a fresh primary-key column matching the parent identifier type."""
    return sa.Column("id", StringUUID(), primary_key=True)


def create_end_user_parent_schema(bind: Connection) -> sa.MetaData:
    """Create the parent columns and indexes reached by the revision in an empty test schema."""
    schema = sa.MetaData()
    sa.Table(
        "accounts",
        schema,
        _id(),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("initialized_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    sa.Table(
        "tenants",
        schema,
        _id(),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    sa.Table(
        "tenant_account_joins",
        schema,
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
    )
    sa.Table(
        "apps", schema, _id(), sa.Column("tenant_id", StringUUID(), nullable=False), sa.Column("mode", sa.String(255))
    )
    sa.Table(
        "end_users",
        schema,
        _id(),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID()),
        sa.Column("type", sa.String(255), nullable=False),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Index("end_user_session_id_idx", "session_id", "type"),
    )
    sa.Table(
        "workflow_runs",
        schema,
        _id(),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("created_by_role", sa.String(255), nullable=False),
        sa.Column("created_by", StringUUID(), nullable=False),
        sa.Column("triggered_from", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("graph", sa.Text()),
    )
    sa.Table(
        "messages",
        schema,
        _id(),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_run_id", StringUUID()),
        sa.Column("conversation_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime()),
        sa.Index("message_app_id_idx", "app_id", "created_at"),
        sa.Index("message_workflow_run_id_idx", "conversation_id", "workflow_run_id"),
    )
    sa.Table(
        "upload_files",
        schema,
        _id(),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("created_by_role", sa.String(255), nullable=False),
        sa.Column("created_by", StringUUID(), nullable=False),
        sa.Index("upload_file_tenant_idx", "tenant_id"),
    )
    sa.Table(
        "tool_files",
        schema,
        _id(),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("user_id", StringUUID(), nullable=False),
        sa.Column("conversation_id", StringUUID()),
        sa.Index("tool_file_conversation_id_idx", "conversation_id"),
    )
    sa.Table("builtin_tool_providers", schema, _id(), sa.Column("encrypted_credentials", sa.Text()))
    schema.create_all(bind)
    return schema

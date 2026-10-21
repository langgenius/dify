"""activate normalized file-owner backfills

Revision ID: d3f7a9c1e584
Revises: c2e6fab0d795
Create Date: 2026-10-21 14:00:00.000000

The schema revisions retain their bounded, immutable backfill helpers but do
not activate normalized ownership before every file writer and cleaner honors
the shared fence. This data-only revision runs after that runtime closure is
available.
"""

import importlib
from typing import Protocol, cast

import sqlalchemy as sa
from alembic import op

revision = "d3f7a9c1e584"
down_revision = "c2e6fab0d795"
branch_labels = None
depends_on = None

_KNOWLEDGE_FILE_LIFECYCLE_MODULE = "migrations.versions.2026_10_19_1400-f3b9c1e4a826_add_knowledge_file_lifecycle"
_AGENT_UPLOAD_REFERENCE_MODULE = (
    "migrations.versions.2026_10_20_1800-d7f1a5b8c240_add_agent_config_upload_file_references"
)
_AGENT_TOOL_REFERENCE_MODULE = "migrations.versions.2026_10_21_1000-f9b3c7dae462_add_agent_config_tool_file_references"
_REFERENCE_TABLES = (
    "knowledge_upload_file_references",
    "workflow_draft_variable_upload_file_references",
    "agent_config_upload_file_references",
    "agent_config_tool_file_references",
)


class _KnowledgeFileLifecycleRevision(Protocol):
    def _backfill_references(self) -> None: ...


class _AgentConfigReferenceRevision(Protocol):
    def _backfill_owner_table(self, *, table_name: str, owner_kind: str) -> None: ...


def _clear_derived_references() -> None:
    connection = op.get_bind()
    for table_name in _REFERENCE_TABLES:
        connection.execute(sa.delete(sa.table(table_name)))


def _activate_backfills() -> None:
    knowledge_files = cast(
        _KnowledgeFileLifecycleRevision,
        importlib.import_module(_KNOWLEDGE_FILE_LIFECYCLE_MODULE),
    )
    agent_uploads = cast(
        _AgentConfigReferenceRevision,
        importlib.import_module(_AGENT_UPLOAD_REFERENCE_MODULE),
    )
    agent_tools = cast(
        _AgentConfigReferenceRevision,
        importlib.import_module(_AGENT_TOOL_REFERENCE_MODULE),
    )

    knowledge_files._backfill_references()
    for table_name, owner_kind in (
        ("agent_config_drafts", "draft"),
        ("agent_config_snapshots", "snapshot"),
    ):
        agent_uploads._backfill_owner_table(table_name=table_name, owner_kind=owner_kind)
        agent_tools._backfill_owner_table(table_name=table_name, owner_kind=owner_kind)


def upgrade() -> None:
    if op.get_context().as_sql:
        op.execute(
            "-- File-owner backfill activation requires an online upgrade; offline SQL contains no data mutation."
        )
        return
    # These tables are derived projections of current owner state. Rebuilding
    # them makes an interrupted or explicitly repeated activation idempotent.
    _clear_derived_references()
    _activate_backfills()


def downgrade() -> None:
    if op.get_context().as_sql:
        op.execute(
            "-- File-owner backfill deactivation requires an online downgrade; offline SQL contains no data mutation."
        )
        return
    # Earlier runtimes do not maintain these projections. Leaving activated
    # rows behind would keep their restrictive file foreign keys live.
    _clear_derived_references()

"""rename workflow_copilot_* tables to dify_builder_*

Project rename: "Workflow Copilot" -> "Dify Builder". Renames the 7 feature
tables created in b28a1b2fbf4d, plus their primary-key/unique constraints and
indexes, so the schema matches the renamed ORM models (``models.dify_builder``).
Pure metadata renames (ALTER ... RENAME) — no data is moved. Postgres.

Revision ID: df1b0114de40
Revises: b28a1b2fbf4d
Create Date: 2026-08-23 12:00:00.000000
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "df1b0114de40"
down_revision = "b28a1b2fbf4d"
branch_labels = None
depends_on = None

_OLD = "workflow_copilot"
_NEW = "dify_builder"

# (old_table_name, new_table_name)
_TABLES = [
    "workflow_copilot_sessions",
    "workflow_copilot_session_commits",
    "workflow_copilot_snapshots",
    "workflow_copilot_checkpoints",
    "workflow_copilot_runs",
    "workflow_copilot_conversation_items",
    "workflow_copilot_test_inputs",
]

_INDEXES = [
    "workflow_copilot_session_tenant_idx",
    "workflow_copilot_session_app_idx",
    "workflow_copilot_session_commit_session_idx",
    "workflow_copilot_snapshot_session_idx",
    "workflow_copilot_checkpoint_session_idx",
    "workflow_copilot_run_session_idx",
    "workflow_copilot_conversation_item_session_idx",
    "workflow_copilot_test_input_session_idx",
]

# (constraint_name, its_new_table_name)
_CONSTRAINTS = [
    ("workflow_copilot_session_pkey", "dify_builder_sessions"),
    ("workflow_copilot_session_commit_pkey", "dify_builder_session_commits"),
    ("workflow_copilot_snapshot_pkey", "dify_builder_snapshots"),
    ("workflow_copilot_checkpoint_pkey", "dify_builder_checkpoints"),
    ("workflow_copilot_run_pkey", "dify_builder_runs"),
    ("workflow_copilot_conversation_item_pkey", "dify_builder_conversation_items"),
    ("workflow_copilot_conversation_item_session_seq_key", "dify_builder_conversation_items"),
    ("workflow_copilot_test_input_pkey", "dify_builder_test_inputs"),
]


def _rename(old: str) -> str:
    return old.replace(_OLD, _NEW, 1)


def _un_rename(new: str) -> str:
    return new.replace(_NEW, _OLD, 1)


def upgrade():
    # Tables first, so the constraint renames below can reference the new names.
    for old in _TABLES:
        op.rename_table(old, _rename(old))
    for idx in _INDEXES:
        op.execute(f'ALTER INDEX "{idx}" RENAME TO "{_rename(idx)}"')
    for cname, new_table in _CONSTRAINTS:
        op.execute(f'ALTER TABLE "{new_table}" RENAME CONSTRAINT "{cname}" TO "{_rename(cname)}"')


def downgrade():
    for cname, new_table in _CONSTRAINTS:
        op.execute(f'ALTER TABLE "{new_table}" RENAME CONSTRAINT "{_rename(cname)}" TO "{cname}"')
    for idx in _INDEXES:
        op.execute(f'ALTER INDEX "{_rename(idx)}" RENAME TO "{idx}"')
    for old in _TABLES:
        op.rename_table(_rename(old), old)

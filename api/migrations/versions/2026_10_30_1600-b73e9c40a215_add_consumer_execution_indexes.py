"""Index Account App mappings and their latest published executions.

Revision ID: b73e9c40a215
Revises: a91d5e7c3b20
Create Date: 2026-10-30 16:00:00.000000

PostgreSQL builds and drops each index concurrently. A retry preserves
matching healthy indexes and refuses conflicting or abandoned builds.
"""

from alembic import op

from migrations.postgresql_online_v1 import IndexSpec, create_indexes, drop_indexes

revision = "b73e9c40a215"
down_revision = "a91d5e7c3b20"
branch_labels = None
depends_on = None


_INDEXES = (
    IndexSpec("end_users", "end_user_account_apps_idx", ("account_id", "type", "tenant_id", "app_id", "id")),
    IndexSpec(
        "workflow_runs",
        "workflow_run_end_user_recent_idx",
        ("tenant_id", "app_id", "created_by_role", "created_by", "triggered_from", "created_at"),
    ),
)


def upgrade() -> None:
    """Add the lookup indexes on the parent tables without changing any rows."""
    if op.get_bind().dialect.name == "postgresql":
        create_indexes(op, *_INDEXES)
    else:
        for index in _INDEXES:
            op.create_index(index.name, index.table, list(index.columns))


def downgrade() -> None:
    """Remove only these indexes, including after a partially completed PostgreSQL drop."""
    if op.get_bind().dialect.name == "postgresql":
        drop_indexes(op, *reversed(_INDEXES))
    else:
        for index in reversed(_INDEXES):
            op.drop_index(index.name, table_name=index.table)

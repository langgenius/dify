"""Index Guest file ownership without changing resource ownership.

Revision ID: f8c2a6d4e901
Revises: 2c7e9a4b1d60
Create Date: 2026-11-13 12:00:00

PostgreSQL builds and drops indexes concurrently outside the revision transaction.
Online retries reuse matching healthy indexes after partially completed DDL.
An abandoned invalid concurrent build must be inspected and dropped concurrently
before retrying. Offline SQL assumes the starting revision's exact index state.
MySQL uses ordinary index DDL; schedule deployment for its metadata-lock impact.
"""

import sqlalchemy as sa
from alembic import op

revision = "f8c2a6d4e901"
down_revision = "2c7e9a4b1d60"
branch_labels = None
depends_on = None


def _index_exists(table: str, name: str, columns: list[str]) -> bool:
    """Return presence online, rejecting conflicting or unhealthy index definitions.

    Require a live migration connection and an existing table. Raise before DDL
    when a same-name index is unsuitable; leave schema and file rows unchanged.
    """
    bind = op.get_bind()
    index = next((item for item in sa.inspect(bind).get_indexes(table) if item["name"] == name), None)
    if index is None:
        return False
    dialect_options = dict(index.get("dialect_options", {}))
    if dialect_options.get("postgresql_include") == []:
        dialect_options.pop("postgresql_include")
    if index["column_names"] != columns or index["unique"] or dialect_options or index.get("column_sorting"):
        raise RuntimeError(f"Index {name} differs from the required non-unique index on {table}{columns}")
    if bind.dialect.name == "postgresql":
        healthy = bind.scalar(
            sa.text(
                "SELECT i.indisvalid AND i.indisready AND i.indislive "
                "FROM pg_catalog.pg_index i "
                "JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid "
                "WHERE c.relname = :name AND i.indrelid = pg_catalog.to_regclass(:table_name)"
            ),
            {"name": name, "table_name": table},
        )
        if not healthy:
            raise RuntimeError(f"Index {name} is unhealthy; inspect its build status before retrying")
    return True


def _create_index(table: str, name: str, columns: list[str]) -> None:
    """Ensure a matching index exists without changing rows or replacing conflicts.

    Require the table to exist. Reuse healthy indexes online; emit unconditional
    DDL offline. PostgreSQL DDL commits independently, including on later failure.
    """
    if op.get_context().as_sql or not _index_exists(table, name, columns):
        if op.get_bind().dialect.name == "postgresql":
            with op.get_context().autocommit_block():
                op.create_index(name, table, columns, postgresql_concurrently=True)
        else:
            op.create_index(name, table, columns)


def _drop_index(table: str, name: str, columns: list[str]) -> None:
    """Remove only a matching index, preserving rows and rejecting conflicts online.

    Require the table to exist. Missing indexes are a no-op online; offline SQL
    assumes presence. PostgreSQL drops commit independently of the revision stamp.
    """
    if op.get_context().as_sql or _index_exists(table, name, columns):
        if op.get_bind().dialect.name == "postgresql":
            with op.get_context().autocommit_block():
                op.drop_index(name, table_name=table, postgresql_concurrently=True)
        else:
            op.drop_index(name, table_name=table)


def upgrade() -> None:
    """Add owner access paths before removing the covered tenant-only index.

    Require the parent schema or a partially completed online upgrade. Preserve
    all file rows and the conversation index; failures can leave completed DDL.
    """
    _create_index("upload_files", "upload_file_owner_idx", ["tenant_id", "created_by_role", "created_by"])
    _create_index("tool_files", "tool_file_owner_idx", ["tenant_id", "user_id"])
    _drop_index("upload_files", "upload_file_tenant_idx", ["tenant_id"])


def downgrade() -> None:
    """Restore the tenant access path before removing owner indexes.

    Require the upgraded schema or a partially completed online downgrade.
    Preserve all file rows and the conversation index, including on DDL failure.
    """
    _create_index("upload_files", "upload_file_tenant_idx", ["tenant_id"])
    _drop_index("tool_files", "tool_file_owner_idx", ["tenant_id", "user_id"])
    _drop_index("upload_files", "upload_file_owner_idx", ["tenant_id", "created_by_role", "created_by"])

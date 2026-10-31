"""Add reference indexes used by application storage cleanup.

Revision ID: d7e9a1c3f502
Revises: b9d3f7a5c102
Create Date: 2026-10-28 12:00:00

Online upgrades validate and reuse existing indexes, including PostgreSQL validity.
Offline SQL emits unconditional DDL for databases without these indexes. It fails
on existing names instead of silently accepting an invalid or conflicting index;
use online upgrades to reconcile indexes already created by SRE.
Concurrent DDL commits independently of the revision stamp. Retrying preserves
completed indexes. If a build leaves an invalid index, inspect its definition
and ensure no build is still running, then DROP INDEX CONCURRENTLY that specific
invalid index outside a transaction and retry. Never drop a healthy index as a
routine recovery step. Resolve conflicting definitions manually before retrying.
"""

import sqlalchemy as sa
from alembic import op

revision = "d7e9a1c3f502"
down_revision = "b9d3f7a5c102"
branch_labels = None
depends_on = None

INDEXES = (
    ("message_files", "message_file_upload_file_id_idx", "upload_file_id"),
    ("workflow_node_execution_offload", "workflow_node_execution_offload_file_id_idx", "file_id"),
    ("workflow_draft_variable_files", "workflow_draft_variable_files_upload_file_id_idx", "upload_file_id"),
)

# Look up the schema-wide relation name, not just indexes of the expected table:
# a same-name index on another table must also be rejected. Check key options
# explicitly so a different ordering, collation or operator class is not reused.
_PG_INDEX = sa.text("""
    SELECT i.indisvalid, i.indisready, i.indislive,
           t.relname = :table_name AND t.relnamespace = c.relnamespace
           AND c.relkind = 'i' AND am.amname = 'btree'
           AND NOT i.indisunique AND NOT i.indisexclusion
           AND i.indnatts = 1 AND i.indnkeyatts = 1
           AND i.indexprs IS NULL AND i.indpred IS NULL
           AND a.attname = :column_name AND i.indoption[0] = 0
           AND opc.opcdefault AND i.indcollation[0] = a.attcollation AS matches
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
    LEFT JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    LEFT JOIN pg_catalog.pg_am am ON am.oid = c.relam
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    LEFT JOIN pg_catalog.pg_opclass opc ON opc.oid = i.indclass[0]
    WHERE n.nspname = :schema_name AND c.relname = :index_name
""")


def _index_exists(table: str, name: str, column: str, schema: str) -> bool:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        row = (
            bind.execute(
                _PG_INDEX,
                {"schema_name": schema, "table_name": table, "index_name": name, "column_name": column},
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            return False
        valid = all(row[key] for key in ("indisvalid", "indisready", "indislive", "matches"))
    else:
        indexes = sa.inspect(bind).get_indexes(table, schema=schema)
        index = next((index for index in indexes if index["name"] == name), None)
        if index is None:
            return False
        valid = index["column_names"] == [column] and not index["unique"] and not index.get("dialect_options")
    if not valid:
        raise RuntimeError(
            f"Index {schema}.{name} is invalid or differs from the required non-unique btree "
            f"index on {table}({column}). Inspect its definition and build status; resolve "
            "the conflict before retrying. For an abandoned invalid PostgreSQL build, "
            "DROP INDEX CONCURRENTLY outside a transaction, then retry this migration."
        )
    return True


def _schema() -> str:
    schema = sa.inspect(op.get_bind()).default_schema_name
    if schema is None:
        raise RuntimeError("Cannot determine the migration's default schema")
    return schema


def upgrade() -> None:
    offline = op.get_context().as_sql
    schema = None if offline else _schema()
    # Preflight every name before starting any expensive, independently committed DDL.
    missing = [
        (table, name, column)
        for table, name, column in INDEXES
        if schema is None or not _index_exists(table, name, column, schema)
    ]
    for table, name, column in missing:
        if op.get_bind().dialect.name == "postgresql":
            with op.get_context().autocommit_block():
                op.create_index(name, table, [column], schema=schema, postgresql_concurrently=True)
        else:
            op.create_index(name, table, [column], schema=schema)
        if schema is not None and not _index_exists(table, name, column, schema):
            raise RuntimeError(f"Index {schema}.{name} was not created")


def downgrade() -> None:
    schema = None if op.get_context().as_sql else _schema()
    existing = [
        (table, name) for table, name, column in INDEXES if schema is None or _index_exists(table, name, column, schema)
    ]
    for table, name in reversed(existing):
        if op.get_bind().dialect.name == "postgresql":
            with op.get_context().autocommit_block():
                op.drop_index(name, table_name=table, schema=schema, postgresql_concurrently=True)
        else:
            op.drop_index(name, table_name=table, schema=schema)

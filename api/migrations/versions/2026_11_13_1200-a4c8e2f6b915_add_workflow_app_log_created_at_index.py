"""Add the index that serves the newest-first workflow log list.

Revision ID: a4c8e2f6b915
Revises: 8c2f5d7a1e30
Create Date: 2026-11-13 12:00:00

The workflow Logs list filters on tenant and app and orders by ``created_at``.
Without ``created_at`` in an index, every page view reads and sorts all log rows
of the app. A btree on ``(tenant_id, app_id, created_at)`` is scanned backward for
the newest page and forward for date ranges.

Online upgrades validate and reuse an existing index of this name, including
PostgreSQL validity, so installations that already created it by hand are stamped
without rebuilding. Offline SQL emits unconditional DDL and fails on an existing
name instead of silently accepting an invalid or conflicting index.
Concurrent DDL commits independently of the revision stamp. If a build leaves an
invalid index, make sure no build is still running, DROP INDEX CONCURRENTLY that
index outside a transaction, and retry. Resolve a conflicting definition manually
before retrying.
"""

import sqlalchemy as sa
from alembic import op

revision = "a4c8e2f6b915"
down_revision = "8c2f5d7a1e30"
branch_labels = None
depends_on = None

TABLE = "workflow_app_logs"
INDEX = "workflow_app_log_app_created_at_idx"
COLUMNS = ("tenant_id", "app_id", "created_at")

# Look up the schema-wide relation name, not just indexes of the expected table:
# a same-name index on another table must also be rejected. Key columns, ordering
# and operator classes are checked explicitly so a different definition is not reused.
_PG_INDEX = sa.text("""
    SELECT i.indisvalid, i.indisready, i.indislive,
           t.relname = :table_name AND t.relnamespace = c.relnamespace
           AND c.relkind = 'i' AND am.amname = 'btree'
           AND NOT i.indisunique AND NOT i.indisexclusion
           AND i.indnatts = :column_count AND i.indnkeyatts = :column_count
           AND i.indexprs IS NULL AND i.indpred IS NULL
           AND (
               SELECT string_agg(a.attname::text, ',' ORDER BY k.ord)
               FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
           ) = :column_names
           AND (SELECT bool_and(o.flags = 0) FROM unnest(i.indoption::int2[]) AS o(flags))
           AND (
               SELECT bool_and(opc.opcdefault)
               FROM unnest(i.indclass::oid[]) AS cl(opclass)
               JOIN pg_catalog.pg_opclass opc ON opc.oid = cl.opclass
           ) AS matches
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
    LEFT JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
    LEFT JOIN pg_catalog.pg_am am ON am.oid = c.relam
    WHERE n.nspname = :schema_name AND c.relname = :index_name
""")


def _index_exists(schema: str) -> bool:
    """Return whether the required index exists; raise if the name is taken by anything else."""
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        row = (
            bind.execute(
                _PG_INDEX,
                {
                    "schema_name": schema,
                    "table_name": TABLE,
                    "index_name": INDEX,
                    "column_count": len(COLUMNS),
                    "column_names": ",".join(COLUMNS),
                },
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            return False
        valid = all(row[key] for key in ("indisvalid", "indisready", "indislive", "matches"))
    else:
        indexes = sa.inspect(bind).get_indexes(TABLE, schema=schema)
        index = next((index for index in indexes if index["name"] == INDEX), None)
        if index is None:
            return False
        valid = index["column_names"] == list(COLUMNS) and not index["unique"] and not index.get("dialect_options")
    if not valid:
        raise RuntimeError(
            f"Index {schema}.{INDEX} is invalid or differs from the required non-unique btree "
            f"index on {TABLE}({', '.join(COLUMNS)}). Inspect its definition and build status; "
            "resolve the conflict before retrying. For an abandoned invalid PostgreSQL build, "
            "DROP INDEX CONCURRENTLY outside a transaction, then retry this migration."
        )
    return True


def _schema() -> str:
    schema = sa.inspect(op.get_bind()).default_schema_name
    if schema is None:
        raise RuntimeError("Cannot determine the migration's default schema")
    return schema


def upgrade() -> None:
    schema = None if op.get_context().as_sql else _schema()
    if schema is not None and _index_exists(schema):
        return
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.create_index(INDEX, TABLE, list(COLUMNS), schema=schema, postgresql_concurrently=True)
    else:
        op.create_index(INDEX, TABLE, list(COLUMNS), schema=schema)
    if schema is not None and not _index_exists(schema):
        raise RuntimeError(f"Index {schema}.{INDEX} was not created")


def downgrade() -> None:
    schema = None if op.get_context().as_sql else _schema()
    if schema is not None and not _index_exists(schema):
        return
    if op.get_bind().dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.drop_index(INDEX, table_name=TABLE, schema=schema, postgresql_concurrently=True)
    else:
        op.drop_index(INDEX, table_name=TABLE, schema=schema)

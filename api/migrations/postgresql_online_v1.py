"""Frozen PostgreSQL DDL helpers for online, restartable schema revisions.

Call with a single Alembic runner and an existing parent schema. Do not change
matching rules for existing revisions when adding new migration capabilities.
"""

from dataclasses import dataclass

import sqlalchemy as sa
from alembic.operations import Operations
from sqlalchemy.engine import Connection
from sqlalchemy.sql.type_api import TypeEngine

# A relation name can be occupied by an index on a different table (or by a
# table). Resolve names in the schema of the actual target, not current_schema().
_INDEX_STATE = sa.text("""
    SELECT ns.nspname AS schema_name, idx.oid IS NOT NULL AS present,
           ix.indisvalid AND ix.indisready AND ix.indislive AS healthy,
           ix.indrelid = target.oid AND idx.relkind = 'i' AND am.amname = 'btree'
           AND ix.indisunique = :unique AND NOT ix.indisprimary AND NOT ix.indisexclusion
           AND ix.indimmediate AND NOT COALESCE((pg_catalog.to_jsonb(ix) ->> 'indnullsnotdistinct')::boolean, false)
           AND ix.indnatts = ix.indnkeyatts AND ix.indexprs IS NULL AND ix.indpred IS NULL
           AND ARRAY(
               SELECT attr.attname::text
               FROM pg_catalog.generate_series(0, ix.indnkeyatts - 1) AS key(position)
               JOIN pg_catalog.pg_attribute attr ON attr.attrelid = target.oid AND attr.attnum = ix.indkey[key.position]
               JOIN pg_catalog.pg_opclass opc ON opc.oid = ix.indclass[key.position]
               WHERE ix.indoption[key.position] = 0 AND opc.opcdefault
                 AND ix.indcollation[key.position] = attr.attcollation
               ORDER BY key.position
           ) = CAST(:columns AS text[]) AS matches
    FROM pg_catalog.pg_class target
    JOIN pg_catalog.pg_namespace ns ON ns.oid = target.relnamespace
    LEFT JOIN pg_catalog.pg_class idx ON idx.relnamespace = ns.oid AND idx.relname = :index_name
    LEFT JOIN pg_catalog.pg_index ix ON ix.indexrelid = idx.oid
    LEFT JOIN pg_catalog.pg_am am ON am.oid = idx.relam
    WHERE target.oid = pg_catalog.to_regclass(:table_name)
""")


@dataclass(frozen=True, slots=True)
class IndexSpec:
    """Describe an ordinary B-tree with default key options and no included or predicate columns."""

    table: str
    name: str
    columns: tuple[str, ...]
    unique: bool = False


def nullable_column_exists[T](bind: Connection, table: str, name: str, expected_type: TypeEngine[T]) -> bool:
    """Return True for an existing nullable column of the expected type and with no default.

    The table must exist. Reject schema drift before dependent DDL; never mutate the column.
    """
    column = next((item for item in sa.inspect(bind).get_columns(table) if item["name"] == name), None)
    if column is None:
        return False
    if (
        column["type"].compile(dialect=bind.dialect) != expected_type.compile(dialect=bind.dialect)
        or not column["nullable"]
        or column.get("default") is not None
        or "computed" in column
        or "identity" in column
    ):
        raise RuntimeError(f"Column {table}.{name} does not match the migration's nullable column definition")
    return True


def _index_state(bind: Connection, spec: IndexSpec) -> tuple[str, bool]:
    """Resolve the target schema and reject conflicting or unhealthy catalog rows without DDL."""
    row = (
        bind.execute(
            _INDEX_STATE,
            {
                "table_name": spec.table,
                "index_name": spec.name,
                "unique": spec.unique,
                "columns": list(spec.columns),
            },
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise RuntimeError(f"Table {spec.table} does not exist")
    schema = row["schema_name"]
    if row["present"] and not row["matches"]:
        raise RuntimeError(f"Relation {schema}.{spec.name} conflicts with the required index on {spec.table}")
    if row["present"] and not row["healthy"]:
        raise RuntimeError(
            f"Index {schema}.{spec.name} is unhealthy. Inspect its build status and remove it only if the "
            "concurrent build was abandoned, then retry the migration."
        )
    return schema, row["present"]


def _pending_indexes(
    operations: Operations, specs: tuple[IndexSpec, ...], *, dropping: bool
) -> tuple[tuple[IndexSpec, str | None], ...]:
    """Preflight every index before irreversible DDL; offline SQL assumes the original schema."""
    if operations.get_context().as_sql:
        return tuple((spec, None) for spec in specs)
    states = [(spec, *_index_state(operations.get_bind(), spec)) for spec in specs]
    return tuple((spec, schema) for spec, schema, present in states if present is dropping)


def create_indexes(operations: Operations, *specs: IndexSpec) -> None:
    """Create missing PostgreSQL indexes concurrently; preserve matching, healthy indexes on retry.

    Each statement commits independently of Alembic's stamp. Schema conflicts
    fail closed before any new build; failures can leave completed indexes.
    """
    for spec, schema in _pending_indexes(operations, specs, dropping=False):
        with operations.get_context().autocommit_block():
            operations.create_index(
                spec.name,
                spec.table,
                list(spec.columns),
                schema=schema,
                unique=spec.unique,
                postgresql_concurrently=True,
            )


def drop_indexes(operations: Operations, *specs: IndexSpec) -> None:
    """Drop only matching PostgreSQL indexes concurrently; absent indexes are already complete.

    Each statement commits independently of Alembic's stamp. The target tables
    and their data are preserved, including after a partial failure.
    """
    for spec, schema in _pending_indexes(operations, specs, dropping=True):
        with operations.get_context().autocommit_block():
            operations.drop_index(spec.name, table_name=spec.table, schema=schema, postgresql_concurrently=True)

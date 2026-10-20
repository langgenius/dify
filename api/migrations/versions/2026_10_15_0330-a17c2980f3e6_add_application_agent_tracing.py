"""Add durable application tracing collection and delivery state.

Revision ID: a17c2980f3e6
Revises: f1d3c5b7a902
Create Date: 2026-10-15 03:30:00
"""

from collections.abc import Mapping

import sqlalchemy as sa
from alembic import op
from alembic.operations import ops

from models.types import StringUUID

revision = "a17c2980f3e6"
down_revision = "f1d3c5b7a902"
branch_labels = None
depends_on = None


def _trace_metadata() -> sa.MetaData:
    metadata = sa.MetaData()
    sa.Table(
        "application_trace_runs",
        metadata,
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("config_revision", sa.String(64), nullable=False),
        sa.Column("provider_config", sa.JSON(), nullable=False),
        sa.Column("trace_id", sa.String(32), nullable=False),
        sa.Column("root_span_id", sa.String(16), nullable=False),
        sa.Column("session_id", sa.String(255), nullable=False),
        sa.Column("capture_content", sa.Boolean(), nullable=False),
        sa.Column("capture_agent", sa.Boolean(), nullable=False),
        sa.Column("state", sa.String(24), nullable=False),
        sa.Column("outer_trace", sa.JSON(), nullable=True),
        sa.Column("span_count", sa.Integer(), nullable=False),
        sa.Column("payload_bytes", sa.BigInteger(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(96), nullable=True),
        sa.Column("trace_url", sa.Text(), nullable=True),
        sa.Column("provider_trace_id", sa.String(255), nullable=True),
        sa.Column("span_urls", sa.JSON(), nullable=False),
        sa.Column("export_token", StringUUID(), nullable=True),
        sa.Column("export_started_at", sa.DateTime(), nullable=True),
        sa.Column("export_heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("terminal_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "app_id", "source_kind", "source_id", name="application_trace_source_unique"),
    )
    sa.Index(
        "application_trace_delivery_idx",
        metadata.tables["application_trace_runs"].c.state,
        metadata.tables["application_trace_runs"].c.next_attempt_at,
    )
    sa.Index("application_trace_retention_idx", metadata.tables["application_trace_runs"].c.created_at)
    sa.Table(
        "application_trace_invocations",
        metadata,
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("run_id", StringUUID(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("parent_span_id", sa.String(16), nullable=False),
        sa.Column("span_id", sa.String(16), nullable=False),
        sa.Column("node_execution_id", StringUUID(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("finalized", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("finalized_at", sa.DateTime(), nullable=True),
    )
    sa.Index("application_trace_invocation_run_idx", metadata.tables["application_trace_invocations"].c.run_id)
    sa.Table(
        "application_trace_batches",
        metadata,
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("run_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("spans", sa.JSON(), nullable=False),
        sa.Column("final", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    sa.Index(
        "application_trace_batch_run_idx",
        metadata.tables["application_trace_batches"].c.run_id,
        metadata.tables["application_trace_batches"].c.created_at,
    )
    return metadata


def _schema_mismatch(table_name: str) -> None:
    # Include only the migration-owned table name; schema values and rows may be sensitive.
    raise RuntimeError(f"Application tracing schema mismatch: {table_name}; migration requires manual review")


def _has_nondefault_options(options: Mapping[str, object]) -> bool:
    return any(isinstance(value, sa.sql.ClauseElement) or bool(value) for value in options.values())


def _existing_schema_matches(metadata: sa.MetaData) -> bool:
    context = op.get_context()
    if context.as_sql:
        return False
    connection = op.get_bind()
    inspector = sa.inspect(connection)
    if set(inspector.get_view_names()) & set(metadata.tables):
        _schema_mismatch("application_trace_tables")
    existing = set(inspector.get_table_names()) & set(metadata.tables)
    if not existing:
        return False
    if existing != set(metadata.tables):
        _schema_mismatch("application_trace_tables")

    for table in metadata.tables.values():
        actual_columns = {column["name"]: column for column in inspector.get_columns(table.name)}
        if set(actual_columns) != set(table.columns.keys()):
            _schema_mismatch(table.name)
        for column in table.columns:
            actual = actual_columns[column.name]
            if (
                context.impl.compare_type(sa.Column(column.name, actual["type"]), column)
                or actual["nullable"] != column.nullable
                or actual.get("default") is not None
                or actual.get("computed") is not None
                or actual.get("identity") is not None
            ):
                _schema_mismatch(table.name)
        primary_key = inspector.get_pk_constraint(table.name)
        if _has_nondefault_options(primary_key.get("dialect_options", {})):
            _schema_mismatch(table.name)
        if primary_key["constrained_columns"] != ["id"] or (
            connection.dialect.name == "postgresql" and primary_key["name"] != f"{table.name}_pkey"
        ):
            _schema_mismatch(table.name)
        expected_unique = {
            (constraint.name, tuple(column.name for column in constraint.columns))
            for constraint in table.constraints
            if isinstance(constraint, sa.UniqueConstraint)
        }
        unique_constraints = inspector.get_unique_constraints(table.name)
        if any(_has_nondefault_options(constraint.get("dialect_options", {})) for constraint in unique_constraints):
            _schema_mismatch(table.name)
        actual_unique = {(constraint["name"], tuple(constraint["column_names"])) for constraint in unique_constraints}
        if actual_unique != expected_unique:
            _schema_mismatch(table.name)
        if inspector.get_foreign_keys(table.name) or inspector.get_check_constraints(table.name):
            _schema_mismatch(table.name)
        expected_indexes = {
            (index.name, tuple(column.name for column in index.columns), index.unique) for index in table.indexes
        }
        actual_indexes = set()
        for index in inspector.get_indexes(table.name):
            if index.get("duplicates_constraint"):
                continue
            # A partial, expression, included-column or non-default operator index is
            # not equivalent to the complete ordinary indexes created below.
            if index.get("column_sorting") or _has_nondefault_options(index.get("dialect_options", {})):
                _schema_mismatch(table.name)
            actual_indexes.add((index["name"], tuple(index["column_names"]), bool(index["unique"])))
        if actual_indexes != expected_indexes:
            _schema_mismatch(table.name)
        if connection.dialect.name == "postgresql":
            index_states = connection.execute(
                sa.text(
                    "SELECT i.indisvalid, i.indisready FROM pg_index i "
                    "JOIN pg_class t ON t.oid = i.indrelid "
                    "JOIN pg_namespace n ON n.oid = t.relnamespace "
                    "WHERE n.nspname = current_schema() AND t.relname = :table_name"
                ),
                {"table_name": table.name},
            )
            if any(not row.indisvalid or not row.indisready for row in index_states):
                _schema_mismatch(table.name)
            noncanonical_constraints = connection.scalar(
                sa.text(
                    "SELECT count(*) FROM pg_constraint c "
                    "JOIN pg_class t ON t.oid = c.conrelid "
                    "JOIN pg_namespace n ON n.oid = t.relnamespace "
                    "WHERE n.nspname = current_schema() AND t.relname = :table_name "
                    "AND (c.condeferrable OR c.condeferred OR NOT c.convalidated)"
                ),
                {"table_name": table.name},
            )
            if noncanonical_constraints:
                _schema_mismatch(table.name)
    return True


def upgrade() -> None:
    metadata = _trace_metadata()
    # A deployment previously applied this exact schema under another revision.
    # Validate the complete schema before recognizing it; partial tables must not
    # turn a failed migration into an apparently successful one.
    if _existing_schema_matches(metadata):
        return
    for table in metadata.tables.values():
        op.invoke(ops.CreateTableOp.from_table(table))
        for index in sorted(table.indexes, key=lambda item: str(item.name)):
            op.invoke(ops.CreateIndexOp.from_index(index))


def downgrade() -> None:
    op.drop_table("application_trace_batches")
    op.drop_table("application_trace_invocations")
    op.drop_table("application_trace_runs")

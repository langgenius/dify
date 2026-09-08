"""Add durable tenant-owned OPS trace deliveries and configuration revisions.

Revision ID: 74f13a2c08b9
Revises: c3f1a9b2e6d4
"""

import json

import sqlalchemy as sa
from alembic import op

from models.types import StringUUID

revision = "74f13a2c08b9"
down_revision = "c3f1a9b2e6d4"
branch_labels = None
depends_on = None


def remove_identical_trace_configs():
    connection = op.get_bind()
    trace_config = sa.table(
        "trace_app_config",
        sa.column("id", StringUUID()),
        sa.column("app_id", StringUUID()),
        sa.column("tracing_provider", sa.String()),
        sa.column("tracing_config", sa.JSON()),
        sa.column("is_active", sa.Boolean()),
    )
    duplicate_owners = connection.execute(
        sa.select(trace_config.c.app_id, trace_config.c.tracing_provider)
        .group_by(
            trace_config.c.app_id,
            trace_config.c.tracing_provider,
        )
        .having(sa.func.count() > 1)
    ).all()
    redundant_config_ids = []
    for app_id, provider_name in duplicate_owners:
        rows = (
            connection.execute(
                sa.select(trace_config)
                .where(
                    trace_config.c.app_id == app_id,
                    trace_config.c.tracing_provider == provider_name,
                )
                .order_by(trace_config.c.id)
            )
            .mappings()
            .all()
        )
        if len({json.dumps((row["tracing_config"], row["is_active"]), sort_keys=True) for row in rows}) != 1:
            raise RuntimeError(
                f"Conflicting trace configurations require resolution: app_id={app_id}, provider={provider_name}"
            )
        redundant_config_ids.extend(row["id"] for row in rows[1:])
    if redundant_config_ids:
        connection.execute(trace_config.delete().where(trace_config.c.id.in_(redundant_config_ids)))


def upgrade():
    if op.get_context().as_sql:
        op.execute(
            "-- Duplicate trace configurations cannot be inspected during offline SQL generation.\n"
            "-- The unique constraint below rejects all duplicates before other schema changes.\n"
            "-- Use an online upgrade to remove identical copies and report conflicting configurations."
        )
    else:
        remove_identical_trace_configs()
    with op.batch_alter_table("trace_app_config") as batch:
        batch.create_unique_constraint("trace_app_config_app_provider_unique", ["app_id", "tracing_provider"])
    with op.batch_alter_table("apps") as batch:
        batch.add_column(sa.Column("tracing_revision", sa.Integer(), nullable=False, server_default="0"))
    op.create_table(
        "ops_trace_deliveries",
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID()),
        sa.Column("pipeline_id", StringUUID()),
        sa.Column("source_type", sa.String(16), nullable=False),
        sa.Column("export_id", StringUUID(), nullable=False),
        sa.Column("trace_id", StringUUID(), nullable=False),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("root_span_id", StringUUID(), nullable=False),
        sa.Column("conversation_id", StringUUID()),
        sa.Column("message_id", StringUUID()),
        sa.Column("workflow_run_id", StringUUID()),
        sa.Column("destination_type", sa.String(16), nullable=False),
        sa.Column("provider_name", sa.String(32), nullable=False),
        sa.Column("config_id", StringUUID()),
        sa.Column("config_revision", sa.Integer(), nullable=False),
        sa.Column("destination_settings_hash", sa.String(64), nullable=False),
        sa.Column("trace_sha256", sa.String(64), nullable=False),
        sa.Column("trace_size_bytes", sa.Integer(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("attempt_token", StringUUID()),
        sa.Column("lease_expires_at", sa.DateTime()),
        sa.Column("parent_export_id", StringUUID()),
        sa.Column("parent_delivery_id", StringUUID()),
        sa.Column("parent_span_id", StringUUID()),
        sa.Column("parent_references", sa.JSON()),
        sa.Column("error_code", sa.String(64)),
        sa.Column("finished_at", sa.DateTime()),
        sa.Column("trace_deleted_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint("tenant_id", "export_id", name="ops_trace_delivery_export_unique"),
        sa.UniqueConstraint("tenant_id", "id", name="ops_trace_delivery_tenant_unique"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "parent_delivery_id"],
            ["ops_trace_deliveries.tenant_id", "ops_trace_deliveries.id"],
            name="ops_trace_delivery_parent_fk",
        ),
        sa.CheckConstraint("trace_size_bytes > 0 AND trace_size_bytes <= 8388608", name="ops_trace_delivery_size"),
        sa.CheckConstraint(
            "(source_type = 'app' AND app_id IS NOT NULL AND pipeline_id IS NULL) OR "
            "(source_type = 'pipeline' AND pipeline_id IS NOT NULL AND app_id IS NULL) OR "
            "(source_type = 'workspace' AND app_id IS NULL AND pipeline_id IS NULL)",
            name="ops_trace_delivery_source",
        ),
        sa.CheckConstraint(
            "destination_type = 'enterprise' OR "
            "(destination_type = 'app_provider' AND app_id IS NOT NULL AND config_id IS NOT NULL)",
            name="ops_trace_delivery_destination",
        ),
    )
    op.create_index("ops_trace_delivery_due_idx", "ops_trace_deliveries", ["status", "next_attempt_at"])
    op.create_index(
        "ops_trace_delivery_owner_idx", "ops_trace_deliveries", ["tenant_id", "app_id", "message_id", "workflow_run_id"]
    )


def downgrade():
    op.drop_table("ops_trace_deliveries")
    with op.batch_alter_table("trace_app_config") as batch:
        batch.drop_constraint("trace_app_config_app_provider_unique", type_="unique")
    with op.batch_alter_table("apps") as batch:
        batch.drop_column("tracing_revision")

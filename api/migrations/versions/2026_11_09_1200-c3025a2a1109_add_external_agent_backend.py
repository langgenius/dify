"""Add owned external agents, durable dispatches and observation delivery.

Revision ID: c3025a2a1109
Revises: ad1816d009b8, 53c10126d551
Create Date: 2026-11-09
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, StringUUID

revision = "c3025a2a1109"
down_revision = ("ad1816d009b8", "53c10126d551")
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "external_agent_heads",
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("active_connection_revision_id", StringUUID(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("tracing_enabled", sa.Boolean(), nullable=False),
        sa.Column("metadata_revision", sa.Integer(), nullable=False),
        sa.Column("row_version", sa.Integer(), nullable=False),
        sa.Column("test_display_generation", sa.Integer(), nullable=False),
        sa.Column("overrides", AdjustedJSON(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("agent_id", name="external_agent_heads_pkey"),
    )
    op.create_index(
        "external_agent_head_tenant_enabled_idx",
        "external_agent_heads",
        ["tenant_id", "enabled", "deleted_at"],
        unique=False,
    )
    op.create_table(
        "external_agent_connection_revisions",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("interface_url", sa.Text(), nullable=False),
        sa.Column("auth_type", sa.String(length=16), nullable=False),
        sa.Column("credential_ciphertext", sa.Text(), nullable=True),
        sa.Column("agent_card", AdjustedJSON(), nullable=False),
        sa.Column("capabilities", AdjustedJSON(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("auth_check", sa.String(length=32), nullable=False),
        sa.Column("created_by", StringUUID(), nullable=False),
        sa.Column("verified_at", sa.DateTime(), nullable=False),
        sa.Column("profile", sa.String(length=64), nullable=False),
        sa.Column("secret_cleared_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_connection_revisions_pkey"),
    )
    op.create_index(
        "external_agent_revision_owner_idx",
        "external_agent_connection_revisions",
        ["tenant_id", "agent_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "external_agent_verifications",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("actor_id", StringUUID(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("interface_url", sa.Text(), nullable=False),
        sa.Column("auth_type", sa.String(length=16), nullable=False),
        sa.Column("credential_ciphertext", sa.Text(), nullable=True),
        sa.Column("auth_check", sa.String(length=32), nullable=False),
        sa.Column("agent_card", AdjustedJSON(), nullable=False),
        sa.Column("capabilities", AdjustedJSON(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=True),
        sa.Column("expected_connection_revision_id", StringUUID(), nullable=True),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_verifications_pkey"),
    )
    op.create_index(
        "external_agent_verification_expiry_idx", "external_agent_verifications", ["expires_at"], unique=False
    )
    op.create_table(
        "external_agent_operations",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("actor_id", StringUUID(), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("idempotency_key", sa.String(length=255), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.Column("resource_id", StringUUID(), nullable=False),
        sa.Column("result", AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_operations_pkey"),
        sa.UniqueConstraint("tenant_id", "actor_id", "kind", "idempotency_key", name="external_agent_operation_key_uq"),
    )
    op.create_table(
        "external_agent_invocations",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("request_key", sa.String(length=255), nullable=False),
        sa.Column("execution_key", sa.String(length=64), nullable=False),
        sa.Column("origin", sa.String(length=32), nullable=False),
        sa.Column("initiator_id", StringUUID(), nullable=True),
        sa.Column("app_id", StringUUID(), nullable=True),
        sa.Column("workflow_run_id", StringUUID(), nullable=True),
        sa.Column("node_execution_id", StringUUID(), nullable=True),
        sa.Column("node_id", sa.String(length=255), nullable=True),
        sa.Column("frame_id", sa.String(length=255), nullable=False),
        sa.Column("binding_epoch", sa.String(length=255), nullable=True),
        sa.Column("context_slot_key", sa.String(length=64), nullable=True),
        sa.Column("connection_revision_id", StringUUID(), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("retry_of", StringUUID(), nullable=True),
        sa.Column("message_id", sa.String(length=255), nullable=True),
        sa.Column("remote_task_id", sa.String(length=512), nullable=True),
        sa.Column("remote_context_id", sa.String(length=512), nullable=True),
        sa.Column("submission_state", sa.String(length=32), nullable=False),
        sa.Column("local_state", sa.String(length=32), nullable=False),
        sa.Column("remote_state", sa.String(length=32), nullable=True),
        sa.Column("cancel_state", sa.String(length=32), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("test_generation", sa.Integer(), nullable=True),
        sa.Column("tracing_enabled", sa.Boolean(), nullable=False),
        sa.Column("request_payload", AdjustedJSON(), nullable=False),
        sa.Column("runtime_snapshot", AdjustedJSON(), nullable=False),
        sa.Column("job_config", AdjustedJSON(), nullable=False),
        sa.Column("response_payload", AdjustedJSON(), nullable=True),
        sa.Column("outputs", AdjustedJSON(), nullable=True),
        sa.Column("asset_snapshot", AdjustedJSON(), nullable=False),
        sa.Column("error_code", sa.String(length=96), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("local_wait_ended_at", sa.DateTime(), nullable=True),
        sa.Column("wait_deadline", sa.DateTime(), nullable=True),
        sa.Column("logical_deadline", sa.DateTime(), nullable=True),
        sa.Column("tracking_deadline", sa.DateTime(), nullable=True),
        sa.Column("cancellation_deadline", sa.DateTime(), nullable=True),
        sa.Column("retention_expires_at", sa.DateTime(), nullable=True),
        sa.Column("test_expires_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("background_queries", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_invocations_pkey"),
        sa.UniqueConstraint("tenant_id", "request_key", name="external_agent_invocation_request_uq"),
    )
    op.create_index(
        "external_agent_invocation_app_time_idx",
        "external_agent_invocations",
        ["tenant_id", "agent_id", "app_id", "dispatched_at"],
        unique=False,
    )
    op.create_index(
        "external_agent_invocation_asset_time_idx",
        "external_agent_invocations",
        ["tenant_id", "agent_id", "dispatched_at"],
        unique=False,
    )
    op.create_index(
        "external_agent_invocation_execution_idx",
        "external_agent_invocations",
        ["tenant_id", "execution_key", "sequence"],
        unique=False,
    )
    op.create_index(
        "external_agent_invocation_local_budget_idx",
        "external_agent_invocations",
        ["local_state", "logical_deadline"],
        unique=False,
    )
    op.create_index(
        "external_agent_invocation_retention_idx",
        "external_agent_invocations",
        ["retention_expires_at", "test_expires_at"],
        unique=False,
    )
    op.create_index(
        "external_agent_invocation_run_idx",
        "external_agent_invocations",
        ["tenant_id", "workflow_run_id", "node_execution_id"],
        unique=False,
    )
    op.create_table(
        "external_agent_context_slots",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("conversation_id", StringUUID(), nullable=False),
        sa.Column("node_id", sa.String(length=255), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("connection_revision_id", StringUUID(), nullable=False),
        sa.Column("binding_epoch", sa.String(length=255), nullable=False),
        sa.Column("frame_scope", sa.String(length=255), nullable=False),
        sa.Column("server_context_id", sa.String(length=512), nullable=True),
        sa.Column("reserved_invocation_id", StringUUID(), nullable=True),
        sa.Column("unresolved", sa.Boolean(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("key", name="external_agent_context_slots_pkey"),
    )
    op.create_index(
        "external_agent_context_conversation_idx",
        "external_agent_context_slots",
        ["tenant_id", "conversation_id"],
        unique=False,
    )
    op.create_table(
        "external_agent_commands",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("command_key", sa.String(length=255), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("next_run_at", sa.DateTime(), nullable=False),
        sa.Column("state", sa.String(length=24), nullable=False),
        sa.Column("lease_token", StringUUID(), nullable=True),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("fence", sa.Integer(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("background", sa.Boolean(), nullable=False),
        sa.Column("publish_after", sa.DateTime(), nullable=True),
        sa.Column("endpoint_key", sa.String(length=64), nullable=True),
        sa.Column("payload", AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_commands_pkey"),
        sa.UniqueConstraint("tenant_id", "command_key", name="external_agent_command_key_uq"),
    )
    op.create_index("external_agent_command_due_idx", "external_agent_commands", ["state", "next_run_at"], unique=False)
    op.create_index(
        "external_agent_command_publish_idx",
        "external_agent_commands",
        ["state", "publish_after", "next_run_at"],
        unique=False,
    )
    op.create_index(
        "external_agent_command_io_capacity_idx",
        "external_agent_commands",
        ["tenant_id", "state", "kind", "lease_until"],
        unique=False,
    )
    op.create_index(
        "external_agent_command_invocation_idx",
        "external_agent_commands",
        ["tenant_id", "invocation_id", "kind"],
        unique=False,
    )
    op.create_table(
        "external_workflow_budgets",
        sa.Column("workflow_run_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("deadline", sa.DateTime(), nullable=False),
        sa.Column("human_pause_started_at", sa.DateTime(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("workflow_run_id", name="external_workflow_budgets_pkey"),
    )
    op.create_table(
        "external_agent_file_leases",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("file_id", StringUUID(), nullable=False),
        sa.Column("owner_id", StringUUID(), nullable=False),
        sa.Column("purpose", sa.String(length=24), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=True),
        sa.Column("agent_id", StringUUID(), nullable=True),
        sa.Column("page_session_id", sa.String(length=255), nullable=True),
        sa.Column("artifact_id", sa.String(length=512), nullable=True),
        sa.Column("part_index", sa.Integer(), nullable=True),
        sa.Column("file_value", AdjustedJSON(), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("media_type", sa.String(length=255), nullable=True),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("write_state", sa.String(length=16), nullable=False),
        sa.Column("write_lease_until", sa.DateTime(), nullable=True),
        sa.Column("cleanup_after", sa.DateTime(), nullable=True),
        sa.Column("temporary_copy", sa.Boolean(), nullable=False),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_file_leases_pkey"),
        sa.UniqueConstraint("invocation_id", "artifact_id", "part_index", name="external_agent_stored_part_uq"),
    )
    op.create_index(
        "external_agent_file_lease_expiry_idx",
        "external_agent_file_leases",
        ["expires_at", "released_at"],
        unique=False,
    )
    op.create_table(
        "external_agent_trace_records",
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("state", sa.String(length=24), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("targets_frozen", sa.Boolean(), nullable=False),
        sa.Column("payload_bytes", sa.BigInteger(), nullable=False),
        sa.Column("diagnostics", AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("invocation_id", name="external_agent_trace_records_pkey"),
    )
    op.create_index(
        "external_agent_trace_owner_idx",
        "external_agent_trace_records",
        ["tenant_id", "agent_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "external_agent_trace_receipts",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("receipt_key", sa.String(length=64), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("source_id", sa.String(length=512), nullable=False),
        sa.Column("dialect", sa.String(length=32), nullable=False),
        sa.Column("received_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_trace_receipts_pkey"),
        sa.UniqueConstraint("tenant_id", "invocation_id", "receipt_key", name="external_trace_receipt_uq"),
    )
    op.create_table(
        "external_agent_trace_steps",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("step_key", sa.String(length=64), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("trace_path", AdjustedJSON(), nullable=False),
        sa.Column("remote_trace_id", sa.String(length=512), nullable=False),
        sa.Column("remote_step_id", sa.String(length=512), nullable=False),
        sa.Column("parent_step_id", sa.String(length=512), nullable=True),
        sa.Column("resolved_parent_key", sa.String(length=64), nullable=True),
        sa.Column("kind", sa.String(length=32), nullable=True),
        sa.Column("name", sa.String(length=512), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("total_tokens", sa.BigInteger(), nullable=True),
        sa.Column("raw_data", AdjustedJSON(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_trace_steps_pkey"),
        sa.UniqueConstraint("tenant_id", "invocation_id", "step_key", name="external_trace_step_uq"),
    )
    op.create_table(
        "external_agent_trace_usage_summaries",
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("total_tokens", sa.BigInteger(), nullable=False),
        sa.Column("source_path", sa.String(length=512), nullable=False),
        sa.Column("adapter", sa.String(length=128), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("invocation_id", name="external_agent_trace_usage_summaries_pkey"),
    )
    op.create_table(
        "external_agent_tracing_configs",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("agent_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("encrypted_config", AdjustedJSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("capture_content", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_tracing_configs_pkey"),
        sa.UniqueConstraint("tenant_id", "agent_id", "provider", name="external_trace_config_uq"),
    )
    op.create_table(
        "external_agent_trace_deliveries",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("delivery_key", sa.String(length=64), nullable=False),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("config_revision", sa.String(length=64), nullable=False),
        sa.Column("payload_revision", sa.Integer(), nullable=False),
        sa.Column("encrypted_config", AdjustedJSON(), nullable=False),
        sa.Column("trace_payload", AdjustedJSON(), nullable=False),
        sa.Column("capture_content", sa.Boolean(), nullable=False),
        sa.Column("state", sa.String(length=24), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("lease_token", StringUUID(), nullable=True),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("error_code", sa.String(length=96), nullable=True),
        sa.Column("trace_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_trace_deliveries_pkey"),
        sa.UniqueConstraint("tenant_id", "delivery_key", name="external_trace_delivery_uq"),
    )
    op.create_index(
        "external_trace_delivery_due_idx", "external_agent_trace_deliveries", ["state", "next_attempt_at"], unique=False
    )
    op.create_index(
        "external_trace_delivery_invocation_idx",
        "external_agent_trace_deliveries",
        ["tenant_id", "invocation_id"],
        unique=False,
    )
    op.create_table(
        "external_agent_trace_targets",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", StringUUID(), nullable=False),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_id", StringUUID(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("config_revision", sa.String(length=64), nullable=False),
        sa.Column("encrypted_config", AdjustedJSON(), nullable=False),
        sa.Column("capture_content", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_trace_targets_pkey"),
        sa.UniqueConstraint("tenant_id", "invocation_id", "target_kind", "target_id", name="external_trace_target_uq"),
    )
    op.create_table(
        "external_agent_data_tombstones",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("owner_kind", sa.String(length=32), nullable=False),
        sa.Column("owner_id", sa.String(length=255), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="external_agent_data_tombstones_pkey"),
        sa.UniqueConstraint("tenant_id", "owner_kind", "owner_id", name="external_data_tombstone_uq"),
    )
    # Nullable-add/backfill/not-null is portable for existing PostgreSQL, MySQL and SQLite rows.
    with op.batch_alter_table("workflow_agent_node_bindings") as batch:
        batch.add_column(sa.Column("binding_epoch", sa.String(64), nullable=True))
        # Old Native writers omit this new field during rolling updates and
        # binary rollback. Keep their INSERTs valid from the initial ADD onward.
        batch.add_column(
            sa.Column("external_job_config", AdjustedJSON(), nullable=True, server_default=sa.text("('{}')"))
        )
        batch.add_column(sa.Column("original_reference", AdjustedJSON(), nullable=True))
    op.execute("UPDATE workflow_agent_node_bindings SET external_job_config = '{}' WHERE external_job_config IS NULL")
    with op.batch_alter_table("workflow_agent_node_bindings") as batch:
        # MySQL renders nullability as a full-column MODIFY; explicitly retain
        # the default instead of silently dropping it at the final NOT NULL step.
        batch.alter_column(
            "external_job_config",
            existing_type=AdjustedJSON(),
            nullable=False,
            server_default=sa.text("('{}')"),
        )


def downgrade():
    with op.batch_alter_table("workflow_agent_node_bindings") as batch:
        batch.drop_column("original_reference")
        batch.drop_column("external_job_config")
        batch.drop_column("binding_epoch")
    op.drop_table("external_agent_data_tombstones")
    op.drop_table("external_agent_trace_targets")
    op.drop_table("external_agent_trace_deliveries")
    op.drop_table("external_agent_tracing_configs")
    op.drop_table("external_agent_trace_usage_summaries")
    op.drop_table("external_agent_trace_steps")
    op.drop_table("external_agent_trace_receipts")
    op.drop_table("external_agent_trace_records")
    op.drop_table("external_agent_file_leases")
    op.drop_table("external_workflow_budgets")
    op.drop_table("external_agent_commands")
    op.drop_table("external_agent_context_slots")
    op.drop_table("external_agent_invocations")
    op.drop_table("external_agent_operations")
    op.drop_table("external_agent_verifications")
    op.drop_table("external_agent_connection_revisions")
    op.drop_table("external_agent_heads")

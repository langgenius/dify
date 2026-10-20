"""Add native effect approvals, immutable dispatch ledger and continuations.

Revision ID: c67e12a904bf
Revises: a61e9b2c7d40
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, StringUUID

revision = "c67e12a904bf"
down_revision = "a61e9b2c7d40"
branch_labels = None
depends_on = None


def _id():
    return sa.Column("id", StringUUID(), primary_key=True)


def _owner(invocation=True):
    columns = [
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("request_id", StringUUID(), nullable=False),
    ]
    if invocation:
        columns.append(sa.Column("invocation_id", sa.String(128), nullable=False))
    return columns


def _quota(name):
    return [
        *(
            sa.Column(field, sa.BigInteger(), nullable=False)
            for field in (
                "max_calls",
                "max_dispatches",
                "max_cost_units",
                "spent_calls",
                "spent_dispatches",
                "spent_cost_units",
            )
        ),
        sa.CheckConstraint(
            "max_calls >= 0 AND max_dispatches >= 0 AND max_cost_units >= 0 "
            "AND spent_calls >= 0 AND spent_calls <= max_calls "
            "AND spent_dispatches >= 0 AND spent_dispatches <= max_dispatches "
            "AND spent_cost_units >= 0 AND spent_cost_units <= max_cost_units",
            name=name,
        ),
    ]


def _str(name, size=128, nullable=False):
    return sa.Column(name, sa.String(size), nullable=nullable)


def _json(name):
    return sa.Column(name, AdjustedJSON(), nullable=False)


def _ledger_function():
    connection = op.get_bind()
    schema = connection.execute(sa.text("SELECT current_schema()")).scalar_one()
    quoted = connection.dialect.identifier_preparer.quote(schema)
    return f"{quoted}.builder_native_immutable_ledger"


def upgrade():
    op.drop_constraint("builder_execution_request_state", "dify_builder_execution_requests", type_="check")
    op.create_check_constraint(
        "builder_execution_request_state",
        "dify_builder_execution_requests",
        "state IN ('prepared','running','sealed') OR "
        "(state = 'waiting' AND COALESCE(context->>'policy_version', '') = 'builder-native-test-v1')",
    )
    op.create_index(
        "builder_native_waiting_idx",
        "dify_builder_execution_requests",
        ["tenant_id", "app_id", "state"],
        postgresql_where=sa.text("state = 'waiting'"),
    )
    op.create_table(
        "dify_builder_native_scopes",
        sa.Column("request_id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        *_quota("native_scope_quota"),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        sa.Column("task_approved", sa.Boolean(), nullable=False),
        sa.Column("cancelled", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        _json("budget_limits"),
        _json("budget_spent"),
        _json("profile"),
        sa.CheckConstraint("generation >= 0", name="native_scope_generation"),
    )
    op.create_table(
        "dify_builder_native_invocations",
        _id(),
        *_owner(),
        sa.Column("active", sa.Boolean(), nullable=False),
        _json("bindings"),
        sa.UniqueConstraint("tenant_id", "request_id", "invocation_id", name="native_invocation_owner"),
    )
    op.create_table(
        "dify_builder_native_grants",
        _id(),
        *_owner(False),
        *_quota("native_grant_quota"),
        _str("scope_digest", 64),
        _str("decision", 16),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor_id", StringUUID(), nullable=False),
        sa.UniqueConstraint("tenant_id", "request_id", "scope_digest", name="native_grant_scope"),
        sa.CheckConstraint("decision IN ('approved','denied')", name="native_grant_decision"),
    )
    op.create_table(
        "dify_builder_native_operations",
        _id(),
        *_owner(),
        _str("operation_digest", 64),
        _str("intent_digest", 64),
        _str("scope_digest", 64),
        _str("state", 16),
        _str("result_ref", nullable=True),
        sa.UniqueConstraint(
            "tenant_id", "request_id", "invocation_id", "operation_digest", name="native_operation_key"
        ),
        sa.CheckConstraint(
            "state IN ('pending','claimed','completed','failed','unknown','not_dispatched','denied','cancelled')",
            name="native_operation_state",
        ),
    )
    op.create_table(
        "dify_builder_native_attempts",
        _id(),
        *_owner(),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("grant_id", StringUUID(), nullable=False),
        sa.Column("dispatch_index", sa.Integer(), nullable=False),
        _str("permit_digest", 64),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cost_units", sa.BigInteger(), nullable=False),
        sa.Column("budget_reservation_ref", StringUUID(), nullable=False),
        _str("execution_id"),
        _str("invocation_digest", 64),
        _json("budget"),
        _json("profile"),
        sa.UniqueConstraint("operation_id", "dispatch_index", name="native_attempt_dispatch"),
        sa.UniqueConstraint("permit_digest", name="native_attempt_permit"),
        sa.UniqueConstraint("budget_reservation_ref", name="native_attempt_reservation"),
        sa.CheckConstraint("dispatch_index = 1 AND cost_units >= 0", name="native_attempt_spend"),
    )
    op.create_table(
        "dify_builder_native_outcomes",
        _id(),
        *_owner(),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("attempt_id", StringUUID(), nullable=False),
        _str("outcome", 16),
        _str("result_ref", nullable=True),
        sa.UniqueConstraint("attempt_id", name="native_outcome_attempt"),
        sa.CheckConstraint("outcome IN ('completed','failed','unknown','not_dispatched')", name="native_outcome_state"),
        sa.CheckConstraint("outcome != 'completed' OR result_ref IS NOT NULL", name="native_completed_result"),
    )
    op.create_table(
        "dify_builder_native_continuations",
        _id(),
        *_owner(),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        _str("checkpoint_id"),
        _str("payload_digest", 64),
        _str("payload_ref"),
        sa.UniqueConstraint("request_id", "invocation_id", "generation", name="native_continuation_generation"),
        sa.CheckConstraint("generation >= 0", name="native_continuation_counter"),
    )
    op.create_table(
        "dify_builder_native_pending_actions",
        _id(),
        *_owner(),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        _str("category", 16),
        _str("reference_digest", 64),
        _str("reference"),
        _str("owner_ref"),
        _str("owner_version"),
        sa.Column("operation_id", StringUUID(), nullable=True),
        sa.UniqueConstraint(
            "tenant_id",
            "request_id",
            "invocation_id",
            "generation",
            "category",
            "reference_digest",
            name="native_pending_reference",
        ),
        sa.CheckConstraint("category IN ('approval','configuration','interaction')", name="native_pending_category"),
        sa.CheckConstraint(
            "(category = 'approval' AND operation_id IS NOT NULL) OR (category != 'approval' AND operation_id IS NULL)",
            name="native_pending_effect_owner",
        ),
        sa.CheckConstraint("generation >= 0", name="native_pending_generation"),
    )
    # Keep immutable evidence immutable even when another worker bypasses ORM.
    op.execute(f"""CREATE FUNCTION {_ledger_function()}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'native ledger is append-only'; END; $$""")
    for table in ("dify_builder_native_attempts", "dify_builder_native_outcomes"):
        op.execute(
            f"CREATE TRIGGER native_ledger_immutable BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {_ledger_function()}()"
        )


def downgrade():
    # Refuse to erase a resumable wait; operators must terminate through the
    # native lifecycle before downgrading this feature.
    op.execute("""DO $$ BEGIN IF EXISTS (SELECT 1 FROM dify_builder_execution_requests WHERE state='waiting')
        THEN RAISE EXCEPTION 'terminate native waits before downgrade'; END IF; END $$""")
    for table in (
        "pending_actions",
        "continuations",
        "outcomes",
        "attempts",
        "operations",
        "grants",
        "invocations",
        "scopes",
    ):
        op.drop_table("dify_builder_native_" + table)
    op.execute(f"DROP FUNCTION {_ledger_function()}()")
    op.drop_index("builder_native_waiting_idx", table_name="dify_builder_execution_requests")
    op.drop_constraint("builder_execution_request_state", "dify_builder_execution_requests", type_="check")
    op.create_check_constraint(
        "builder_execution_request_state", "dify_builder_execution_requests", "state IN ('prepared','running','sealed')"
    )

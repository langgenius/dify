"""Install the Dify Builder schema after the main migration history.

Revision ID: 430a56d97885
Revises: f8b6e2c4a901
Create Date: 2026-11-23 11:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

from models.types import AdjustedJSON, LongText, StringUUID

revision = "430a56d97885"
down_revision = "f8b6e2c4a901"
branch_labels = None
depends_on = None


def function_schema_prefix() -> str:
    """Resolve online schemas; exported SQL resolves the same search path when applied."""
    if op.get_context().as_sql:
        return ""
    connection = op.get_bind()
    schema = connection.execute(sa.text("SELECT current_schema()")).scalar_one()
    return connection.dialect.identifier_preparer.quote(schema) + "."


def require_empty_table(table: str, reason: str, *, lock: bool = False, predicate: str | None = None) -> None:
    """Retain evidence checks in exported SQL instead of reading a nonexistent connection."""
    query = f"SELECT 1 FROM {table}"
    if predicate:
        query += f" WHERE {predicate}"
    query += " LIMIT 1"
    offline_mysql = op.get_context().as_sql and is_mysql()
    procedure = "builder_downgrade_guard"
    if offline_mysql:
        # MySQL refuses routine DDL while tables are locked. Define the guard
        # first, then run its read under the lock retained through DROP TABLE.
        op.execute(sa.text(f"DROP PROCEDURE IF EXISTS {procedure}"))
        mysql_program(f"""CREATE PROCEDURE {procedure}() BEGIN
            IF EXISTS ({query}) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{reason}';
            END IF; END""")
    if lock:
        op.execute(
            sa.text(f"LOCK TABLES {table} WRITE" if is_mysql() else f"LOCK TABLE {table} IN ACCESS EXCLUSIVE MODE")
        )
    if op.get_context().as_sql:
        if is_mysql():
            op.execute(sa.text(f"CALL {procedure}()"))
            if not lock:
                op.execute(sa.text(f"DROP PROCEDURE {procedure}"))
        else:
            op.execute(
                sa.text(f"""DO $$ BEGIN IF EXISTS ({query})
                THEN RAISE EXCEPTION '{reason}'; END IF; END $$""")
            )
    elif op.get_bind().execute(sa.text(query)).first():
        if lock:
            unlock_tables()
        raise RuntimeError(reason)


def is_mysql() -> bool:
    return op.get_bind().dialect.name == "mysql"


def mysql_program(statement: str) -> None:
    """Emit a compound MySQL statement with CLI delimiters only in SQL exports."""
    if op.get_context().as_sql:
        op.get_context().impl.static_output(f"DELIMITER $$\n{statement}$$\nDELIMITER ;")
    else:
        op.execute(sa.text(statement))


def mysql_immutable_triggers(table: str, name: str, reason: str) -> None:
    for event in ("UPDATE", "DELETE"):
        mysql_program(
            f"CREATE TRIGGER {name}_{event.lower()} BEFORE {event} ON {table} "
            f"FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '{reason}'"
        )


def mysql_changed(fields: tuple[str, ...]) -> str:
    """Null-safe binary comparisons preserve case-sensitive immutable identities."""
    return " OR ".join(f"NOT (BINARY NEW.{field} <=> BINARY OLD.{field})" for field in fields)


def unlock_tables() -> None:
    if is_mysql():
        op.execute(sa.text("UNLOCK TABLES"))
        if op.get_context().as_sql:
            op.execute(sa.text("DROP PROCEDURE builder_downgrade_guard"))


def _create_builder_storage() -> None:
    """Install Builder sessions, runs, conversation history and saved test inputs in the Builder migration."""
    op.create_table(
        "dify_builder_sessions",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("owner_account_id", StringUUID(), nullable=False),
        sa.Column("entry_mode", sa.String(length=50), nullable=False),
        sa.Column("current_state", sa.String(length=50), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dify_builder_session_pkey"),
    )
    op.create_index("dify_builder_session_tenant_idx", "dify_builder_sessions", ["tenant_id"])
    op.create_index("dify_builder_session_app_idx", "dify_builder_sessions", ["app_id"])

    op.create_table(
        "dify_builder_session_commits",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("context", AdjustedJSON(), nullable=False),
        sa.Column("actor", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dify_builder_session_commit_pkey"),
    )
    op.create_index("dify_builder_session_commit_session_idx", "dify_builder_session_commits", ["session_id"])

    op.create_table(
        "dify_builder_snapshots",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("hash", sa.String(length=255), nullable=False),
        sa.Column("graph", AdjustedJSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dify_builder_snapshot_pkey"),
    )
    op.create_index("dify_builder_snapshot_session_idx", "dify_builder_snapshots", ["session_id"])

    op.create_table(
        "dify_builder_checkpoints",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("snapshot_id", StringUUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dify_builder_checkpoint_pkey"),
    )
    op.create_index("dify_builder_checkpoint_session_idx", "dify_builder_checkpoints", ["session_id"])

    op.create_table(
        "dify_builder_runs",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("dify_run_id", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("per_node", AdjustedJSON(), nullable=True),
        sa.Column("culprit_node_id", sa.String(length=255), nullable=True),
        sa.Column("inputs_ref", sa.String(length=255), nullable=True),
        sa.Column("tokens", sa.Integer(), nullable=True),
        sa.Column("elapsed_ms", sa.Integer(), nullable=True),
        sa.Column("immutable", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("verification", AdjustedJSON(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="dify_builder_run_pkey"),
    )
    op.create_index("dify_builder_run_session_idx", "dify_builder_runs", ["session_id"])

    op.create_table(
        "dify_builder_conversation_items",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=50), nullable=False),
        sa.Column("payload", AdjustedJSON(), nullable=False),
        sa.Column("at_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dify_builder_conversation_item_pkey"),
        sa.UniqueConstraint("session_id", "seq", name="dify_builder_conversation_item_session_seq_key"),
    )
    op.create_index("dify_builder_conversation_item_session_idx", "dify_builder_conversation_items", ["session_id"])

    op.create_table(
        "dify_builder_test_inputs",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("session_id", StringUUID(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("inputs", AdjustedJSON(), nullable=False),
        sa.Column("start_schema_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.current_timestamp(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="dify_builder_test_input_pkey"),
    )
    op.create_index("dify_builder_test_input_session_idx", "dify_builder_test_inputs", ["session_id"])


def _drop_builder_storage() -> None:
    """Remove Builder sessions, runs, conversation history and saved test inputs in the Builder migration."""
    op.drop_index("dify_builder_test_input_session_idx", table_name="dify_builder_test_inputs")
    op.drop_table("dify_builder_test_inputs")

    op.drop_index("dify_builder_conversation_item_session_idx", table_name="dify_builder_conversation_items")
    op.drop_table("dify_builder_conversation_items")

    op.drop_index("dify_builder_run_session_idx", table_name="dify_builder_runs")
    op.drop_table("dify_builder_runs")

    op.drop_index("dify_builder_checkpoint_session_idx", table_name="dify_builder_checkpoints")
    op.drop_table("dify_builder_checkpoints")

    op.drop_index("dify_builder_snapshot_session_idx", table_name="dify_builder_snapshots")
    op.drop_table("dify_builder_snapshots")

    op.drop_index("dify_builder_session_commit_session_idx", table_name="dify_builder_session_commits")
    op.drop_table("dify_builder_session_commits")

    op.drop_index("dify_builder_session_app_idx", table_name="dify_builder_sessions")
    op.drop_index("dify_builder_session_tenant_idx", table_name="dify_builder_sessions")
    op.drop_table("dify_builder_sessions")


def _create_execution_requests() -> None:
    """Install execution requests and HTTP fixture storage in the Builder migration."""
    op.add_column("dify_builder_test_inputs", sa.Column("http_fixtures", AdjustedJSON(), nullable=True))
    op.create_table(
        "dify_builder_execution_requests",
        sa.Column("id", StringUUID(), nullable=False),
        *(
            sa.Column(name, StringUUID(), nullable=False)
            for name in ("tenant_id", "app_id", "workflow_id", "actor_id", "session_id", "test_input_id")
        ),
        sa.Column("context", AdjustedJSON(), nullable=False),
        sa.Column("context_digest", sa.String(64), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("native_run_id", StringUUID(), nullable=True),
        sa.Column("task_id", sa.String(128), nullable=True),
        sa.Column("observations", AdjustedJSON(), nullable=False),
        sa.Column("completion_fingerprint", sa.String(64), nullable=True),
        sa.Column("completion_summary", AdjustedJSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("sealed_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="dify_builder_execution_request_pkey"),
        sa.CheckConstraint("state IN ('prepared', 'running', 'sealed')", name="builder_execution_request_state"),
    )
    op.create_index("dify_builder_execution_request_session_idx", "dify_builder_execution_requests", ["session_id"])
    op.create_index(
        "dify_builder_execution_request_app_idx", "dify_builder_execution_requests", ["tenant_id", "app_id"]
    )


def _drop_execution_requests() -> None:
    """Remove execution requests and HTTP fixture storage in the Builder migration."""
    op.drop_table("dify_builder_execution_requests")
    op.drop_column("dify_builder_test_inputs", "http_fixtures")


def _create_real_call_consents() -> None:
    """Install real-call consent and its dispatch evidence in the Builder migration."""
    op.create_table(
        "dify_builder_real_call_consents",
        sa.Column("id", StringUUID(), nullable=False),
        *(
            sa.Column(name, StringUUID(), nullable=False)
            for name in (
                "tenant_id",
                "app_id",
                "workflow_id",
                "actor_id",
                "session_id",
                "prepared_commit_id",
                "test_input_id",
            )
        ),
        sa.Column("prepared_version", sa.Integer(), nullable=False),
        sa.Column("binding", AdjustedJSON(), nullable=False),
        sa.Column("scope_digest", sa.String(64), nullable=False),
        sa.Column("disclosure", AdjustedJSON(), nullable=False),
        sa.Column("disclosure_digest", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("decision", sa.String(16), nullable=True),
        sa.Column("execution_request_id", StringUUID(), nullable=True),
        sa.Column("command_id", StringUUID(), nullable=True),
        sa.Column("reserved_version", sa.Integer(), nullable=True),
        sa.Column("reserved_commit_id", StringUUID(), nullable=True),
        sa.Column("prepare_key", sa.String(128), nullable=False),
        sa.Column("prepare_body_digest", sa.String(64), nullable=False),
        sa.Column("prepare_receipt", AdjustedJSON(), nullable=False),
        sa.Column("confirm_key", sa.String(128), nullable=True),
        sa.Column("confirm_body_digest", sa.String(64), nullable=True),
        sa.Column("confirm_receipt", AdjustedJSON(), nullable=True),
        sa.Column("execute_key", sa.String(128), nullable=True),
        sa.Column("execute_body_digest", sa.String(64), nullable=True),
        sa.Column("execute_receipt", AdjustedJSON(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("refresh_claimed_at", sa.DateTime(), nullable=True),
        sa.Column("business_claimed_at", sa.DateTime(), nullable=True),
        sa.Column("refresh_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("business_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("initial_credential_revision", sa.String(64), nullable=False),
        sa.Column("derived_credential_revision", sa.String(64), nullable=True),
        sa.Column("oauth_client_revision", sa.String(64), nullable=False),
        sa.Column("native_run_id", StringUUID(), nullable=True),
        sa.Column("native_node_execution_id", sa.String(128), nullable=True),
        sa.Column("outcome_state", sa.String(16), nullable=True),
        sa.Column("reason_code", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.current_timestamp()),
        sa.PrimaryKeyConstraint("id", name="dify_builder_real_call_consent_pkey"),
        sa.UniqueConstraint(
            "tenant_id", "actor_id", "session_id", "prepare_key", name="dify_builder_real_call_consent_prepare_key"
        ),
        sa.UniqueConstraint("execution_request_id", name="dify_builder_real_call_consent_request_key"),
        sa.UniqueConstraint("command_id", name="dify_builder_real_call_consent_command_key"),
        sa.CheckConstraint(
            "state IN ('prepared', 'confirmed', 'claimed', 'completed', 'failed', 'unknown', 'declined', "
            "'expired', 'invalidated')",
            name="builder_real_call_consent_state",
        ),
        sa.CheckConstraint(
            "decision IS NULL OR decision IN ('confirm', 'decline')", name="builder_real_call_consent_decision"
        ),
        sa.CheckConstraint(
            "outcome_state IS NULL OR outcome_state IN ('completed', 'failed', 'unknown')",
            name="builder_real_call_consent_outcome",
        ),
        sa.CheckConstraint(
            "(refresh_count = 0 AND refresh_claimed_at IS NULL) "
            "OR (refresh_count = 1 AND refresh_claimed_at IS NOT NULL)",
            name="builder_real_call_consent_refresh_once",
        ),
        sa.CheckConstraint(
            "(business_count = 0 AND business_claimed_at IS NULL) "
            "OR (business_count = 1 AND business_claimed_at IS NOT NULL)",
            name="builder_real_call_consent_business_once",
        ),
        sa.CheckConstraint(
            "claimed_at IS NOT NULL OR (refresh_claimed_at IS NULL AND business_claimed_at IS NULL)",
            name="builder_real_call_consent_phase_after_claim",
        ),
    )
    op.create_index("dify_builder_real_call_consent_session_idx", "dify_builder_real_call_consents", ["session_id"])


def _drop_real_call_consents() -> None:
    """Remove real-call consent and its dispatch evidence in the Builder migration."""
    op.drop_index("dify_builder_real_call_consent_session_idx", table_name="dify_builder_real_call_consents")
    op.drop_table("dify_builder_real_call_consents")


def _id():
    return sa.Column("id", StringUUID(), primary_key=True)


def _ledger_owner_columns(invocation=True):
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
    quoted = function_schema_prefix()
    return f"{quoted}builder_native_immutable_ledger"


def _create_native_ledger() -> None:
    """Install native invocation, authorization and effect ledger tables in the Builder migration."""
    op.drop_constraint("builder_execution_request_state", "dify_builder_execution_requests", type_="check")
    policy_version = (
        "JSON_UNQUOTE(JSON_EXTRACT(context, '$.policy_version'))" if is_mysql() else "context->>'policy_version'"
    )
    op.create_check_constraint(
        "builder_execution_request_state",
        "dify_builder_execution_requests",
        "state IN ('prepared','running','sealed') OR "
        f"(state = 'waiting' AND COALESCE({policy_version}, '') = 'builder-native-test-v1')",
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
        *_ledger_owner_columns(),
        sa.Column("active", sa.Boolean(), nullable=False),
        _json("bindings"),
        sa.UniqueConstraint("tenant_id", "request_id", "invocation_id", name="native_invocation_owner"),
    )
    op.create_table(
        "dify_builder_native_grants",
        _id(),
        *_ledger_owner_columns(False),
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
        *_ledger_owner_columns(),
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
        *_ledger_owner_columns(),
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
        *_ledger_owner_columns(),
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
        *_ledger_owner_columns(),
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
        *_ledger_owner_columns(),
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
    if is_mysql():
        for suffix in ("attempts", "outcomes"):
            mysql_immutable_triggers(
                "dify_builder_native_" + suffix, "native_" + suffix + "_immutable", "native ledger is append-only"
            )
        return
    op.execute(f"""CREATE FUNCTION {_ledger_function()}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'native ledger is append-only'; END; $$""")
    for table in ("dify_builder_native_attempts", "dify_builder_native_outcomes"):
        op.execute(
            f"CREATE TRIGGER native_ledger_immutable BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {_ledger_function()}()"
        )


def _drop_native_ledger() -> None:
    """Remove native invocation, authorization and effect ledger tables in the Builder migration."""
    # Refuse to erase a resumable wait; operators must terminate through the
    # native lifecycle before downgrading this feature.
    if is_mysql():
        require_empty_table(
            "dify_builder_execution_requests", "terminate native waits before downgrade", predicate="state='waiting'"
        )
    else:
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
    if not is_mysql():
        op.execute(f"DROP FUNCTION {_ledger_function()}()")
    op.drop_index("builder_native_waiting_idx", table_name="dify_builder_execution_requests")
    op.drop_constraint("builder_execution_request_state", "dify_builder_execution_requests", type_="check")
    op.create_check_constraint(
        "builder_execution_request_state", "dify_builder_execution_requests", "state IN ('prepared','running','sealed')"
    )


def _continuation_owner_columns():
    return [
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("request_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", sa.String(128), nullable=False),
    ]


def _create_native_continuation() -> None:
    """Install native dispatch, payload and continuation state in the Builder migration."""
    op.create_table(
        "dify_builder_native_payload_objects",
        *_continuation_owner_columns(),
        _str("kind", 16),
        _str("logical_key"),
        _str("storage_key"),
        _str("payload_digest", 64),
        _str("value_digest", 64),
        sa.UniqueConstraint("request_id", "invocation_id", "kind", "logical_key", name="native_payload_logical_key"),
        sa.UniqueConstraint("storage_key", name="native_payload_storage_key"),
        sa.CheckConstraint("kind IN ('context','checkpoint','result')", name="native_payload_kind"),
    )
    op.create_table(
        "dify_builder_native_invocation_states",
        *_continuation_owner_columns(),
        sa.Column("context_object_id", StringUUID(), nullable=False),
        _str("parent_invocation_id", nullable=True),
        _str("parent_operation_digest", 64, True),
        _str("child_identity_digest", 64, True),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        _str("state", 16),
        _str("checkpoint_id", nullable=True),
        sa.Column("pending_ids", AdjustedJSON(), nullable=False),
        _str("wait_reason", 16, True),
        sa.Column("outcome", AdjustedJSON(), nullable=True),
        sa.Column("resolution", AdjustedJSON(), nullable=False),
        _str("cancellation_key", 64, True),
        sa.Column("cleanup_complete", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("request_id", "invocation_id", name="native_state_invocation"),
        sa.UniqueConstraint(
            "request_id", "parent_invocation_id", "parent_operation_digest", name="native_child_occurrence"
        ),
        sa.CheckConstraint("generation >= 0", name="native_state_generation"),
        sa.CheckConstraint(
            "state IN ('running','waiting','queued','completed','stopped','unknown','cancelled')",
            name="native_state_status",
        ),
    )
    op.create_table(
        "dify_builder_native_dispatches",
        *_continuation_owner_columns(),
        sa.Column("generation", sa.BigInteger(), nullable=False),
        _str("idempotency_digest", 64),
        _str("state", 16),
        _str("checkpoint_id", nullable=True),
        sa.Column("claim_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("request_id", "invocation_id", "generation", name="native_dispatch_generation"),
        sa.UniqueConstraint("request_id", "idempotency_digest", name="native_dispatch_idempotency"),
        sa.CheckConstraint("generation >= 0", name="native_dispatch_counter"),
        sa.CheckConstraint(
            "state IN ('queued','published','claimed','completed','unknown','cancelled')", name="native_dispatch_state"
        ),
    )
    if is_mysql():
        for suffix in ("payload_objects", "continuations"):
            mysql_immutable_triggers(
                "dify_builder_native_" + suffix, "native_" + suffix + "_immutable", "native ledger is append-only"
            )
        return
    quoted = function_schema_prefix()
    for table in ("payload_objects", "continuations"):
        op.execute(
            sa.text(
                f"CREATE TRIGGER native_immutable BEFORE UPDATE OR DELETE ON dify_builder_native_{table} "
                f"FOR EACH ROW EXECUTE FUNCTION {quoted}builder_native_immutable_ledger()"
            )
        )


def _drop_native_continuation() -> None:
    """Remove native dispatch, payload and continuation state in the Builder migration."""
    require_empty_table("dify_builder_native_invocation_states", "native continuation recovery data must be retained")
    if is_mysql():
        for event in ("update", "delete"):
            op.execute(f"DROP TRIGGER native_continuations_immutable_{event}")
    else:
        op.execute("DROP TRIGGER native_immutable ON dify_builder_native_continuations")
    for table in ("dispatches", "invocation_states", "payload_objects"):
        op.drop_table("dify_builder_native_" + table)


def _bind_native_read_owners() -> None:
    """Install native continuation read ownership and immutability in the Builder migration."""
    table = "dify_builder_native_invocation_states"
    op.add_column(table, sa.Column("app_id", StringUUID(), nullable=True))
    op.add_column(table, sa.Column("workflow_id", StringUUID(), nullable=True))
    op.create_check_constraint("native_state_read_owner_pair", table, "(app_id IS NULL) = (workflow_id IS NULL)")
    if is_mysql():
        changed = mysql_changed(
            (
                "id",
                "tenant_id",
                "request_id",
                "invocation_id",
                "app_id",
                "workflow_id",
                "context_object_id",
                "parent_invocation_id",
                "parent_operation_digest",
                "child_identity_digest",
            )
        )
        mysql_program(f"""CREATE TRIGGER native_read_owner_immutable BEFORE UPDATE ON {table}
            FOR EACH ROW BEGIN IF {changed} THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'native invocation read owner is immutable';
            END IF; END""")
        return
    quoted = function_schema_prefix()
    op.execute(
        sa.text(f"""
        CREATE FUNCTION {quoted}builder_native_immutable_read_owner() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
          IF ROW(NEW.id, NEW.tenant_id, NEW.request_id, NEW.invocation_id, NEW.app_id,
                 NEW.workflow_id, NEW.context_object_id, NEW.parent_invocation_id,
                 NEW.parent_operation_digest, NEW.child_identity_digest)
             IS DISTINCT FROM
             ROW(OLD.id, OLD.tenant_id, OLD.request_id, OLD.invocation_id, OLD.app_id,
                 OLD.workflow_id, OLD.context_object_id, OLD.parent_invocation_id,
                 OLD.parent_operation_digest, OLD.child_identity_digest) THEN
            RAISE EXCEPTION 'native invocation read owner is immutable';
          END IF;
          RETURN NEW;
        END $$
    """)
    )
    op.execute(
        sa.text(
            f"CREATE TRIGGER native_read_owner_immutable BEFORE UPDATE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {quoted}builder_native_immutable_read_owner()"
        )
    )


def _unbind_native_read_owners() -> None:
    """Remove native continuation read ownership and immutability in the Builder migration."""
    require_empty_table(
        "dify_builder_native_invocation_states", "native invocation read owner evidence must be retained"
    )
    if is_mysql():
        op.execute("DROP TRIGGER native_read_owner_immutable")
    else:
        quoted = function_schema_prefix()
        op.execute("DROP TRIGGER native_read_owner_immutable ON dify_builder_native_invocation_states")
        op.execute(sa.text(f"DROP FUNCTION {quoted}builder_native_immutable_read_owner()"))
    op.drop_constraint("native_state_read_owner_pair", "dify_builder_native_invocation_states", type_="check")
    op.drop_column("dify_builder_native_invocation_states", "workflow_id")
    op.drop_column("dify_builder_native_invocation_states", "app_id")


def _create_dispatch_claims() -> None:
    """Install immutable native effect dispatch claims in the Builder migration."""
    table = "dify_builder_native_effect_dispatch_claims"
    op.create_table(
        table,
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("request_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", sa.String(128), nullable=False),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("attempt_id", StringUUID(), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("attempt_id", name="native_effect_dispatch_claim_attempt"),
        sa.UniqueConstraint("operation_id", name="native_effect_dispatch_claim_operation"),
    )
    if is_mysql():
        mysql_immutable_triggers(table, "native_effect_dispatch_claims_immutable", "native ledger is append-only")
        return
    quoted = function_schema_prefix()
    op.execute(
        sa.text(
            f"CREATE TRIGGER native_ledger_immutable BEFORE UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {quoted}builder_native_immutable_ledger()"
        )
    )


def _drop_dispatch_claims() -> None:
    """Remove immutable native effect dispatch claims in the Builder migration."""
    # Deleting evidence could let a lost response or restarted owner replay IO.
    # Serialize the empty check and DROP with every concurrent claim transaction.
    require_empty_table(
        "dify_builder_native_effect_dispatch_claims", "native dispatch claim evidence must be retained", lock=True
    )
    op.drop_table("dify_builder_native_effect_dispatch_claims")
    unlock_tables()


TABLE = "dify_builder_native_code_physical_operations"


def _regex(field: str, pattern: str) -> str:
    return f"REGEXP_LIKE({field}, '{pattern}', 'c')" if is_mysql() else f"{field} ~ '{pattern}'"


def _mysql_monotone(all_fields: tuple[str, ...]) -> None:
    identity = mysql_changed(
        (
            "id",
            "tenant_id",
            "actor_id",
            "request_id",
            "invocation_id",
            "operation_id",
            "attempt_id",
            "effect_claim_id",
            "host_dispatch_id",
            "host_acquisition_id",
            "root_invocation_id",
            "host_generation",
            "invocation_generation",
            "native_execution_id",
            "operation_digest",
            "intent_digest",
            "scope_id",
            "scope_generation",
            "scope_spec_digest",
            "environment_digest",
            "payload_digest",
            "profile_digest",
            "base_snapshot_ref",
            "base_snapshot_digest",
            "scope_expires_at",
        )
    )
    changed = mysql_changed(all_fields)
    ambiguous_changed = mysql_changed(("scope_create_acked", "job_reserved", "job_id", "input_may_have_been_sent"))
    mysql_program(f"""CREATE TRIGGER code_physical_monotone_update BEFORE UPDATE ON {TABLE}
        FOR EACH ROW BEGIN
        IF {identity} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Code physical identity is immutable'; END IF;
        IF (OLD.scope_create_acked AND NOT NEW.scope_create_acked)
           OR (OLD.job_reserved AND NOT NEW.job_reserved)
           OR (OLD.input_may_have_been_sent AND NOT NEW.input_may_have_been_sent)
           OR (OLD.ambiguous AND NOT NEW.ambiguous)
           OR (OLD.job_id IS NOT NULL AND NOT (BINARY NEW.job_id <=> BINARY OLD.job_id))
           OR NEW.observed_output_offset < OLD.observed_output_offset
           OR (OLD.destroyed_at IS NOT NULL AND ({changed}))
           OR (OLD.ambiguous AND ({ambiguous_changed})) THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT =
            'Code physical evidence cannot regress or dispatch after settlement';
        END IF; END""")
    mysql_program(f"""CREATE TRIGGER code_physical_monotone_delete BEFORE DELETE ON {TABLE}
        FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Code physical evidence must be retained'""")


def _create_code_physical_scopes() -> None:
    """Install native Code physical scopes and monotone execution evidence in the Builder migration."""
    table = op.create_table(
        TABLE,
        sa.Column("id", StringUUID(), primary_key=True),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("actor_id", StringUUID(), nullable=False),
        sa.Column("request_id", StringUUID(), nullable=False),
        sa.Column("invocation_id", sa.String(128), nullable=False),
        sa.Column("operation_id", StringUUID(), nullable=False),
        sa.Column("attempt_id", StringUUID(), nullable=False),
        sa.Column("effect_claim_id", StringUUID(), nullable=False),
        sa.Column("host_dispatch_id", StringUUID(), nullable=False),
        sa.Column("host_acquisition_id", StringUUID(), nullable=False),
        sa.Column("root_invocation_id", sa.String(128), nullable=False),
        sa.Column("host_generation", sa.BigInteger(), nullable=False),
        sa.Column("invocation_generation", sa.BigInteger(), nullable=False),
        sa.Column("native_execution_id", StringUUID(), nullable=False),
        sa.Column("operation_digest", sa.String(64), nullable=False),
        sa.Column("intent_digest", sa.String(64), nullable=False),
        sa.Column("scope_id", sa.String(37), nullable=False),
        sa.Column("scope_generation", sa.BigInteger(), nullable=False),
        sa.Column("scope_spec_digest", sa.String(64), nullable=False),
        sa.Column("environment_digest", sa.String(64), nullable=False),
        sa.Column("payload_digest", sa.String(64), nullable=False),
        sa.Column("profile_digest", sa.String(64), nullable=False),
        sa.Column("base_snapshot_ref", sa.String(96), nullable=False),
        sa.Column("base_snapshot_digest", sa.String(64), nullable=False),
        sa.Column("scope_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "scope_create_acked",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("job_reserved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "input_may_have_been_sent",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("ambiguous", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("job_id", sa.String(128), nullable=True),
        sa.Column(
            "observed_output_offset",
            sa.BigInteger(),
            nullable=False,
            server_default="0",
        ),
        sa.Column("destroyed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("operation_id", name="code_physical_operation_id"),
        sa.UniqueConstraint("attempt_id", name="code_physical_attempt_id"),
        sa.UniqueConstraint("effect_claim_id", name="code_physical_effect_claim_id"),
        sa.UniqueConstraint("scope_id", name="code_physical_scope_id"),
        sa.UniqueConstraint("scope_id", "scope_generation", "job_id", name="code_physical_scope_job"),
        sa.CheckConstraint(
            "host_generation >= 0 AND invocation_generation >= 0"
            " AND scope_generation = 1 AND observed_output_offset >= 0",
            name="code_physical_counts",
        ),
        sa.CheckConstraint(
            "job_id IS NULL OR (job_reserved AND scope_create_acked)",
            name="code_physical_job",
        ),
        sa.CheckConstraint(
            "NOT input_may_have_been_sent OR job_id IS NOT NULL",
            name="code_physical_input",
        ),
        sa.CheckConstraint("NOT job_reserved OR scope_create_acked", name="code_physical_reserve"),
        sa.CheckConstraint(_regex("scope_id", "^code_[0-9a-f]{32}$"), name="code_physical_scope"),
        sa.CheckConstraint(
            "job_id IS NULL OR " + _regex("job_id", "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"),
            name="code_physical_job_shape",
        ),
        sa.CheckConstraint(
            _regex("base_snapshot_ref", "^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$"),
            name="code_physical_snapshot",
        ),
        sa.CheckConstraint(
            " AND ".join(
                _regex(field, "^[0-9a-f]{64}$")
                for field in (
                    "operation_digest",
                    "intent_digest",
                    "scope_spec_digest",
                    "environment_digest",
                    "payload_digest",
                    "profile_digest",
                    "base_snapshot_digest",
                )
            ),
            name="code_physical_digests",
        ),
        sa.ForeignKeyConstraint(
            ["operation_id"],
            ["dify_builder_native_operations.id"],
            name="code_physical_fk_operation_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["attempt_id"],
            ["dify_builder_native_attempts.id"],
            name="code_physical_fk_attempt_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["effect_claim_id"],
            ["dify_builder_native_effect_dispatch_claims.id"],
            name="code_physical_fk_effect_claim_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["host_dispatch_id"],
            ["dify_builder_native_dispatches.id"],
            name="code_physical_fk_host_dispatch_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "request_id", "invocation_id"],
            [
                "dify_builder_native_invocations.tenant_id",
                "dify_builder_native_invocations.request_id",
                "dify_builder_native_invocations.invocation_id",
            ],
            name="code_physical_fk_invocation",
            ondelete="RESTRICT",
        ),
    )
    if is_mysql():
        _mysql_monotone(tuple(column.name for column in table.columns))
        return
    quoted = function_schema_prefix()
    op.execute(
        sa.text(f"""
    CREATE FUNCTION {quoted}builder_code_physical_monotone() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Code physical evidence must be retained';
      END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR
        NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
        NEW.actor_id IS DISTINCT FROM OLD.actor_id OR
        NEW.request_id IS DISTINCT FROM OLD.request_id OR
        NEW.invocation_id IS DISTINCT FROM OLD.invocation_id OR
        NEW.operation_id IS DISTINCT FROM OLD.operation_id OR
        NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR
        NEW.effect_claim_id IS DISTINCT FROM OLD.effect_claim_id OR
        NEW.host_dispatch_id IS DISTINCT FROM OLD.host_dispatch_id OR
        NEW.host_acquisition_id IS DISTINCT FROM OLD.host_acquisition_id OR
        NEW.root_invocation_id IS DISTINCT FROM OLD.root_invocation_id OR
        NEW.host_generation IS DISTINCT FROM OLD.host_generation OR
        NEW.invocation_generation IS DISTINCT FROM OLD.invocation_generation OR
        NEW.native_execution_id IS DISTINCT FROM OLD.native_execution_id OR
        NEW.operation_digest IS DISTINCT FROM OLD.operation_digest OR
        NEW.intent_digest IS DISTINCT FROM OLD.intent_digest OR
        NEW.scope_id IS DISTINCT FROM OLD.scope_id OR
        NEW.scope_generation IS DISTINCT FROM OLD.scope_generation OR
        NEW.scope_spec_digest IS DISTINCT FROM OLD.scope_spec_digest OR
        NEW.environment_digest IS DISTINCT FROM OLD.environment_digest OR
        NEW.payload_digest IS DISTINCT FROM OLD.payload_digest OR
        NEW.profile_digest IS DISTINCT FROM OLD.profile_digest OR
        NEW.base_snapshot_ref IS DISTINCT FROM OLD.base_snapshot_ref OR
        NEW.base_snapshot_digest IS DISTINCT FROM OLD.base_snapshot_digest OR
        NEW.scope_expires_at IS DISTINCT FROM OLD.scope_expires_at THEN
        RAISE EXCEPTION 'Code physical identity is immutable';
      END IF;
      IF (OLD.scope_create_acked AND NOT NEW.scope_create_acked)
        OR (OLD.job_reserved AND NOT NEW.job_reserved)
        OR (OLD.input_may_have_been_sent AND NOT NEW.input_may_have_been_sent)
        OR (OLD.ambiguous AND NOT NEW.ambiguous)
        OR (OLD.job_id IS NOT NULL AND NEW.job_id IS DISTINCT FROM OLD.job_id)
        OR NEW.observed_output_offset < OLD.observed_output_offset
        OR (OLD.destroyed_at IS NOT NULL AND NEW.destroyed_at IS DISTINCT FROM OLD.destroyed_at)
        OR (OLD.destroyed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
        OR (OLD.ambiguous AND (
          NEW.scope_create_acked IS DISTINCT FROM OLD.scope_create_acked
          OR NEW.job_reserved IS DISTINCT FROM OLD.job_reserved
          OR NEW.job_id IS DISTINCT FROM OLD.job_id
          OR NEW.input_may_have_been_sent IS DISTINCT FROM OLD.input_may_have_been_sent)) THEN
        RAISE EXCEPTION 'Code physical evidence cannot regress or dispatch after settlement';
      END IF;
      RETURN NEW;
    END $$
    """)
    )
    op.execute(
        sa.text(
            f"CREATE TRIGGER code_physical_monotone BEFORE UPDATE OR DELETE ON {TABLE} "
            f"FOR EACH ROW EXECUTE FUNCTION {quoted}builder_code_physical_monotone()"
        )
    )


def _drop_code_physical_scopes() -> None:
    """Remove native Code physical scopes and monotone execution evidence in the Builder migration."""
    require_empty_table(TABLE, "Code physical evidence must be retained", lock=True)
    op.drop_table(TABLE)
    unlock_tables()
    if not is_mysql():
        quoted = function_schema_prefix()
        op.execute(sa.text(f"DROP FUNCTION {quoted}builder_code_physical_monotone()"))


def _create_draft_coordination() -> None:
    """Install durable workflow draft coordination in the Builder migration."""
    op.create_table(
        "workflow_draft_coordination",
        sa.Column("id", StringUUID(), nullable=False),
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("app_id", StringUUID(), nullable=False),
        sa.Column("workflow_id", StringUUID(), nullable=False),
        sa.Column("workflow_version", sa.String(255), nullable=False),
        sa.Column("account_id", StringUUID(), nullable=True),
        sa.Column("retirement_agent_ids", AdjustedJSON(), nullable=False),
        sa.Column("emit_draft_event", sa.Boolean(), nullable=False),
        sa.Column("available_at", sa.DateTime(), nullable=False),
        sa.Column("claim_token", StringUUID(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("last_error", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="workflow_draft_coordination_pkey"),
        sa.CheckConstraint("attempt_count >= 0", name="workflow_draft_coordination_attempt_count"),
    )
    op.create_index(
        "workflow_draft_coordination_due", "workflow_draft_coordination", ["available_at", "created_at", "id"]
    )
    op.create_index(
        "workflow_draft_coordination_owner",
        "workflow_draft_coordination",
        ["tenant_id", "app_id", "workflow_id", "workflow_version"],
    )


def _drop_draft_coordination() -> None:
    """Remove durable workflow draft coordination in the Builder migration."""
    op.drop_index("workflow_draft_coordination_owner", table_name="workflow_draft_coordination")
    op.drop_index("workflow_draft_coordination_due", table_name="workflow_draft_coordination")
    op.drop_table("workflow_draft_coordination")


def _create_cognition_policies() -> None:
    """Install workspace Builder cognition policies and their revisions in the Builder migration."""
    op.create_table(
        "dify_builder_cognition_policies",
        sa.Column("tenant_id", StringUUID(), nullable=False),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("policy", sa.JSON(), nullable=False),
        sa.Column("updated_by", StringUUID(), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", name="builder_cognition_policy_pkey"),
        sa.CheckConstraint("revision > 0", name="builder_cognition_policy_revision"),
    )


def _drop_cognition_policies() -> None:
    """Remove workspace Builder cognition policies and their revisions in the Builder migration."""
    op.drop_table("dify_builder_cognition_policies")


def _create_material_receipts() -> None:
    """Install conversation-local Builder input and attachment receipts in the Builder migration."""
    op.create_table(
        "dify_builder_material",
        sa.Column("id", StringUUID, nullable=False),
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("owner_account_id", StringUUID, nullable=False),
        sa.Column("app_id", StringUUID, nullable=False),
        sa.Column("session_id", StringUUID, nullable=False),
        sa.Column("task_id", sa.String(255), nullable=False),
        sa.Column("generation", sa.Integer, nullable=False),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("client_turn_id", sa.String(128), nullable=False),
        sa.Column("input_digest", sa.String(64), nullable=False),
        sa.Column("text", LongText, nullable=False),
        sa.Column("uploads", AdjustedJSON, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("test_candidate", sa.Boolean, nullable=False),
        sa.Column("consumed_version", sa.Integer, nullable=True),
        sa.PrimaryKeyConstraint("id", name="dify_builder_material_pkey"),
        sa.UniqueConstraint("session_id", "client_turn_id", name="builder_material_turn_unique"),
        sa.UniqueConstraint("session_id", "seq", name="builder_material_seq_unique"),
    )
    op.create_index(
        "builder_material_owner_idx", "dify_builder_material", ["tenant_id", "owner_account_id", "app_id", "session_id"]
    )


def _drop_material_receipts() -> None:
    """Remove conversation-local Builder input and attachment receipts in the Builder migration."""
    op.drop_index("builder_material_owner_idx", table_name="dify_builder_material")
    op.drop_table("dify_builder_material")


def _create_workflow_writers() -> None:
    """Install workflow writer fences in the Builder migration."""
    op.create_table(
        "dify_builder_workflow_writers",
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("app_id", StringUUID, nullable=False),
        sa.Column("session_id", StringUUID, nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("generation", sa.Integer, nullable=False),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "app_id", name="builder_workflow_writer_pkey"),
    )
    op.create_index("builder_workflow_writer_session_idx", "dify_builder_workflow_writers", ["session_id"])


def _drop_workflow_writers() -> None:
    """Remove workflow writer fences in the Builder migration."""
    op.drop_index("builder_workflow_writer_session_idx", table_name="dify_builder_workflow_writers")
    op.drop_table("dify_builder_workflow_writers")


def _create_fix_intents() -> None:
    """Install durable Fix intents and the originating run task reference in the Builder migration."""
    op.add_column("dify_builder_runs", sa.Column("origin_task_id", sa.String(255), nullable=True))
    op.create_table(
        "dify_builder_fix_intents",
        sa.Column("id", StringUUID, nullable=False),
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("owner_account_id", StringUUID, nullable=False),
        sa.Column("app_id", StringUUID, nullable=False),
        sa.Column("session_id", StringUUID, nullable=False),
        sa.Column("target_task_id", sa.String(255), nullable=False),
        sa.Column("client_action_id", sa.String(128), nullable=False),
        sa.Column("input_digest", sa.String(64), nullable=False),
        sa.Column("source_digest", sa.String(64), nullable=False),
        sa.Column("source", AdjustedJSON, nullable=False),
        sa.Column("model_config", AdjustedJSON, nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("decision_id", sa.String(128), nullable=True),
        sa.Column("decision_kind", sa.String(32), nullable=True),
        sa.Column("enqueue", sa.String(16), nullable=False),
        sa.Column("command_id", StringUUID, nullable=True),
        sa.Column("activated_version", sa.Integer, nullable=True),
        sa.Column("response", AdjustedJSON, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.current_timestamp()),
        sa.PrimaryKeyConstraint("id", name="dify_builder_fix_intent_pkey"),
        sa.UniqueConstraint("session_id", "client_action_id", name="builder_fix_intent_action_unique"),
        sa.UniqueConstraint("session_id", "decision_id", name="builder_fix_intent_decision_unique"),
    )
    op.create_index(
        "builder_fix_intent_owner_idx",
        "dify_builder_fix_intents",
        ["tenant_id", "owner_account_id", "app_id", "session_id"],
    )


def _drop_fix_intents() -> None:
    """Remove durable Fix intents and the originating run task reference in the Builder migration."""
    op.drop_index("builder_fix_intent_owner_idx", table_name="dify_builder_fix_intents")
    op.drop_table("dify_builder_fix_intents")
    op.drop_column("dify_builder_runs", "origin_task_id")


def _add_canvas_path() -> None:
    """Add the nullable path or adopt the column already installed on local PostgreSQL."""
    op.add_column(
        "dify_builder_execution_requests",
        sa.Column("canvas_path", AdjustedJSON(), nullable=True),
        if_not_exists=op.get_context().dialect.name == "postgresql",
    )


def _drop_canvas_path() -> None:
    """Remove the display snapshot without altering the execution evidence."""
    with op.batch_alter_table("dify_builder_execution_requests") as batch_op:
        batch_op.drop_column("canvas_path")


def _check_downgrade_evidence() -> None:
    """Refuse a downgrade before DDL if protected native evidence remains.

    Quiesce Builder workers before calling downgrade. Individual teardown
    operations retain their existing locks around deleting replay fences.
    """
    require_empty_table(TABLE, "Code physical evidence must be retained")
    require_empty_table("dify_builder_native_effect_dispatch_claims", "native dispatch claim evidence must be retained")
    require_empty_table(
        "dify_builder_native_invocation_states", "native invocation read owner evidence must be retained"
    )
    require_empty_table(
        "dify_builder_execution_requests", "terminate native waits before downgrade", predicate="state='waiting'"
    )


def upgrade() -> None:
    """Install all Builder storage and native execution constraints on the main schema."""
    _create_builder_storage()
    _create_execution_requests()
    _create_real_call_consents()
    _create_native_ledger()
    _create_native_continuation()
    _bind_native_read_owners()
    _create_dispatch_claims()
    _create_code_physical_scopes()
    _create_draft_coordination()
    _create_cognition_policies()
    _create_material_receipts()
    _create_workflow_writers()
    _create_fix_intents()
    _add_canvas_path()


def downgrade() -> None:
    """Remove Builder storage from a quiesced database and restore the main schema.

    Protected native state causes refusal before any teardown. Other Builder
    data is removed along with its tables.
    """
    _check_downgrade_evidence()
    _drop_canvas_path()
    _drop_fix_intents()
    _drop_workflow_writers()
    _drop_material_receipts()
    _drop_cognition_policies()
    _drop_draft_coordination()
    _drop_code_physical_scopes()
    _drop_dispatch_claims()
    _unbind_native_read_owners()
    _drop_native_continuation()
    _drop_native_ledger()
    _drop_real_call_consents()
    _drop_execution_requests()
    _drop_builder_storage()

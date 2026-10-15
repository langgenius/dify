from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7

from .base import Base
from .types import AdjustedJSON, StringUUID


class DifyBuilderSession(Base):
    """
    DifyBuilder Session Model

    Durable state for a single dify-builder conversation: which app/tenant
    it belongs to, the entry mode it was started in, its current FSM state,
    and the `version` column used as the CAS counter for
    `Repository.compare_and_advance`.
    """

    __tablename__ = "dify_builder_sessions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_session_pkey"),
        sa.Index("dify_builder_session_tenant_idx", "tenant_id"),
        sa.Index("dify_builder_session_app_idx", "app_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    owner_account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    entry_mode: Mapped[str] = mapped_column(String(50), nullable=False)
    current_state: Mapped[str] = mapped_column(String(50), nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("1"))

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )


class DifyBuilderSessionCommit(Base):
    """
    DifyBuilder Session Commit Model

    One immutable row per session version, carrying the serialized
    `DifyBuilderContext` (`context`) as of that version. The latest commit by
    `version` for a given `session_id` is the session's current context.
    """

    __tablename__ = "dify_builder_session_commits"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_session_commit_pkey"),
        sa.Index("dify_builder_session_commit_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(50), nullable=False)
    context: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    actor: Mapped[str] = mapped_column(String(50), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class DifyBuilderSnapshot(Base):
    """
    DifyBuilder Snapshot Model

    A content-addressed snapshot of a workflow graph (`hash` + `graph`)
    captured during a dify_builder session, referenced by checkpoints.
    """

    __tablename__ = "dify_builder_snapshots"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_snapshot_pkey"),
        sa.Index("dify_builder_snapshot_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    hash: Mapped[str] = mapped_column(String(255), nullable=False)
    graph: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class DifyBuilderCheckpoint(Base):
    """
    DifyBuilder Checkpoint Model

    A named point in a dify_builder session's history (`state`) pinned to a
    `DifyBuilderSnapshot` (`snapshot_id`, no FK per house style).
    """

    __tablename__ = "dify_builder_checkpoints"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_checkpoint_pkey"),
        sa.Index("dify_builder_checkpoint_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    state: Mapped[str] = mapped_column(String(50), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class DifyBuilderRun(Base):
    """
    DifyBuilder Run Model

    A single execution (verify/publish/etc.) driven by the dify_builder, including
    per-node results and whether the row is `immutable` once finalized.
    """

    __tablename__ = "dify_builder_runs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_run_pkey"),
        sa.Index("dify_builder_run_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    dify_run_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    per_node: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)
    verification: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)
    culprit_node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Launch-failure text captured when a verify run throws before any node runs.
    error: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    inputs_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tokens: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    elapsed_ms: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    immutable: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class DifyBuilderConversationItem(Base):
    """
    DifyBuilder Conversation Item Model

    One ordered message/event (`seq`) in a dify_builder session's conversation
    log. `(session_id, seq)` is unique — the DB is the seq-authority.
    """

    __tablename__ = "dify_builder_conversation_items"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_conversation_item_pkey"),
        sa.UniqueConstraint("session_id", "seq", name="dify_builder_conversation_item_session_seq_key"),
        sa.Index("dify_builder_conversation_item_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    seq: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    at_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class DifyBuilderTestInput(Base):
    """
    DifyBuilder Test Input Model

    A saved set of workflow test inputs (`inputs`) captured during a dify_builder
    session, keyed to the workflow's start-schema shape (`start_schema_hash`)
    so stale inputs can be detected.
    """

    __tablename__ = "dify_builder_test_inputs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_test_input_pkey"),
        sa.Index("dify_builder_test_input_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    inputs: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    start_schema_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    http_fixtures: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class DifyBuilderExecutionRequest(Base):
    """Immutable prepared policy and bounded append-only runtime observations.

    Launch and append mutations require a row lock. Native Run rows remain
    authoritative; completion sealing is owned by the later native adapter.
    """

    __tablename__ = "dify_builder_execution_requests"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_execution_request_pkey"),
        sa.Index("dify_builder_execution_request_session_idx", "session_id"),
        sa.Index("dify_builder_execution_request_app_idx", "tenant_id", "app_id"),
        sa.CheckConstraint(
            "state IN ('prepared','running','sealed') OR "
            "(state = 'waiting' AND COALESCE(context->>'policy_version', '') = 'builder-native-test-v1')",
            name="builder_execution_request_state",
        ),
        sa.Index(
            "builder_native_waiting_idx", "tenant_id", "app_id", "state", postgresql_where=sa.text("state = 'waiting'")
        ),
    )

    id: Mapped[str] = mapped_column(StringUUID)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    actor_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    test_input_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    context: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    context_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="prepared")
    native_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    observations: Mapped[list] = mapped_column(AdjustedJSON, nullable=False, default=list)
    completion_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    completion_summary: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DifyBuilderRealCallConsent(Base):
    """One human-approved, one-shot real Tool call and its durable spends.

    ``binding`` and ``disclosure`` are frozen at preparation; ``scope_digest``
    is the keyed HMAC of that binding. Each public operation keeps its own
    idempotency key, body digest and saved receipt. Launch reservation, the
    grant claim and each phase claim are separate one-way spends; the counter
    CHECKs make a second phase spend unrepresentable. Revisions are opaque
    HMACs and stay internal. No secret, ciphertext or message content is
    stored here: native Run rows and the execution sidecar own outputs.
    Mutations are owned by ``BuilderRealCallConsentService`` under row locks.
    """

    __tablename__ = "dify_builder_real_call_consents"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dify_builder_real_call_consent_pkey"),
        sa.UniqueConstraint(
            "tenant_id", "actor_id", "session_id", "prepare_key", name="dify_builder_real_call_consent_prepare_key"
        ),
        sa.UniqueConstraint("execution_request_id", name="dify_builder_real_call_consent_request_key"),
        sa.UniqueConstraint("command_id", name="dify_builder_real_call_consent_command_key"),
        sa.Index("dify_builder_real_call_consent_session_idx", "session_id"),
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

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    actor_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    prepared_commit_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    test_input_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    prepared_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    binding: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    scope_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    disclosure: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    disclosure_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    decision: Mapped[str | None] = mapped_column(String(16), nullable=True)
    execution_request_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    command_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    reserved_version: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    reserved_commit_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    prepare_key: Mapped[str] = mapped_column(String(128), nullable=False)
    prepare_body_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    prepare_receipt: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    confirm_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    confirm_body_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confirm_receipt: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)
    execute_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    execute_body_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    execute_receipt: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    refresh_claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    business_claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    refresh_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0, server_default=sa.text("0"))
    business_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0, server_default=sa.text("0"))
    initial_credential_revision: Mapped[str] = mapped_column(String(64), nullable=False)
    derived_credential_revision: Mapped[str | None] = mapped_column(String(64), nullable=True)
    oauth_client_revision: Mapped[str] = mapped_column(String(64), nullable=False)
    native_run_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    native_node_execution_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    outcome_state: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reason_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

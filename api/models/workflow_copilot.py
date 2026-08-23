from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from libs.uuid_utils import uuidv7

from .base import Base
from .types import AdjustedJSON, StringUUID


class CopilotSession(Base):
    """
    Copilot Session Model

    Durable state for a single workflow-copilot conversation: which app/tenant
    it belongs to, the entry mode it was started in, its current FSM state,
    and the `version` column used as the CAS counter for
    `Repository.compare_and_advance`.
    """

    __tablename__ = "workflow_copilot_sessions"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_session_pkey"),
        sa.Index("workflow_copilot_session_tenant_idx", "tenant_id"),
        sa.Index("workflow_copilot_session_app_idx", "app_id"),
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


class CopilotSessionCommit(Base):
    """
    Copilot Session Commit Model

    One immutable row per session version, carrying the serialized
    `CopilotContext` (`context`) as of that version. The latest commit by
    `version` for a given `session_id` is the session's current context.
    """

    __tablename__ = "workflow_copilot_session_commits"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_session_commit_pkey"),
        sa.Index("workflow_copilot_session_commit_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    version: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(50), nullable=False)
    context: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    actor: Mapped[str] = mapped_column(String(50), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class CopilotSnapshot(Base):
    """
    Copilot Snapshot Model

    A content-addressed snapshot of a workflow graph (`hash` + `graph`)
    captured during a copilot session, referenced by checkpoints.
    """

    __tablename__ = "workflow_copilot_snapshots"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_snapshot_pkey"),
        sa.Index("workflow_copilot_snapshot_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    hash: Mapped[str] = mapped_column(String(255), nullable=False)
    graph: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class CopilotCheckpoint(Base):
    """
    Copilot Checkpoint Model

    A named point in a copilot session's history (`state`) pinned to a
    `CopilotSnapshot` (`snapshot_id`, no FK per house style).
    """

    __tablename__ = "workflow_copilot_checkpoints"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_checkpoint_pkey"),
        sa.Index("workflow_copilot_checkpoint_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    state: Mapped[str] = mapped_column(String(50), nullable=False)
    snapshot_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class CopilotRun(Base):
    """
    Copilot Run Model

    A single execution (verify/publish/etc.) driven by the copilot, including
    per-node results and whether the row is `immutable` once finalized.
    """

    __tablename__ = "workflow_copilot_runs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_run_pkey"),
        sa.Index("workflow_copilot_run_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    dify_run_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    per_node: Mapped[dict | None] = mapped_column(AdjustedJSON, nullable=True)
    culprit_node_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    inputs_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tokens: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    elapsed_ms: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    immutable: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class CopilotConversationItem(Base):
    """
    Copilot Conversation Item Model

    One ordered message/event (`seq`) in a copilot session's conversation
    log. `(session_id, seq)` is unique — the DB is the seq-authority.
    """

    __tablename__ = "workflow_copilot_conversation_items"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_conversation_item_pkey"),
        sa.UniqueConstraint("session_id", "seq", name="workflow_copilot_conversation_item_session_seq_key"),
        sa.Index("workflow_copilot_conversation_item_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    seq: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    at_version: Mapped[int] = mapped_column(sa.Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())


class CopilotTestInput(Base):
    """
    Copilot Test Input Model

    A saved set of workflow test inputs (`inputs`) captured during a copilot
    session, keyed to the workflow's start-schema shape (`start_schema_hash`)
    so stale inputs can be detected.
    """

    __tablename__ = "workflow_copilot_test_inputs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_test_input_pkey"),
        sa.Index("workflow_copilot_test_input_session_idx", "session_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, default=lambda: str(uuidv7()))
    session_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    inputs: Mapped[dict] = mapped_column(AdjustedJSON, nullable=False)
    start_schema_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, server_default=func.current_timestamp())

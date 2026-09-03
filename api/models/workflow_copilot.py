"""SQLAlchemy models for the Workflow Copilot feature.

Workflow Copilot is the in-editor conversational assistant that incrementally
builds / edits a workflow graph. These tables persist the *meta-conversation*
(the chat between the user and the copilot), which is intentionally kept
separate from the runtime ``conversations`` / ``messages`` tables: those carry
App-execution semantics (``mode``, billing, ``app_model_config_id`` ...) that
do not apply to an editor-side design dialogue.

Two tables:

- ``WorkflowCopilotConversation``: one copilot session, scoped to a tenant +
  app + account. Holds the rolling ``summary`` (compressed memory) and a
  ``summarized_message_count`` cursor marking how many of the oldest messages
  the summary already covers.
- ``WorkflowCopilotMessage``: a single turn (``user`` / ``assistant``). Stores
  ``tokens`` (computed via ``model_instance.get_llm_num_tokens``) so the memory
  service can decide when to compress in O(1) without re-tokenising.

See ``docs/design/workflow-copilot/memory-and-persistence.md`` for the full
design, including the compression algorithm and cache strategy.
"""

import sqlalchemy as sa
from sqlalchemy import Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, DefaultFieldsMixin
from .types import LongText, StringUUID


class WorkflowCopilotConversation(DefaultFieldsMixin, Base):
    """One Workflow Copilot session for a given tenant / app / account.

    ``summary`` is the rolling, LLM-compressed memory of older turns; it is
    empty until the accumulated (unsummarized) token count first crosses the
    compression threshold. ``summarized_message_count`` is the sliding-window
    cursor: messages with an index below it are already folded into ``summary``
    and are no longer sent verbatim.
    """

    __tablename__ = "workflow_copilot_conversations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_conversation_pkey"),
        Index("workflow_copilot_conversation_owner_idx", "tenant_id", "app_id", "account_id"),
    )

    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    account_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    summary: Mapped[str] = mapped_column(LongText, nullable=False, default="")
    summarized_message_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)


class WorkflowCopilotMessage(DefaultFieldsMixin, Base):
    """A single turn within a :class:`WorkflowCopilotConversation`.

    ``role`` is ``user`` or ``assistant``. ``tokens`` is the model-counted token
    length of ``content``, persisted so the memory service can sum unsummarized
    tokens cheaply when deciding whether to trigger compression.
    """

    __tablename__ = "workflow_copilot_messages"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="workflow_copilot_message_pkey"),
        Index("workflow_copilot_message_conversation_idx", "conversation_id", "created_at"),
    )

    conversation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(LongText, nullable=False, default="")
    tokens: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)

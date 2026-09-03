"""Rolling memory compression for Workflow Copilot conversations.

Long copilot dialogues would otherwise blow the planner's context window and
grow cost linearly. This service keeps a conversation's memory as
``summary`` (LLM-compressed older turns) + the most recent ``K`` verbatim
turns, and compresses only when the unsummarized token count crosses a
threshold — the "auto-compress past a token threshold" strategy.

Why not reuse ``core.memory.TokenBufferMemory``: that class only *truncates*
(drops oldest messages) and is hard-bound to the App ``Conversation`` / ``Message``
ORM. We borrow its token-window idea but add real LLM summarization against the
copilot's own tables.

Design: ``docs/design/workflow-copilot/memory-and-persistence.md`` §4.
"""

import logging
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.helper.workflow_copilot_cache import (
    CachedCopilotMemory,
    CachedCopilotMessage,
    WorkflowCopilotMemoryCache,
)
from core.model_manager import ModelInstance
from graphon.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage
from models.workflow_copilot import WorkflowCopilotConversation, WorkflowCopilotMessage

logger = logging.getLogger(__name__)

# Compress once the unsummarized turns exceed this many tokens. Generous enough
# that short sessions never pay the summarization cost, small enough to stay
# well inside every mainstream context window alongside the graph payload.
COMPRESS_THRESHOLD_TOKENS = 3000

# Always keep at least this many of the most recent messages verbatim, even
# right after a compression, so "continue the previous step" stays precise.
RECENT_KEEP_COUNT = 6

_SUMMARY_SYSTEM_PROMPT = (
    "You maintain a running summary of a conversation between a user and an AI "
    "assistant that incrementally builds a Dify workflow graph. Merge the "
    "existing summary with the new messages into a concise summary that "
    "preserves: what the workflow does, node types added/removed, key "
    "decisions, and unresolved intents. Output only the updated summary text."
)


class WorkflowCopilotMemoryService:
    """Assembles per-turn memory and performs rolling compression.

    Stateless service object bound to one ``ModelInstance`` (used both for
    token counting and for the summarization LLM call).
    """

    model_instance: ModelInstance

    def __init__(self, model_instance: ModelInstance) -> None:
        self.model_instance = model_instance

    def count_tokens(self, text: str) -> int:
        """Token count for a single piece of text, via the bound model."""
        if not text:
            return 0
        return self.model_instance.get_llm_num_tokens([UserPromptMessage(content=text)])

    def build_history_text(self, summary: str, recent_messages: Sequence[CachedCopilotMessage]) -> str:
        """Render ``summary`` + recent turns into the text injected into the planner.

        Empty string when there is no prior context (first turn), so the
        generator behaves exactly like a from-scratch request.
        """
        sections: list[str] = []
        if summary:
            sections.append(f"[Summary of earlier conversation]\n{summary}")
        if recent_messages:
            lines = [f"{m['role'].capitalize()}: {m['content']}" for m in recent_messages]
            sections.append("[Recent turns]\n" + "\n".join(lines))
        return "\n\n".join(sections)

    def load_memory(self, session: Session, conversation: WorkflowCopilotConversation) -> CachedCopilotMemory:
        """Return assembled memory for a conversation, using Redis then DB.

        The cache stores the already-assembled ``summary`` + recent verbatim
        turns. On a miss we rebuild from DB (summary field + messages after the
        summarized cursor) and backfill the cache.
        """
        cache = WorkflowCopilotMemoryCache(conversation.id)
        cached = cache.get()
        if cached is not None:
            return cached

        recent = self._load_unsummarized_messages(session, conversation)
        memory = CachedCopilotMemory(
            summary=conversation.summary or "",
            recent_messages=[CachedCopilotMessage(role=m.role, content=m.content) for m in recent],
        )
        cache.set(memory)
        return memory

    def compress_if_needed(self, session: Session, conversation: WorkflowCopilotConversation) -> None:
        """Roll older turns into ``summary`` when unsummarized tokens exceed the threshold.

        Keeps the most recent ``RECENT_KEEP_COUNT`` messages verbatim; everything
        older than that (and not yet summarized) is merged — together with the
        existing summary — into a new summary via one ``invoke_llm`` call. The
        ``summarized_message_count`` cursor advances so those turns are no longer
        replayed verbatim. Best-effort: a summarization failure is logged and
        left for the next turn rather than breaking the user's request.
        """
        unsummarized = self._load_unsummarized_messages(session, conversation)
        total_tokens = sum(m.tokens for m in unsummarized)
        if total_tokens <= COMPRESS_THRESHOLD_TOKENS or len(unsummarized) <= RECENT_KEEP_COUNT:
            return

        to_compress = unsummarized[: len(unsummarized) - RECENT_KEEP_COUNT]
        if not to_compress:
            return

        history_lines = [f"{m.role.capitalize()}: {m.content}" for m in to_compress]
        user_content = ""
        if conversation.summary:
            user_content += f"Existing summary:\n{conversation.summary}\n\n"
        user_content += "New messages to fold in:\n" + "\n".join(history_lines)

        prompt_messages: list[PromptMessage] = [
            SystemPromptMessage(content=_SUMMARY_SYSTEM_PROMPT),
            UserPromptMessage(content=user_content),
        ]

        try:
            result = self.model_instance.invoke_llm(
                prompt_messages=prompt_messages,
                model_parameters={"temperature": 0.3, "max_tokens": 800},
                stream=False,
            )
            new_summary = result.message.get_text_content().strip()
        except Exception:
            logger.exception("Workflow copilot: memory compression failed for conversation %s", conversation.id)
            return

        if not new_summary:
            return

        conversation.summary = new_summary
        conversation.summarized_message_count += len(to_compress)
        session.flush()
        # Invalidate the hot cache so the next read rebuilds with the new summary.
        WorkflowCopilotMemoryCache(conversation.id).delete()

    def _load_unsummarized_messages(
        self, session: Session, conversation: WorkflowCopilotConversation
    ) -> list[WorkflowCopilotMessage]:
        """Messages not yet folded into ``summary``, oldest first."""
        stmt = (
            select(WorkflowCopilotMessage)
            .where(WorkflowCopilotMessage.conversation_id == conversation.id)
            .order_by(WorkflowCopilotMessage.created_at.asc())
            .offset(conversation.summarized_message_count)
        )
        return list(session.execute(stmt).scalars().all())

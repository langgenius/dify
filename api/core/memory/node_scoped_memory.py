from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid5

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.model_manager import ModelInstance
from core.model_runtime.entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageRole,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.variables.segments import ObjectSegment
from core.variables.types import SegmentType
from extensions.ext_database import db
from factories import variable_factory
from models.workflow import ConversationVariable

# A stable namespace to derive deterministic IDs for node-scoped memories.
# Using uuid5 to keep (conversation_id, node_id) mapping stable across runs.
# NOTE: UUIDs must contain only hexadecimal characters; avoid letters beyond 'f'.
NODE_SCOPED_MEMORY_NS = UUID("00000000-0000-0000-0000-000000000000")


@dataclass
class _HistoryItem:
    role: str
    text: str


@dataclass
class NodeScopedMemory:
    """A per-node conversation memory persisted in ConversationVariable.

    - Keyed by (conversation_id, node_id)
    - Value is stored as a conversation variable named _llm_mem.<node_id>
    - Structure (JSON): {"version": 1, "history": [{"role": "user"|"assistant", "text": "..."}, ...]}
    """

    app_id: str
    conversation_id: str
    node_id: str
    model_instance: ModelInstance

    _loaded: bool = field(default=False, init=False)
    _history: list[_HistoryItem] = field(default_factory=list, init=False)

    @property
    def variable_name(self) -> str:
        return f"_llm_mem.{self.node_id}"

    @property
    def variable_id(self) -> str:
        # Deterministic id so we can upsert by (id, conversation_id)
        return str(uuid5(NODE_SCOPED_MEMORY_NS, f"{self.conversation_id}:{self.node_id}:llmmem"))

    # ------------ Persistence helpers ------------
    def _load_if_needed(self) -> None:
        if self._loaded:
            return
        stmt = select(ConversationVariable).where(
            ConversationVariable.id == self.variable_id,
            ConversationVariable.conversation_id == self.conversation_id,
        )
        with Session(db.engine, expire_on_commit=False) as session:
            row = session.scalar(stmt)
            if not row:
                self._history = []
                self._loaded = True
                return
            variable = row.to_variable()
            value = variable.value if isinstance(variable.value, dict) else {}
            hist = value.get("history", []) if isinstance(value, dict) else []
            parsed: list[_HistoryItem] = []
            for item in hist:
                try:
                    role = str(item.get("role", ""))
                    text = str(item.get("text", ""))
                except Exception:
                    role, text = "", ""
                if role and text:
                    parsed.append(_HistoryItem(role=role, text=text))
            self._history = parsed
            self._loaded = True

    def _dump_variable(self) -> Any:
        data = {
            "version": 1,
            "history": [{"role": item.role, "text": item.text} for item in self._history if item.text],
        }
        segment = ObjectSegment(value=data, value_type=SegmentType.OBJECT)
        variable = variable_factory.segment_to_variable(
            segment=segment,
            selector=["conversation", self.variable_name],
            id=self.variable_id,
            name=self.variable_name,
            description="LLM node-scoped memory",
        )
        return variable

    def save(self) -> None:
        variable = self._dump_variable()
        with Session(db.engine) as session:
            # Upsert by (id, conversation_id)
            existing = session.scalar(
                select(ConversationVariable).where(
                    ConversationVariable.id == self.variable_id,
                    ConversationVariable.conversation_id == self.conversation_id,
                )
            )
            if existing:
                existing.data = variable.model_dump_json()
            else:
                obj = ConversationVariable.from_variable(
                    app_id=self.app_id, conversation_id=self.conversation_id, variable=variable
                )
                session.add(obj)
            session.commit()

    # ------------ Public API expected by LLM node ------------
    def get_history_prompt_messages(
        self, *, max_token_limit: int = 2000, message_limit: int | None = None
    ) -> Sequence[PromptMessage]:
        self._load_if_needed()

        # Optionally limit by message count (pairs flattened)
        items: list[_HistoryItem] = list(self._history)
        if message_limit and message_limit > 0:
            # message_limit roughly means last N items (not pairs) to keep simple and efficient
            items = items[-min(message_limit, len(items)) :]

        def to_messages(hist: list[_HistoryItem]) -> list[PromptMessage]:
            msgs: list[PromptMessage] = []
            for it in hist:
                if it.role == PromptMessageRole.USER.value:
                    # Persisted node memory only stores text; inject as plain text content
                    msgs.append(UserPromptMessage(content=it.text))
                elif it.role == PromptMessageRole.ASSISTANT.value:
                    msgs.append(AssistantPromptMessage(content=it.text))
            return msgs

        messages = to_messages(items)
        # Token-based pruning from oldest
        if messages:
            tokens = self.model_instance.get_llm_num_tokens(messages)
            while tokens > max_token_limit and len(messages) > 1:
                messages.pop(0)
                tokens = self.model_instance.get_llm_num_tokens(messages)
        return messages

    def get_history_prompt_text(
        self,
        *,
        human_prefix: str = "Human",
        ai_prefix: str = "Assistant",
        max_token_limit: int = 2000,
        message_limit: int | None = None,
    ) -> str:
        self._load_if_needed()
        items: list[_HistoryItem] = list(self._history)
        if message_limit and message_limit > 0:
            items = items[-min(message_limit, len(items)) :]

        # Build messages to reuse token counting logic
        messages: list[PromptMessage] = []
        for it in items:
            role_name = (
                PromptMessageRole.USER
                if it.role == PromptMessageRole.USER.value
                else (PromptMessageRole.ASSISTANT if it.role == PromptMessageRole.ASSISTANT.value else None)
            )
            if role_name is None:
                continue
            prefix = human_prefix if role_name == PromptMessageRole.USER else ai_prefix
            messages.append(
                UserPromptMessage(content=f"{prefix}: {it.text}")
                if role_name == PromptMessageRole.USER
                else AssistantPromptMessage(content=f"{prefix}: {it.text}")
            )

        if messages:
            tokens = self.model_instance.get_llm_num_tokens(messages)
            while tokens > max_token_limit and len(messages) > 1:
                messages.pop(0)
                tokens = self.model_instance.get_llm_num_tokens(messages)

        # Convert back to the required text format
        lines: list[str] = []
        for m in messages:
            if m.role == PromptMessageRole.USER:
                prefix = human_prefix
            elif m.role == PromptMessageRole.ASSISTANT:
                prefix = ai_prefix
            else:
                continue
            if isinstance(m.content, list):
                # Only text content was saved in this minimal implementation
                texts = [c.data for c in m.content if isinstance(c, TextPromptMessageContent)]
                text = "\n".join(texts)
            else:
                text = str(m.content)
            lines.append(f"{prefix}: {text}")
        return "\n".join(lines)

    def append_exchange(self, *, user_text: str | None, assistant_text: str | None) -> None:
        self._load_if_needed()
        if user_text:
            self._history.append(_HistoryItem(role=PromptMessageRole.USER.value, text=user_text))
        if assistant_text:
            self._history.append(_HistoryItem(role=PromptMessageRole.ASSISTANT.value, text=assistant_text))

    def clear(self) -> None:
        self._history = []
        self._loaded = True
        self.save()

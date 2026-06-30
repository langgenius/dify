"""
Weaviate Engram long-term memory integration.

Engram is Weaviate's managed memory service: raw conversation turns are written
fire-and-forget (``store``) and processed asynchronously into durable, scoped
memories, which can later be recalled (``recall``) to augment the prompt context.

This module is a thin, config-gated wrapper over the ``weaviate-engram`` SDK. The
SDK is imported lazily so the dependency is only required when the feature is
enabled, and every network call is best-effort: failures are logged and never
propagate, so memory I/O can never break chat generation or message persistence.
"""

import logging
import threading
from collections.abc import Sequence
from typing import Any

from configs import dify_config

logger = logging.getLogger(__name__)

# Message role/content mapping reused for conversation-style memory writes.
MemoryMessage = dict[str, Any]

_engram_client: Any | None = None
_engram_client_lock = threading.Lock()


def is_engram_enabled() -> bool:
    """Returns True when the Engram memory layer is enabled and configured."""
    return bool(dify_config.ENGRAM_ENABLED and dify_config.ENGRAM_API_KEY)


def _get_client() -> Any:
    """
    Lazily constructs and caches a module-level Engram client.

    The ``engram`` package is imported here (not at module import time) so the
    optional dependency is only needed when the feature is actually enabled.
    """
    global _engram_client
    if _engram_client is not None:
        return _engram_client

    with _engram_client_lock:
        if _engram_client is not None:
            return _engram_client

        from engram import EngramClient

        kwargs: dict[str, Any] = {"api_key": dify_config.ENGRAM_API_KEY}
        if dify_config.ENGRAM_ENDPOINT:
            kwargs["base_url"] = dify_config.ENGRAM_ENDPOINT

        _engram_client = EngramClient(**kwargs)
        return _engram_client


class EngramMemory:
    """
    Per-user view over the Engram memory service, scoped to a conversation.

    Args:
        user_id: The end-user identifier memories are isolated by.
        conversation_id: Optional conversation id stored as a scope property so
            memories can be filtered per conversation.
    """

    def __init__(self, user_id: str, conversation_id: str | None = None):
        self._user_id = user_id
        self._conversation_id = conversation_id

    def _properties(self) -> dict[str, str] | None:
        if self._conversation_id:
            # Engram requires str-valued scope properties.
            return {"conversation_id": str(self._conversation_id)}
        return None

    def store(self, input_data: str | Sequence[MemoryMessage]) -> str | None:
        """
        Writes a memory fire-and-forget. ``input_data`` may be a plain string or a
        list of OpenAI-style ``{"role", "content"}`` messages. Returns the Engram
        run id, or None when disabled or on failure (never raises).
        """
        if not is_engram_enabled() or not self._user_id:
            return None
        try:
            client = _get_client()
            run = client.memories.add(input_data, user_id=self._user_id, properties=self._properties())
            return getattr(run, "run_id", None)
        except Exception:
            logger.warning("Engram memory store failed for user %s", self._user_id, exc_info=True)
            return None

    def recall(self, query: str, top_k: int | None = None) -> str | None:
        """
        Searches stored memories for ``query`` and returns up to ``top_k`` of them
        formatted as a bullet list for prompt injection, or None when disabled,
        empty, or on failure (never raises).
        """
        if not is_engram_enabled() or not self._user_id or not query:
            return None
        limit = top_k or dify_config.ENGRAM_RECALL_TOP_K
        try:
            client = _get_client()
            results = client.memories.search(query=query, user_id=self._user_id)
            contents: list[str] = []
            for memory in results:
                content = getattr(memory, "content", None)
                if content:
                    contents.append(str(content))
                if len(contents) >= limit:
                    break
            if not contents:
                return None
            return "\n".join(f"- {c}" for c in contents)
        except Exception:
            logger.warning("Engram memory recall failed for user %s", self._user_id, exc_info=True)
            return None

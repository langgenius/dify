"""
Weaviate Engram long-term memory integration.

Engram is Weaviate's managed memory service: raw conversation turns are written
fire-and-forget (``store``) and processed asynchronously into durable, scoped
memories, which can later be recalled (``recall``) to augment the prompt context.

This module is a thin wrapper over the ``weaviate-engram`` SDK. Credentials are
resolved per app (per bot): each app may carry its own Engram API key/endpoint,
falling back to the deployment-wide ENGRAM_* settings when left blank. The SDK is
imported lazily so the optional dependency is only required when the feature is
used, and every network call is best-effort — failures are logged and never
propagate, so memory I/O can never break chat generation or message persistence.
"""

import logging
import threading
from collections.abc import Sequence
from typing import Any

from configs import dify_config
from core.helper.encrypter import decrypt_token

logger = logging.getLogger(__name__)

# Message role/content mapping reused for conversation-style memory writes.
MemoryMessage = dict[str, Any]

# Engram clients are cached per (api_key, endpoint) so each distinct per-app credential reuses one
# client instead of rebuilding it per request.
_engram_clients: dict[tuple[str, str | None], Any] = {}
_engram_client_lock = threading.Lock()


def _get_client(api_key: str, endpoint: str | None) -> Any:
    """
    Lazily constructs and caches an Engram client for the given credentials.

    The ``engram`` package is imported here (not at module import time) so the optional dependency
    is only needed when the feature is actually used.
    """
    cache_key = (api_key, endpoint)
    client = _engram_clients.get(cache_key)
    if client is not None:
        return client

    with _engram_client_lock:
        client = _engram_clients.get(cache_key)
        if client is not None:
            return client

        from engram import EngramClient

        kwargs: dict[str, Any] = {"api_key": api_key}
        if endpoint:
            kwargs["base_url"] = endpoint

        client = EngramClient(**kwargs)
        _engram_clients[cache_key] = client
        return client


class EngramMemory:
    """
    Per-user view over the Engram memory service, scoped to a conversation, using a specific
    (already resolved) Engram credential.

    Prefer :func:`build_engram_memory` to construct an instance from a per-app config; it applies
    the enable gate, decryption, and deployment-wide credential fallback.

    Args:
        user_id: The end-user identifier memories are isolated by.
        api_key: Engram API key (already resolved and decrypted).
        endpoint: Optional Engram base URL; defaults to the managed Weaviate Cloud endpoint.
        conversation_id: Optional conversation id used as a scope property when conversation
            scoping is enabled.
    """

    def __init__(self, *, user_id: str, api_key: str, endpoint: str | None = None, conversation_id: str | None = None):
        self._user_id = user_id
        self._api_key = api_key
        self._endpoint = endpoint
        self._conversation_id = conversation_id

    def _properties(self) -> dict[str, str] | None:
        """
        Scope properties applied to both store and recall so the two stay consistent.

        Sending a scope property Engram doesn't recognize makes it reject the request, so the
        conversation scope is opt-in: it is only sent when ENGRAM_CONVERSATION_SCOPE_ENABLED is set
        and the deployment's Engram project has 'conversation_id' configured as a scope property.
        Returns None otherwise, scoping memories by user_id alone (works against any Engram group).
        """
        if dify_config.ENGRAM_CONVERSATION_SCOPE_ENABLED and self._conversation_id:
            # Engram requires str-valued scope properties.
            return {"conversation_id": str(self._conversation_id)}
        return None

    def store(self, input_data: str | Sequence[MemoryMessage]) -> str | None:
        """
        Writes a memory fire-and-forget. ``input_data`` may be a plain string or a
        list of OpenAI-style ``{"role", "content"}`` messages. Returns the Engram
        run id, or None when unusable or on failure (never raises).
        """
        if not self._api_key or not self._user_id:
            return None
        try:
            client = _get_client(self._api_key, self._endpoint)
            run = client.memories.add(input_data, user_id=self._user_id, properties=self._properties())
            return getattr(run, "run_id", None)
        except Exception:
            logger.warning("Engram memory store failed for user %s", self._user_id, exc_info=True)
            return None

    def recall(self, query: str, top_k: int | None = None) -> str | None:
        """
        Searches stored memories for ``query`` and returns up to ``top_k`` of them
        formatted as a bullet list for prompt injection, or None when unusable,
        empty, or on failure (never raises).
        """
        if not self._api_key or not self._user_id or not query:
            return None
        limit = top_k or dify_config.ENGRAM_RECALL_TOP_K
        try:
            client = _get_client(self._api_key, self._endpoint)
            results = client.memories.search(query=query, user_id=self._user_id, properties=self._properties())
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


def build_engram_memory(
    *,
    user_id: str,
    tenant_id: str,
    conversation_id: str | None = None,
    enabled: bool,
    api_key_encrypted: str | None = None,
    endpoint: str | None = None,
) -> EngramMemory | None:
    """
    Resolve a per-app Engram config into a usable :class:`EngramMemory`, or None when memory is
    off or unusable.

    Precedence (per-bot authoritative): ``enabled`` gates the app. The API key is the app's own key
    (decrypted with the tenant key) when set; otherwise it falls back to the deployment-wide
    ENGRAM_API_KEY, but only when ENGRAM_ENABLED is on. The endpoint falls back to ENGRAM_ENDPOINT
    only when the deployment key is used. Returns None when disabled, missing a user id, or when no
    API key can be resolved — so a bot with Engram off, or a deployment without any credentials,
    simply skips store/recall.
    """
    if not enabled or not user_id:
        return None

    api_key: str | None = None
    resolved_endpoint = endpoint
    if api_key_encrypted:
        try:
            api_key = decrypt_token(tenant_id, api_key_encrypted)
        except Exception:
            logger.warning("Failed to decrypt per-app Engram API key for tenant %s", tenant_id, exc_info=True)
            api_key = None

    if not api_key and dify_config.ENGRAM_ENABLED:
        api_key = dify_config.ENGRAM_API_KEY
        resolved_endpoint = resolved_endpoint or dify_config.ENGRAM_ENDPOINT

    if not api_key:
        return None

    return EngramMemory(
        user_id=user_id,
        api_key=api_key,
        endpoint=resolved_endpoint,
        conversation_id=conversation_id,
    )

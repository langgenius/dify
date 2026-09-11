"""Redis hot cache for Workflow Copilot conversation memory.

DB is the source of truth; this cache only accelerates the per-turn read of a
conversation's assembled memory (rolling ``summary`` + recent verbatim turns),
so we don't re-query + re-assemble on every message.

Mirrors ``core/helper/model_provider_cache.py``: JSON value written with a TTL
via ``redis_client.setex``. On a cache miss the caller rebuilds from DB and
calls :meth:`set` to backfill. Cache is invalidated (overwritten) whenever a
new message is stored or the summary is recompressed.

See ``docs/design/workflow-copilot/memory-and-persistence.md`` §5.
"""

import json
from json import JSONDecodeError
from typing import TypedDict

from extensions.ext_redis import redis_client

# 30 minutes: long enough to serve an active editing session, short enough that
# an abandoned conversation's memory doesn't linger in Redis indefinitely.
_CACHE_TTL_SECONDS = 1800


class CachedCopilotMessage(TypedDict):
    role: str
    content: str


class CachedCopilotMemory(TypedDict):
    """The assembled memory served to the generator for one conversation."""

    summary: str
    recent_messages: list[CachedCopilotMessage]


class WorkflowCopilotMemoryCache:
    """Per-conversation hot cache of assembled copilot memory."""

    cache_key: str

    def __init__(self, conversation_id: str) -> None:
        self.cache_key = f"workflow_copilot:mem:{conversation_id}"

    def get(self) -> CachedCopilotMemory | None:
        cached = redis_client.get(self.cache_key)
        if not cached:
            return None
        try:
            payload = json.loads(cached.decode("utf-8"))
        except (JSONDecodeError, UnicodeDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        summary = payload.get("summary", "")
        recent = payload.get("recent_messages", [])
        if not isinstance(summary, str) or not isinstance(recent, list):
            return None
        return CachedCopilotMemory(summary=summary, recent_messages=recent)

    def set(self, memory: CachedCopilotMemory) -> None:
        redis_client.setex(self.cache_key, _CACHE_TTL_SECONDS, json.dumps(memory))

    def delete(self) -> None:
        redis_client.delete(self.cache_key)

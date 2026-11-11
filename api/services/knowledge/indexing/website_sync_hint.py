"""Best-effort Redis ownership hints for website synchronization."""

from collections.abc import Callable
from typing import Any, Protocol

WEBSITE_SYNC_HINT_TTL_SECONDS = 600

_DELETE_IF_OWNER_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


class RedisScriptClient(Protocol):
    def register_script(self, script: str) -> Callable[..., Any]: ...


def website_sync_hint_key(document_id: str) -> str:
    return f"document_{document_id}_is_sync"


def delete_website_sync_hint_if_owned(
    redis: RedisScriptClient,
    *,
    document_id: str,
    owner_id: str,
) -> bool:
    """Atomically delete a hint only when it still belongs to this intent."""
    script = redis.register_script(_DELETE_IF_OWNER_LUA)
    return bool(script(keys=[website_sync_hint_key(document_id)], args=[owner_id]))

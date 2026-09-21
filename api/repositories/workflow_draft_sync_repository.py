"""Short-lived coordination for converting a server draft into one CRDT update.

The accepted bytes are replayed on retries. This is not storage for the live
collaborative document; ordinary editor updates still use the existing relay.
"""

import json

from pydantic import BaseModel

from extensions.ext_redis import redis_client
from extensions.redis_names import serialize_redis_name

DRAFT_SYNC_TTL_SECONDS = 3600
DRAFT_SYNC_LEASE_SECONDS = 15

_ANNOUNCE = """
local current = redis.call('GET', KEYS[1])
local incoming = cjson.decode(ARGV[1])
if current then
    current = cjson.decode(current)
    if current.revision >= incoming.revision then
        return 0
    end
    incoming.base_update = current.base_update
    if current.update ~= cjson.null then incoming.base_update = current.update end
    if current.update == cjson.null and incoming.previous_graph ~= cjson.null then
        incoming.previous_graph = current.previous_graph
    end
end
redis.call('SET', KEYS[1], cjson.encode(incoming), 'EX', ARGV[2])
return 1
"""

_ACCEPT = """
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.revision ~= ARGV[2] or current.update ~= cjson.null then return 0 end
current.update = ARGV[3]
current.base_update = cjson.null
current.previous_graph = cjson.null
redis.call('SET', KEYS[1], cjson.encode(current), 'EX', ARGV[4])
return 1
"""

_RELEASE = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


class ServerDraftChange(BaseModel):
    revision: str
    hash: str
    updated_at: int
    graph: dict[str, object]
    previous_graph: dict[str, object] | None = None
    base_update: str | None = None
    update: str | None = None


class WorkflowDraftSyncRepository:
    @staticmethod
    def _key(app_id: str) -> str:
        return f"workflow_server_draft:{app_id}"

    @staticmethod
    def _lease_key(app_id: str) -> str:
        return f"workflow_server_draft_lease:{app_id}"

    def announce(self, app_id: str, change: ServerDraftChange) -> bool:
        # Lua only inspects coordination metadata. Keep graphs as JSON strings
        # so cjson cannot turn empty arrays into objects or round node values.
        payload = change.model_dump()
        payload["graph"] = json.dumps(change.graph)
        payload["previous_graph"] = json.dumps(change.previous_graph) if change.previous_graph is not None else None
        return bool(
            redis_client.eval(
                _ANNOUNCE,
                1,
                serialize_redis_name(self._key(app_id)),
                json.dumps(payload),
                DRAFT_SYNC_TTL_SECONDS,
            )
        )

    def get(self, app_id: str) -> ServerDraftChange | None:
        raw = redis_client.get(self._key(app_id))
        if not raw:
            return None
        payload = json.loads(raw)
        payload["graph"] = json.loads(payload["graph"])
        if payload["previous_graph"] is not None:
            payload["previous_graph"] = json.loads(payload["previous_graph"])
        return ServerDraftChange.model_validate(payload)

    def claim(self, app_id: str, token: str) -> bool:
        return bool(redis_client.set(self._lease_key(app_id), token, nx=True, ex=DRAFT_SYNC_LEASE_SECONDS))

    def accept(self, app_id: str, token: str, revision: str, update: str) -> bool:
        return bool(
            redis_client.eval(
                _ACCEPT,
                2,
                serialize_redis_name(self._key(app_id)),
                serialize_redis_name(self._lease_key(app_id)),
                token,
                revision,
                update,
                DRAFT_SYNC_TTL_SECONDS,
            )
        )

    def release(self, app_id: str, token: str) -> None:
        redis_client.eval(_RELEASE, 1, serialize_redis_name(self._lease_key(app_id)), token)

    def clear(self, app_id: str) -> None:
        redis_client.delete(self._key(app_id), self._lease_key(app_id))

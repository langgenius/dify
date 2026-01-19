from __future__ import annotations

import json
from typing import TypedDict

from extensions.ext_redis import redis_client

SESSION_STATE_TTL_SECONDS = 3600
WORKFLOW_ONLINE_USERS_PREFIX = "workflow_online_users:"
WORKFLOW_LEADER_PREFIX = "workflow_leader:"
WS_SID_MAP_PREFIX = "ws_sid_map:"


class WorkflowSessionInfo(TypedDict):
    user_id: str
    username: str
    avatar: str | None
    sid: str
    connected_at: int


class SidMapping(TypedDict):
    workflow_id: str
    user_id: str


class WorkflowCollaborationRepository:
    def __init__(self) -> None:
        self._redis = redis_client

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(redis_client={self._redis})"

    @staticmethod
    def workflow_key(workflow_id: str) -> str:
        return f"{WORKFLOW_ONLINE_USERS_PREFIX}{workflow_id}"

    @staticmethod
    def leader_key(workflow_id: str) -> str:
        return f"{WORKFLOW_LEADER_PREFIX}{workflow_id}"

    @staticmethod
    def sid_key(sid: str) -> str:
        return f"{WS_SID_MAP_PREFIX}{sid}"

    @staticmethod
    def _decode(value: str | bytes | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, bytes):
            return value.decode("utf-8")
        return value

    def refresh_session_state(self, workflow_id: str, sid: str) -> None:
        workflow_key = self.workflow_key(workflow_id)
        sid_key = self.sid_key(sid)
        if self._redis.exists(workflow_key):
            self._redis.expire(workflow_key, SESSION_STATE_TTL_SECONDS)
        if self._redis.exists(sid_key):
            self._redis.expire(sid_key, SESSION_STATE_TTL_SECONDS)

    def set_session_info(self, workflow_id: str, session_info: WorkflowSessionInfo) -> None:
        workflow_key = self.workflow_key(workflow_id)
        self._redis.hset(workflow_key, session_info["sid"], json.dumps(session_info))
        self._redis.set(
            self.sid_key(session_info["sid"]),
            json.dumps({"workflow_id": workflow_id, "user_id": session_info["user_id"]}),
            ex=SESSION_STATE_TTL_SECONDS,
        )
        self.refresh_session_state(workflow_id, session_info["sid"])

    def get_sid_mapping(self, sid: str) -> SidMapping | None:
        raw = self._redis.get(self.sid_key(sid))
        if not raw:
            return None
        value = self._decode(raw)
        if not value:
            return None
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return None

    def delete_session(self, workflow_id: str, sid: str) -> None:
        self._redis.hdel(self.workflow_key(workflow_id), sid)
        self._redis.delete(self.sid_key(sid))

    def session_exists(self, workflow_id: str, sid: str) -> bool:
        return bool(self._redis.hexists(self.workflow_key(workflow_id), sid))

    def sid_mapping_exists(self, sid: str) -> bool:
        return bool(self._redis.exists(self.sid_key(sid)))

    def get_session_sids(self, workflow_id: str) -> list[str]:
        raw_sids = self._redis.hkeys(self.workflow_key(workflow_id))
        return [self._decode(sid) for sid in raw_sids if self._decode(sid)]

    def list_sessions(self, workflow_id: str) -> list[WorkflowSessionInfo]:
        sessions_json = self._redis.hgetall(self.workflow_key(workflow_id))
        users: list[WorkflowSessionInfo] = []

        for session_info_json in sessions_json.values():
            value = self._decode(session_info_json)
            if not value:
                continue
            try:
                session_info = json.loads(value)
            except (TypeError, json.JSONDecodeError):
                continue

            if not isinstance(session_info, dict):
                continue
            if "user_id" not in session_info or "username" not in session_info or "sid" not in session_info:
                continue

            users.append(
                {
                    "user_id": str(session_info["user_id"]),
                    "username": str(session_info["username"]),
                    "avatar": session_info.get("avatar"),
                    "sid": str(session_info["sid"]),
                    "connected_at": int(session_info.get("connected_at") or 0),
                }
            )

        return users

    def get_current_leader(self, workflow_id: str) -> str | None:
        raw = self._redis.get(self.leader_key(workflow_id))
        return self._decode(raw)

    def set_leader_if_absent(self, workflow_id: str, sid: str) -> bool:
        return bool(
            self._redis.set(self.leader_key(workflow_id), sid, nx=True, ex=SESSION_STATE_TTL_SECONDS)
        )

    def set_leader(self, workflow_id: str, sid: str) -> None:
        self._redis.set(self.leader_key(workflow_id), sid, ex=SESSION_STATE_TTL_SECONDS)

    def delete_leader(self, workflow_id: str) -> None:
        self._redis.delete(self.leader_key(workflow_id))

    def expire_leader(self, workflow_id: str) -> None:
        self._redis.expire(self.leader_key(workflow_id), SESSION_STATE_TTL_SECONDS)

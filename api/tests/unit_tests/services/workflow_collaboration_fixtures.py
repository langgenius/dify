"""Stateful Redis command transport for collaboration service tests."""

from collections.abc import Sequence

from repositories.workflow_collaboration_repository import WorkflowCollaborationRepository, WorkflowSessionInfo


class RedisState:
    """Store strings and hashes; reject commands this test transport does not implement."""

    def __init__(self) -> None:
        self.values: dict[bytes, bytes] = {}
        self.hashes: dict[bytes, dict[bytes, bytes]] = {}
        self.expirations: dict[bytes, int] = {}

    @staticmethod
    def _bytes(value: object) -> bytes:
        return value if isinstance(value, bytes) else str(value).encode()

    def execute(self, command: str, *args: object, **_kwargs: object) -> object:
        key = self._bytes(args[0])
        match command:
            case "GET":
                return self.values.get(key)
            case "SET" | "SETEX":
                if "NX" in args and key in self.values:
                    return None
                self.values[key] = self._bytes(args[2] if command == "SETEX" else args[1])
                if command == "SETEX":
                    self.expirations[key] = int(str(args[1]))
                elif "EX" in args:
                    self.expirations[key] = int(str(args[args.index("EX") + 1]))
                return True
            case "EXISTS":
                return int(key in self.values or bool(self.hashes.get(key)))
            case "EXPIRE":
                if key not in self.values and not self.hashes.get(key):
                    return False
                self.expirations[key] = int(str(args[1]))
                return True
            case "TTL":
                return self.expirations.get(key, -1)
            case "DEL":
                existed = key in self.values or key in self.hashes
                self.values.pop(key, None)
                self.hashes.pop(key, None)
                self.expirations.pop(key, None)
                return int(existed)
            case "HSET":
                fields = self.hashes.setdefault(key, {})
                field = self._bytes(args[1])
                added = field not in fields
                fields[field] = self._bytes(args[2])
                return int(added)
            case "HGET":
                return self.hashes.get(key, {}).get(self._bytes(args[1]))
            case "HGETALL":
                return self.hashes.get(key, {}).copy()
            case "HKEYS":
                return list(self.hashes.get(key, {}))
            case "HEXISTS":
                return self._bytes(args[1]) in self.hashes.get(key, {})
            case "HDEL":
                return int(self.hashes.get(key, {}).pop(self._bytes(args[1]), None) is not None)
            case _:
                raise AssertionError(f"Unexpected Redis command: {command}")


def seed_session(
    repository: WorkflowCollaborationRepository,
    sid: str,
    *,
    user_id: str = "u-1",
) -> None:
    repository.set_session_info(
        "wf-1", {"sid": sid, "user_id": user_id, "username": user_id, "avatar": None, "connected_at": 1}
    )


def seed_sessions(repository: WorkflowCollaborationRepository, sessions: Sequence[WorkflowSessionInfo]) -> None:
    for session in sessions:
        repository.set_session_info("wf-1", session)

"""In-memory Redis command handling for tests that patch the client's ``execute_command``."""

from operator import itemgetter

from redis import RedisError


def _as_bytes(value: object) -> bytes:
    return value if isinstance(value, bytes) else str(value).encode()


class RedisCommandEmulator:
    """Serve the string and sorted-set commands the invitation token store sends."""

    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.sorted_sets: dict[str, dict[str, float]] = {}
        self.failing: set[str] = set()

    def __call__(self, command: str, *args: object, **_kwargs: object) -> object:
        if command in self.failing:
            raise RedisError(f"{command} unavailable")
        key = str(args[0]) if args else ""
        if command == "GET":
            return self.values.get(key)
        if command in {"SETEX", "SET"}:
            value = args[2] if command == "SETEX" else args[1]
            self.values[key] = _as_bytes(value)
            return b"OK"
        if command == "DEL":
            return int(self.values.pop(key, None) is not None)
        if command == "PTTL":
            return 3_600_000 if key in self.values else -2
        if command == "ZADD":
            members = self.sorted_sets.setdefault(key, {})
            pairs = args[1:]
            members.update({str(pairs[i + 1]): float(str(pairs[i])) for i in range(0, len(pairs), 2)})
            return 1
        if command == "ZREM":
            return int(self.sorted_sets.get(key, {}).pop(str(args[1]), None) is not None)
        if command == "ZREMRANGEBYSCORE":
            members = self.sorted_sets.get(key, {})
            maximum = float(str(args[2]))
            self.sorted_sets[key] = {member: score for member, score in members.items() if score > maximum}
            return 0
        if command == "ZRANGEBYSCORE":
            minimum = str(args[1])
            members = self.sorted_sets.get(key, {})
            entries = sorted(members.items(), key=itemgetter(1))
            if minimum.startswith("("):
                entries = [(member, score) for member, score in entries if score > float(minimum[1:])]
            return [(member.encode(), score) for member, score in entries]
        if command == "EXPIRE":
            return 1
        raise AssertionError(f"unexpected Redis command {command}")

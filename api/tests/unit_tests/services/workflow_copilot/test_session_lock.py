"""Tests for the cross-process Redis session-advance lock.

The real lock is acquired in the web process (dispatch) and released in the
Celery process (task), so it cannot rely on ``redis_client.lock()``'s
context manager, which ties acquire+release to a single object/process.
These tests model Redis with a small stateful in-memory fake rather than
``fakeredis`` (not installed in this venv) and verify the SET-NX-token +
compare-del contract directly.
"""

from unittest.mock import patch

from services.workflow_copilot import session_lock

SESSION_ID = "11111111-1111-1111-1111-111111111111"


class FakeRedis:
    """Minimal stateful fake modeling the subset of the redis contract
    ``session_lock`` relies on: NX-set, get, and a Lua compare-del emulated
    without actually running Lua.
    """

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, name: str, value: str, nx: bool = False, px: int | None = None) -> bool | None:  # noqa: ARG002
        if nx and name in self.store:
            return None
        self.store[name] = value
        return True

    def get(self, name: str) -> str | None:
        return self.store.get(name)

    def eval(self, script: str, numkeys: int, *args: str) -> int:  # noqa: ARG002
        key, token = args[0], args[1]
        if self.store.get(key) == token:
            del self.store[key]
            return 1
        return 0


def test_acquire_returns_token_when_free() -> None:
    fake = FakeRedis()
    with patch("services.workflow_copilot.session_lock.redis_client", fake):
        token = session_lock.acquire(SESSION_ID)

    assert token is not None
    assert isinstance(token, str)


def test_acquire_returns_none_when_already_held() -> None:
    fake = FakeRedis()
    with patch("services.workflow_copilot.session_lock.redis_client", fake):
        first = session_lock.acquire(SESSION_ID)
        second = session_lock.acquire(SESSION_ID)

    assert first is not None
    assert second is None


def test_release_with_right_token_frees_the_lock() -> None:
    fake = FakeRedis()
    with patch("services.workflow_copilot.session_lock.redis_client", fake):
        token = session_lock.acquire(SESSION_ID)
        assert token is not None
        session_lock.release(SESSION_ID, token)

        reacquired = session_lock.acquire(SESSION_ID)

    assert reacquired is not None


def test_release_with_wrong_token_does_not_free_the_lock() -> None:
    fake = FakeRedis()
    with patch("services.workflow_copilot.session_lock.redis_client", fake):
        token = session_lock.acquire(SESSION_ID)
        assert token is not None
        session_lock.release(SESSION_ID, "not-the-real-token")

        still_held = session_lock.acquire(SESSION_ID)

    assert still_held is None


def test_exists_reflects_held_and_free_state() -> None:
    fake = FakeRedis()
    with patch("services.workflow_copilot.session_lock.redis_client", fake):
        assert session_lock.exists(SESSION_ID) is False

        token = session_lock.acquire(SESSION_ID)
        assert token is not None
        assert session_lock.exists(SESSION_ID) is True

        session_lock.release(SESSION_ID, token)
        assert session_lock.exists(SESSION_ID) is False

"""The expiring marker that tells the graph page a build is queued or running."""

import pytest

from services.knowledge import graph_build_state


class _FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, object] = {}
        self.ttls: dict[str, int] = {}

    def setex(self, name: str, time: int, value: object) -> None:
        self.values[name] = value
        self.ttls[name] = time

    def delete(self, name: str) -> None:
        self.values.pop(name, None)
        self.ttls.pop(name, None)

    def exists(self, name: str) -> int:
        return int(name in self.values)


@pytest.fixture
def redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr(graph_build_state, "redis_client", fake)
    return fake


@pytest.mark.usefixtures("redis")
def test_a_marked_build_is_active_until_it_is_cleared() -> None:
    assert not graph_build_state.is_graph_build_active("dataset-1")

    graph_build_state.mark_graph_build_active("dataset-1")

    assert graph_build_state.is_graph_build_active("dataset-1")
    # Other knowledge bases are unaffected.
    assert not graph_build_state.is_graph_build_active("dataset-2")

    graph_build_state.clear_graph_build("dataset-1")

    assert not graph_build_state.is_graph_build_active("dataset-1")


def test_the_marker_expires_so_a_crashed_worker_cannot_leave_the_page_spinning(redis: _FakeRedis) -> None:
    graph_build_state.mark_graph_build_active("dataset-1")

    assert redis.ttls == {"knowledge_graph_build:dataset-1": 15 * 60}

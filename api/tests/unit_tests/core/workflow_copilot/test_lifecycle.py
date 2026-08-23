"""Slice 4 session-lifecycle-core tests: restore_graph, invalidation, revert,
checkpoint surfacing, pause/resume."""

from core.workflow_copilot.models import Actor
from core.workflow_copilot.ports import DifyPort
from tests.unit_tests.core.workflow_copilot.fakes import FakeBuildDifyPort, FakeDifyPort


def _actor() -> Actor:
    return Actor(account_id="a", tenant_id="t")


def test_fake_dify_port_restore_graph_swaps_graph_and_returns_hash():
    dify = FakeDifyPort()
    dify.graph = {"nodes": [{"id": "x"}]}
    snapshot = {"nodes": [{"id": "start"}, {"id": "end"}]}
    new_hash = dify.restore_graph("app", _actor(), snapshot)
    assert isinstance(new_hash, str)
    assert new_hash
    got, got_hash = dify.read_graph("app", _actor())
    assert got == snapshot
    assert got_hash == new_hash
    # deep-copied: mutating the caller's graph does not corrupt the fake
    snapshot["nodes"].append({"id": "leak"})
    assert len(dify.read_graph("app", _actor())[0]["nodes"]) == 2


def test_fake_build_dify_port_restore_graph_swaps_graph():
    dify = FakeBuildDifyPort()
    dify.graph = {"nodes": [{"id": "a"}], "edges": []}
    snapshot = {"nodes": [], "edges": []}
    dify.restore_graph("app", _actor(), snapshot)
    assert dify.read_graph("app", _actor())[0] == {"nodes": [], "edges": []}


def test_fake_dify_ports_still_satisfy_dify_port_protocol():
    assert isinstance(FakeDifyPort(), DifyPort)
    assert isinstance(FakeBuildDifyPort(), DifyPort)

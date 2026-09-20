"""Exercise revision and lease fencing against Redis's actual Lua implementation."""

import uuid

import pytest

from repositories.workflow_draft_sync_repository import ServerDraftChange, WorkflowDraftSyncRepository

pytestmark = pytest.mark.usefixtures("flask_app_with_containers")


def test_only_the_current_lease_can_accept_one_update_for_the_current_revision():
    repository = WorkflowDraftSyncRepository()
    app_id = uuid.uuid4().hex
    first = ServerDraftChange(revision="1", hash="h1", updated_at=1, graph={"nodes": [], "edges": []})
    assert repository.announce(app_id, first)
    assert repository.claim(app_id, "old")
    assert not repository.claim(app_id, "new")

    repository.release(app_id, "old")
    assert repository.claim(app_id, "new")
    repository.release(app_id, "old")
    assert not repository.claim(app_id, "third")
    assert not repository.accept(app_id, "old", "1", "b2xk")

    second = first.model_copy(update={"revision": "2", "hash": "h2", "updated_at": 2})
    assert repository.announce(app_id, second)
    assert not repository.accept(app_id, "new", "1", "b2xk")
    assert repository.accept(app_id, "new", "2", "bmV3")
    assert not repository.accept(app_id, "new", "2", "b3RoZXI=")
    assert not repository.announce(app_id, first)
    stored = repository.get(app_id)
    assert stored is not None
    assert stored.revision == "2"
    assert stored.update == "bmV3"
    assert stored.graph == {"nodes": [], "edges": []}


def test_pending_changes_keep_the_original_baseline_and_whole_graph_restores_remain_explicit():
    repository = WorkflowDraftSyncRepository()
    app_id = uuid.uuid4().hex
    before = {"nodes": [{"id": "a", "data": {"items": [], "seed": 9007199254740993}}], "edges": []}
    after = {"nodes": [{"id": "b"}], "edges": []}
    first = ServerDraftChange(revision="1", hash="h1", updated_at=1, graph=after, previous_graph=before)
    assert repository.announce(app_id, first)
    second = ServerDraftChange(revision="2", hash="h2", updated_at=2, graph=before, previous_graph=after)
    assert repository.announce(app_id, second)
    stored = repository.get(app_id)
    assert stored is not None
    assert stored.previous_graph == before
    assert stored.graph == before

    assert repository.claim(app_id, "writer")
    assert repository.accept(app_id, "writer", "2", "YWNjb3Jk")
    third = first.model_copy(update={"revision": "3"})
    assert repository.announce(app_id, third)
    stored = repository.get(app_id)
    assert stored is not None
    assert stored.base_update == "YWNjb3Jk"
    assert stored.previous_graph == before

    restore = ServerDraftChange(revision="4", hash="h4", updated_at=4, graph={"nodes": [], "edges": []})
    assert repository.announce(app_id, restore)
    stored = repository.get(app_id)
    assert stored is not None
    assert stored.previous_graph is None
    assert stored.base_update == "YWNjb3Jk"
    assert stored.graph == {"nodes": [], "edges": []}

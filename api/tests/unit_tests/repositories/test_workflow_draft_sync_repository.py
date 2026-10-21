import json

import pytest

from repositories import workflow_draft_sync_repository as repo_module
from repositories.workflow_draft_sync_repository import ServerDraftChange, WorkflowDraftSyncRepository


@pytest.mark.parametrize("previous", [None, {"nodes": [], "edges": []}])
def test_graphs_stay_opaque_to_lua_and_round_trip_without_changing_values(
    previous: dict[str, object] | None, monkeypatch: pytest.MonkeyPatch, mocker
) -> None:
    redis = repo_module.redis_client
    mocker.patch.object(redis, "eval", return_value=1)
    mocker.patch.object(redis, "get")
    monkeypatch.setattr(repo_module, "serialize_redis_name", lambda key: f"prefix:{key}")
    repository = WorkflowDraftSyncRepository()
    change = ServerDraftChange(
        revision="revision-1",
        hash="hash-1",
        updated_at=1,
        graph={"nodes": [{"id": "node", "data": {"items": [], "seed": 9007199254740993}}], "edges": []},
        previous_graph=previous,
    )

    assert repository.announce("app", change)

    _script, key_count, key, payload, _ttl = redis.eval.call_args.args
    assert key_count == 1
    assert key == "prefix:workflow_server_draft:app"
    encoded = json.loads(payload)
    assert isinstance(encoded["graph"], str)
    assert encoded["previous_graph"] is None or isinstance(encoded["previous_graph"], str)
    redis.get.return_value = payload.encode()
    assert repository.get("app") == change

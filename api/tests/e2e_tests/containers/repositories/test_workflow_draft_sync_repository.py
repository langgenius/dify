"""Exercise revision and lease fencing against Redis's actual Lua implementation."""

from __future__ import annotations

import socket
import time
import uuid
from collections.abc import Iterator

import pytest
from redis import Redis, RedisCluster
from testcontainers.redis import RedisContainer

from configs import dify_config
from core.dify_builder.models import Graph
from enums import DeploymentEdition
from extensions.ext_redis import RedisClientWrapper
from repositories import workflow_draft_sync_repository as repo_module
from repositories.workflow_draft_sync_repository import ServerDraftChange, WorkflowDraftSyncRepository


@pytest.mark.usefixtures("flask_app_with_containers")
def test_only_the_current_lease_can_accept_one_update_for_the_current_revision() -> None:
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


@pytest.mark.usefixtures("flask_app_with_containers")
def test_pending_changes_keep_the_original_baseline_and_whole_graph_restores_remain_explicit() -> None:
    repository = WorkflowDraftSyncRepository()
    app_id = uuid.uuid4().hex
    before: Graph = {"nodes": [{"id": "a", "data": {"items": [], "seed": 9007199254740993}}], "edges": []}
    after: Graph = {"nodes": [{"id": "b"}], "edges": []}
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


@pytest.fixture(scope="module")
def cluster_client() -> Iterator[RedisCluster[bytes]]:
    """Provide a real single-node Cluster that enforces multi-key slot restrictions."""
    command = (
        "redis-server --cluster-enabled yes --cluster-config-file nodes.conf "
        "--cluster-node-timeout 5000 --appendonly no --protected-mode no"
    )
    with RedisContainer(image="redis:7-alpine").with_command(command) as container:
        host = container.get_container_host_ip()
        port = int(container.get_exposed_port(6379))
        announced_ip = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)[0][4][0]
        with Redis(host=host, port=port, decode_responses=False) as node:
            node.config_set("cluster-announce-ip", announced_ip)
            node.config_set("cluster-announce-port", port)
            node.execute_command("CLUSTER", "ADDSLOTSRANGE", 0, 16383)
            deadline = time.monotonic() + 5
            while b"cluster_state:ok" not in node.execute_command("CLUSTER", "INFO"):
                if time.monotonic() >= deadline:
                    raise TimeoutError("Redis Cluster did not become ready")
                time.sleep(0.05)
        with RedisCluster(host=host, port=port, decode_responses=False) as client:
            yield client


@pytest.mark.parametrize("prefix", ["", "dify-review"])
def test_cloud_draft_sync_accepts_and_clears_updates_on_cluster_with_builder_disabled(
    cluster_client: RedisCluster[bytes], monkeypatch: pytest.MonkeyPatch, prefix: str
) -> None:
    monkeypatch.setattr(dify_config, "REDIS_KEY_PREFIX", prefix)
    monkeypatch.setattr(dify_config, "DIFY_BUILDER_ENABLED", False)
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    redis = RedisClientWrapper()
    redis.initialize(cluster_client)
    monkeypatch.setattr(repo_module, "redis_client", redis)
    repository = WorkflowDraftSyncRepository()
    app_id = str(uuid.uuid4())
    change = ServerDraftChange(revision="1", hash="h1", updated_at=1, graph={"nodes": [], "edges": []})

    try:
        assert repository.announce(app_id, change)
        assert repository.claim(app_id, "writer")
        assert repository.accept(app_id, "writer", change.revision, "dXBkYXRl")
        stored = repository.get(app_id)
        assert stored == change.model_copy(update={"update": "dXBkYXRl"})
        repository.release(app_id, "writer")
        assert repository.claim(app_id, "next-writer")
    finally:
        repository.clear(app_id)

    assert repository.get(app_id) is None
    assert repository.claim(app_id, "after-clear")
    repository.release(app_id, "after-clear")

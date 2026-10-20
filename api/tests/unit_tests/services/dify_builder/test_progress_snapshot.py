"""Current-worker progress recovery, including tenant and lease isolation."""

import json
from dataclasses import asdict
from unittest.mock import MagicMock

import pytest

from configs import dify_config
from core.dify_builder.contract import ExecutionActivity, ExecutionProgress
from extensions.redis_names import serialize_redis_name
from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.presentation import copy_text
from services.dify_builder import progress_snapshot, session_lock


def _snapshot() -> progress_snapshot.ProgressSnapshot:
    return progress_snapshot.ProgressSnapshot(
        session_id="session-1",
        operation_id="operation-1",
        at_version=3,
        revision=7,
        reply_language="zh-Hans",
        execution=ExecutionProgress(
            status="running",
            activities=[
                ExecutionActivity(
                    id="inspect", label=copy_text(BuilderCopyId.PROGRESS_INSPECT_THE_CURRENT_WORKFLOW), state="done"
                ),
                ExecutionActivity(id="plan", label="Generate change plan", state="active"),
                ExecutionActivity(id="node:llm", label="LLM", state="active", kind="node", parent_id="plan"),
            ],
        ),
    )


@pytest.fixture
def redis(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    client = MagicMock()
    monkeypatch.setattr(progress_snapshot, "redis_client", client)
    monkeypatch.setattr(session_lock, "redis_client", client)
    return client


@pytest.mark.parametrize("prefix", ["", "deployment"])
def test_save_scopes_snapshot_to_tenant_session_and_activated_owner(
    redis: MagicMock, monkeypatch: pytest.MonkeyPatch, prefix: str
) -> None:
    monkeypatch.setattr(dify_config, "REDIS_KEY_PREFIX", prefix)
    snapshot = _snapshot()

    progress_snapshot.save(snapshot, tenant_id="tenant-1", owner="activated-owner")

    args = redis.eval.call_args.args
    assert args[1:6] == (
        1,
        serialize_redis_name("dify_builder:progress:tenant-1:session-1:activated-owner"),
        3,
        "operation-1",
        7,
    )
    assert json.loads(args[6]) == asdict(snapshot)
    assert args[7] == session_lock.active_advance_time_limit()


def test_read_restores_ordered_steps_states_locale_and_node_parent(redis: MagicMock) -> None:
    snapshot = _snapshot()
    raw = json.dumps(asdict(snapshot)).encode()
    redis.get.side_effect = [b"activated-owner", raw, b"activated-owner"]

    restored = progress_snapshot.read(tenant_id="tenant-1", session_id="session-1")

    assert restored == snapshot
    assert redis.get.call_args_list[1].args == ("dify_builder:progress:tenant-1:session-1:activated-owner",)


@pytest.mark.parametrize("next_owner", [None, b"replacement-owner"])
def test_read_discards_snapshot_if_command_settles_or_changes_worker_during_read(
    redis: MagicMock, next_owner: bytes | None
) -> None:
    redis.get.side_effect = [b"old-owner", json.dumps(asdict(_snapshot())).encode(), next_owner]

    assert progress_snapshot.read(tenant_id="tenant-1", session_id="session-1") is None


def test_read_never_uses_a_previous_workers_or_another_tenants_snapshot(redis: MagicMock) -> None:
    values = {
        "dify_builder:advance:session-1": b"current-owner",
        "dify_builder:progress:tenant-1:session-1:previous-owner": json.dumps(asdict(_snapshot())).encode(),
        "dify_builder:progress:tenant-2:session-1:current-owner": json.dumps(asdict(_snapshot())).encode(),
    }
    redis.get.side_effect = values.get

    assert progress_snapshot.read(tenant_id="tenant-1", session_id="session-1") is None


def test_read_does_not_load_progress_after_lease_release(redis: MagicMock) -> None:
    redis.get.return_value = None

    assert progress_snapshot.read(tenant_id="tenant-1", session_id="session-1") is None
    redis.get.assert_called_once_with("dify_builder:advance:session-1")

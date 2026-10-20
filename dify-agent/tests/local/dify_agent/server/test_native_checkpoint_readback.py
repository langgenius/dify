"""Actual app/HTTP/store validation with explicit Redis transport stand-ins.

Only normal-CI Redis tests qualify the atomic Lua/storage boundary.
"""

import asyncio
import importlib
import json
import os
from contextlib import contextmanager

import httpx
import pytest
from fastapi.testclient import TestClient

from dify_agent.runtime.native_continuation import AgentCheckpoint, NativeContinuationConflict
from dify_agent.server.schemas import RunRecord
from dify_agent.storage.redis_run_store import RedisRunStore, RunNotFoundError


def checkpoint_payload():
    return {
        "run_id": "agent-run-1",
        "generation": 7,
        "ref": {
            "policy_version": "builder-native-test-v1",
            "request_id": "req-1",
            "invocation_id": "inv-1",
            "context_digest": "a" * 64,
        },
        "stage": "tool",
        "pending_calls": [
            {
                "call_id": "call-1",
                "tool_name": "write",
                "native_arguments": {"rows": [True, 1]},
                "intent": {
                    "key": {"invocation_id": "inv-1", "occurrence_path": ["agent", "call-1"], "cursor": 0},
                    "kind": "tool",
                    "resource_ref": "tool-1",
                    "implementation_revision": "rev-1",
                    "account_ref": None,
                    "target": {"table": "synthetic"},
                    "parameters": {"rows": [True, 1]},
                    "input_digest": "c" * 64,
                    "capability_digest": "d" * 64,
                },
                "stage": "tool",
                "pending_operation_id": "pending-1",
                "wait_reason": "approval",
            }
        ],
        "history": [],
        "operation_cursor": 1,
        "result_refs": {"previous": "result-1"},
        "job_refs": ["job-1"],
        "config_digest": "b" * 64,
        "config_ref": "config-1",
        "session_snapshot": {"schema_version": 2, "layers": {}},
    }


def selected_request():
    cp = checkpoint_payload()
    return {
        "ref": cp["ref"],
        "expected_generation": 7,
        "waiting_event_id": "123-1",
        "config_ref": "config-1",
        "config_digest": "b" * 64,
    }


def snapshot_reply():
    cp = AgentCheckpoint.model_validate(checkpoint_payload())
    event = cp.waiting_event()
    record = RunRecord(
        run_id=cp.run_id, status="waiting", native_generation=7, native_checkpoint_json=cp.model_dump_json()
    )
    raw = record.model_dump(mode="json")
    raw["native_wait_event_id"] = "123-1"
    return [1, json.dumps(raw), "123-1", event.model_dump_json(exclude={"id"})]


class SnapshotRedis:
    """Supplies one already-selected reply; DOES NOT emulate/qualify Redis Lua."""

    def __init__(self, reply=None):
        self.reply = snapshot_reply() if reply is None else reply
        self.calls = []

    async def eval(self, *args):
        self.calls.append(args)
        return self.reply

    async def aclose(self):
        pass


@contextmanager
def real_app(monkeypatch, *, token="synthetic-service-token", reply=None):
    from dify_agent.server import app as app_module
    from dify_agent.server.settings import ServerSettings
    import dify_agent.server.observability as observability

    for key in tuple(os.environ):
        if key.startswith(("DIFY_AGENT_", "OTEL_", "LOGFIRE_")):
            monkeypatch.delenv(key)
    monkeypatch.setitem(ServerSettings.model_config, "env_file", None)
    monkeypatch.setattr(observability, "_global_instrumentation_ready", False)
    monkeypatch.setattr(observability, "_global_trace_context_mode", None)
    redis = SnapshotRedis(reply)

    class RedisFactory:
        @staticmethod
        def from_url(_url):
            return redis

    monkeypatch.setattr(app_module, "Redis", RedisFactory)
    # Real app/store/scheduler and HTTP adapters, transport objects only are offline.
    monkeypatch.setattr(
        app_module,
        "create_plugin_daemon_http_client",
        lambda _settings: httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500))),
    )
    monkeypatch.setattr(
        app_module,
        "create_dify_api_inner_http_client",
        lambda _settings: httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500))),
    )
    settings = ServerSettings(api_token=token)
    with TestClient(app_module.create_app(settings)) as client:
        yield client, redis


def test_authenticated_real_app_reader_preserves_selected_private_bytes(monkeypatch):
    with real_app(monkeypatch) as (client, redis):
        response = client.post(
            "/runs/agent-run-1/native-checkpoint",
            json=selected_request(),
            headers={"Authorization": "Bearer synthetic-service-token"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["checkpoint"]["generation"] == 7
    assert body["checkpoint"]["pending_calls"][0]["native_arguments"] == {"rows": [True, 1]}
    assert body["checkpoint"]["result_refs"] == {"previous": "result-1"}
    assert body["waiting_event"]["id"] == "123-1"
    assert len(redis.calls) == 1


@pytest.mark.parametrize("authorization", [None, "Bearer wrong"])
def test_real_app_authentication_precedes_any_private_store_read(monkeypatch, authorization):
    with real_app(monkeypatch) as (client, redis):
        response = client.post(
            "/runs/agent-run-1/native-checkpoint",
            json=selected_request(),
            headers={} if authorization is None else {"Authorization": authorization},
        )
    assert response.status_code == 401
    assert redis.calls == []


def test_anonymous_migration_keeps_private_reader_absent(monkeypatch):
    with real_app(monkeypatch, token=None) as (client, redis):
        private = client.post("/runs/agent-run-1/native-checkpoint", json=selected_request())
        ordinary = client.get("/runs/capabilities")
    assert private.status_code == 404
    assert ordinary.status_code == 200
    assert ordinary.json()["features"] == ["pending-call-v1"]
    assert redis.calls == []


@pytest.mark.parametrize("body,status", [(b"x" * 4097, 413), (b'{"private":"canary"}', 422)])
def test_request_bounds_and_validation_do_not_echo_body_or_read_store(monkeypatch, body, status):
    with real_app(monkeypatch) as (client, redis):
        response = client.post(
            "/runs/agent-run-1/native-checkpoint",
            content=body,
            headers={"Authorization": "Bearer synthetic-service-token", "Content-Type": "application/json"},
        )
    assert response.status_code == status
    assert "canary" not in response.text
    assert redis.calls == []


def read_with_reply(reply, payload=None, run_id="agent-run-1"):
    module = importlib.import_module("dify_agent.protocol.native_continuation")
    request = module.ReadNativeCheckpointRequest.model_validate(selected_request() if payload is None else payload)
    redis = SnapshotRedis(reply)
    return asyncio.run(RedisRunStore(redis).read_native_checkpoint(run_id=run_id, request=request))


@pytest.mark.parametrize(
    "change",
    [
        {"run_id": "foreign"},
        {"status": "running"},
        {"native_generation": 6},
        {"native_dispatch_started": True},
        {"native_wait_event_id": "122-1"},
        {"native_checkpoint_json": None},
    ],
)
def test_storage_reply_cannot_override_selected_run_wait_or_generation(change):
    reply = snapshot_reply()
    record = json.loads(reply[1])
    record.update(change)
    reply[1] = json.dumps(record)
    with pytest.raises(NativeContinuationConflict):
        read_with_reply(reply)


@pytest.mark.parametrize(
    "field,value",
    [
        ("run_id", "foreign"),
        ("generation", 6),
        ("config_ref", "other"),
        ("config_digest", "f" * 64),
        (
            "ref",
            {
                "policy_version": "builder-native-test-v1",
                "request_id": "foreign",
                "invocation_id": "inv-1",
                "context_digest": "a" * 64,
            },
        ),
    ],
)
def test_private_checkpoint_must_match_complete_selected_owner(field, value):
    reply = snapshot_reply()
    record = json.loads(reply[1])
    cp = json.loads(record["native_checkpoint_json"])
    cp[field] = value
    record["native_checkpoint_json"] = json.dumps(cp)
    reply[1] = json.dumps(record)
    with pytest.raises(NativeContinuationConflict):
        read_with_reply(reply)


@pytest.mark.parametrize("mutation", ["id", "type", "run", "generation", "pending", "oversize", "malformed", "extra"])
def test_real_selected_event_must_match_checkpoint_without_decode_leaks(mutation):
    reply = snapshot_reply()
    event = json.loads(reply[3])
    if mutation == "id":
        reply[2] = "124-1"
    elif mutation == "type":
        event["type"] = "run_started"
    elif mutation == "run":
        event["run_id"] = "foreign"
    elif mutation == "generation":
        event["data"]["generation"] = 6
    elif mutation == "pending":
        event["data"]["pending_actions"][0]["pending_operation_id"] = "other"
    elif mutation == "extra":
        event["private_canary"] = "must-not-leak"
    reply[3] = (
        "must-not-leak" * 100000
        if mutation == "oversize"
        else "{must-not-leak"
        if mutation == "malformed"
        else json.dumps(event)
    )
    with pytest.raises(NativeContinuationConflict) as caught:
        read_with_reply(reply)
    assert "must-not-leak" not in str(caught.value)


@pytest.mark.parametrize(
    "reply,error",
    [
        ([-1, "", "", ""], RunNotFoundError),
        ([-2, "", "", ""], NativeContinuationConflict),
        ([1, "x" * (2**21 + 16385), "123-1", "{}"], NativeContinuationConflict),
    ],
)
def test_missing_or_oversized_storage_refuses_without_checkpoint_decode(reply, error):
    with pytest.raises(error):
        read_with_reply(reply)


@pytest.mark.parametrize(
    "field,value", [("native_generation", "7"), ("native_generation", True), ("native_dispatch_started", 0)]
)
def test_private_wait_does_not_coerce_corrupt_internal_state(field, value):
    reply = snapshot_reply()
    record = json.loads(reply[1])
    record[field] = value
    reply[1] = json.dumps(record)
    with pytest.raises(NativeContinuationConflict):
        read_with_reply(reply)


def test_embedded_event_id_cannot_be_replaced_by_selected_stream_id():
    reply = snapshot_reply()
    event = json.loads(reply[3])
    event["id"] = "999-1"
    reply[3] = json.dumps(event)
    with pytest.raises(NativeContinuationConflict):
        read_with_reply(reply)


@pytest.mark.parametrize(
    "reply,status", [([-1, "", "", ""], 404), ([-2, "", "", ""], 409), ([1, "private-canary", "123-1", "{}"], 409)]
)
def test_private_route_normalizes_store_failures_without_history(monkeypatch, reply, status):
    with real_app(monkeypatch, reply=reply) as (client, redis):
        response = client.post(
            "/runs/agent-run-1/native-checkpoint",
            json=selected_request(),
            headers={"Authorization": "Bearer synthetic-service-token"},
        )
    assert response.status_code == status
    assert "private-canary" not in response.text
    assert len(redis.calls) == 1

"""Confirmed handoff through actual HTTP authority and disposable Redis.

No model/tool/backend lifecycle is executed. The HTTP fixture is an explicit
synthetic protected-object owner, not a mocked network transport.
"""

import asyncio
import hashlib
import json
import os
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4
from typing import override

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import ModelResponse, ToolCallPart
from redis.asyncio import Redis

from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient
from dify_agent.protocol.confirmed_recovery import (
    AgentRecoveryReconstruction,
    AgentRecoverySuccessor,
    InstallConfirmedRecoverySuccessorRequest,
    recovery_successor_digest,
)
from dify_agent.protocol.native_continuation import AgentCheckpoint
from dify_agent.protocol.native_testing import (
    AgentRuntimeIdentitySeed,
    AgentDispatchPermit,
    ReadAgentRuntimeIdentity,
    executable_request_digest,
)
from dify_agent.protocol.run_recovery import LookupRunRequest, create_run_fingerprint
from dify_agent.protocol.schemas import CancelRunRequest, CreateRunRequest
from dify_agent.runtime.confirmed_continuation import ConfirmedNativeContinuationOwner
from dify_agent.runtime.native_continuation import NativeContinuationConflict
from dify_agent.runtime.native_effects import canonical_effect_json
from dify_agent.storage.redis_keys import run_record_key
from dify_agent.storage.redis_run_store import RedisRunStore

REF = {
    "policy_version": "builder-native-test-v1",
    "request_id": "request",
    "invocation_id": "invocation",
    "context_digest": "a" * 64,
}
PARENT = {
    "ref": REF,
    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
    "input_result_ref": "input",
    "input_digest": "b" * 64,
}


def digest(value):
    return hashlib.sha256(canonical_effect_json(value)).hexdigest()


def configuration(binding):
    return CreateRunRequest.model_validate(
        {
            "execution_mode": "builder_test",
            "native_test_profile": "confirmed",
            "native_test_ref": REF,
            "native_parent_node": PARENT,
            "native_test_protocol_version": 1,
            "idempotency_key": "original-create",
            "composition": {
                "layers": [
                    {"name": "runtime", "config": {"backend_binding_ref": binding}},
                    {"name": "shell", "config": {}},
                    {"name": "core_tools", "config": {}},
                ]
            },
        }
    )


def checkpoint(run_id, config_digest):
    return AgentCheckpoint.model_validate(
        {
            "native_test_profile": "confirmed",
            "create_idempotency_key": "original-create",
            "run_id": run_id,
            "generation": 0,
            "ref": REF,
            "stage": "tool",
            "history": [ModelResponse(parts=[ToolCallPart("write", {"value": "x"}, tool_call_id="call")])],
            "operation_cursor": 7,
            "result_refs": {"completed-call": "completed-result"},
            "job_refs": [],
            "config_ref": "old-config",
            "config_digest": config_digest,
            "session_snapshot": {
                "schema_version": 2,
                "layers": {
                    "runtime": {},
                    "shell": {"initialized": True, "job_ids": [], "job_offsets": {}},
                    "core_tools": {},
                },
            },
            "pending_calls": [
                {
                    "call_id": "call",
                    "tool_name": "write",
                    "native_arguments": {"value": "x"},
                    "stage": "tool",
                    "pending_operation_id": "old-pending",
                    "wait_reason": "approval",
                    "intent": {
                        "key": {
                            "invocation_id": "invocation",
                            "occurrence_path": [PARENT["execution_id"], "core_tool", "call"],
                            "cursor": 0,
                        },
                        "kind": "tool",
                        "resource_ref": "resource",
                        "implementation_revision": "revision",
                        "account_ref": None,
                        "target": {"tool": "write"},
                        "parameters": {"value": "x"},
                        "input_digest": "b" * 64,
                        "capability_digest": "c" * 64,
                    },
                }
            ],
        }
    )


@contextmanager
def authority(objects, *, restore=False, on_read=None):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((self.path, body))
            assert self.headers["Authorization"] == "Bearer service"
            assert self.headers["X-Dify-Agent-Run"]
            route = self.path.rsplit("/", 1)[-1]
            if route == "read-result":
                assert body["ref"] == REF
                result = objects.get(body["result_ref"])
                payload = json.dumps({"result": result}).encode()
            elif restore and route == "prepared-config":
                assert body["parent_node"] == PARENT
                result = objects[body["config_ref"]]
                payload = json.dumps(result).encode()
            elif restore and route == "before-call":
                assert body["intent"]["key"]["occurrence_path"] == [
                    PARENT["execution_id"],
                    "recovery",
                    "1",
                    "core_tool",
                    "call",
                ]
                result = {
                    "kind": "dispatch",
                    "permit_id": "fresh-permit",
                    "attempt_id": "fresh-attempt",
                    "operation_id": "new-pending",
                    "expires_at": "2099-01-01T00:00:00Z",
                }
                payload = json.dumps(result).encode()
            else:
                raise AssertionError(self.path)
            if on_read is not None:
                on_read(route, body)
            self.send_response(200 if result is not None else 403)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        @override
        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


async def scenario(redis, url, objects, *, completed_pending=False, history_case=None, workspace_generation=0):
    client = AgentRuntimeHTTPClient(api_url=url, api_token="service")
    owner = ConfirmedNativeContinuationOwner(http_client=client, base_url=url)
    store = RedisRunStore(redis, prefix="recovery-" + uuid4().hex, confirmed_recovery_owner=owner)
    old_request, new_request = configuration("old-binding-ref"), configuration("new-binding-ref")
    old_digest, new_digest = executable_request_digest(old_request), executable_request_digest(new_request)
    selection = LookupRunRequest(idempotency_key="original-create", request_digest=create_run_fingerprint(old_request))
    accepted = await store.claim_run(
        selection=selection,
        identity=AgentRuntimeIdentitySeed(
            execution_mode="builder_test",
            native_test_profile="confirmed",
            parent_node=PARENT,
            request_digest=old_digest,
        ),
    )
    run_id = accepted.record.run_id
    cp = checkpoint(run_id, old_digest)
    if history_case is not None:
        cp = reviewed_pending_history(cp, history_case)
    if completed_pending:
        cp = cp.model_copy(update={"result_refs": {**cp.result_refs, "call": "completed-result"}})
    event_id = await store.persist_waiting(run_id=run_id, checkpoint=cp, event=cp.waiting_event())
    successor_cp = cp.model_dump(mode="json")
    successor_cp.update(
        config_ref="new-config",
        config_digest=new_digest,
        session_snapshot={
            "schema_version": 2,
            "layers": {
                "runtime": {},
                "shell": {"initialized": False, "job_ids": [], "job_offsets": {}},
                "core_tools": {},
            },
        },
    )
    successor_cp["pending_calls"][0]["pending_operation_id"] = "new-pending"
    successor_cp["pending_calls"][0]["intent"]["key"]["occurrence_path"] = [
        PARENT["execution_id"],
        "recovery",
        str(workspace_generation + 1),
        cp.pending_calls[0].intent.key.occurrence_path[-2],
        "call",
    ]
    manifest = {
        "protocol_version": 1,
        "kind": "empty-bootstrap-v1",
        "home_snapshot_id": None,
        "home_snapshot_digest": None,
    }
    relation = AgentRecoverySuccessor.model_validate(
        {
            "attempt_id": "d" * 64,
            "parent_node": PARENT,
            "agent_run_id": run_id,
            "expected_parent_generation": 2,
            "expected_agent_generation": 0,
            "predecessor": {
                "binding_id": "old-binding",
                "workspace_id": "old-workspace",
                "binding_ref": "old-binding-ref",
                "workspace_ref": "old-workspace-ref",
                "workspace_generation": workspace_generation,
                "association_object_ref": "old-association",
                "config_ref": "old-config",
                "config_digest": old_digest,
            },
            "successor": {
                "binding_id": "new-binding",
                "workspace_id": "new-workspace",
                "binding_ref": "new-binding-ref",
                "workspace_ref": "new-workspace-ref",
                "workspace_generation": workspace_generation + 1,
                "association_object_ref": "new-association",
                "config_ref": "new-config",
                "config_digest": new_digest,
            },
            "predecessor_checkpoint": {
                "checkpoint_id": "old-checkpoint",
                "payload_digest": digest(cp.model_dump(mode="json")),
            },
            "successor_checkpoint": {"checkpoint_id": "new-checkpoint", "payload_digest": digest(successor_cp)},
            "predecessor_waiting_event_id": event_id,
            "reconstruction_object_ref": "reconstruction",
            "reconstruction_digest": digest(manifest),
            "pending_operation_substitutions": [
                {"predecessor_operation_id": "old-pending", "successor_operation_id": "new-pending"}
            ],
        }
    )
    request = InstallConfirmedRecoverySuccessorRequest(
        successor=relation, successor_object_ref="relation", successor_digest=recovery_successor_digest(relation)
    )
    objects.update(
        {"relation": relation.model_dump(mode="json"), "reconstruction": manifest, "new-checkpoint": successor_cp}
    )
    for name, req, expected_digest in [
        ("old-config", old_request, old_digest),
        ("new-config", new_request, new_digest),
    ]:
        objects[name] = {
            "parent_node": PARENT,
            "config_ref": name,
            "config_digest": expected_digest,
            "config": req.model_dump(mode="json", include={"composition", "session_snapshot"}),
        }
    return store, client, request, cp, selection


def test_manifest_rejects_unknown_version_extra_and_unpaired_home():
    valid = {
        "protocol_version": 1,
        "kind": "empty-bootstrap-v1",
        "home_snapshot_id": None,
        "home_snapshot_digest": None,
    }
    assert AgentRecoveryReconstruction.model_validate(valid).kind == "empty-bootstrap-v1"
    for change in [
        {"protocol_version": True},
        {"protocol_version": "1"},
        {"unknown": True},
        {"home_snapshot_id": "home"},
    ]:
        with pytest.raises(ValidationError):
            AgentRecoveryReconstruction.model_validate({**valid, **change})


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires disposable Redis")
@pytest.mark.parametrize(
    "failure",
    [
        None,
        "cancel",
        "claim",
        "missing_relation",
        "changed_checkpoint",
        "jobs",
        "state",
        "config",
        "authority_refused",
        "history",
        "arguments",
        "resource",
        "key",
        "partial_predecessor",
        "pruned_wait",
        "conflicting_predecessor",
        "completed_pending",
    ],
)
def test_confirmed_handoff_real_redis(failure):
    async def run(url, objects):
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        store, client, request, cp, selection = await scenario(
            redis, url, objects, completed_pending=failure == "completed_pending"
        )
        try:
            if failure == "cancel":
                await store.request_cancellation(cp.run_id, CancelRunRequest())
            elif failure == "claim":
                await store.claim_continuation(run_id=cp.run_id, expected_generation=0, idempotency_key="continue")
            elif failure == "missing_relation":
                del objects["relation"]
            elif failure == "changed_checkpoint":
                objects["new-checkpoint"]["operation_cursor"] = 0
            elif failure == "jobs":
                objects["new-checkpoint"]["job_refs"] = ["environment-job"]
            elif failure == "state":
                objects["new-checkpoint"]["session_snapshot"]["layers"]["shell"]["job_ids"] = ["old-job"]
            elif failure == "config":
                objects["new-config"]["config"]["composition"]["layers"][1]["config"] = {
                    "cli_tools": [{"install_commands": ["echo unsafe"]}]
                }
            elif failure == "authority_refused":
                del objects["relation"]  # API owns spent/claimed/unknown/pin checks; SDK only observes refusal.
            elif failure == "history":
                objects["new-checkpoint"]["history"] = []
            elif failure == "arguments":
                objects["new-checkpoint"]["pending_calls"][0]["native_arguments"] = {"value": "changed"}
            elif failure == "resource":
                objects["new-checkpoint"]["pending_calls"][0]["intent"]["resource_ref"] = "changed-resource"
            elif failure == "key":
                objects["new-checkpoint"]["pending_calls"][0]["intent"]["key"] = cp.pending_calls[
                    0
                ].intent.key.model_dump(mode="json")
            elif failure == "pruned_wait":
                from dify_agent.storage.redis_keys import run_events_key

                await redis.xdel(
                    run_events_key(store.prefix, cp.run_id), request.successor.predecessor_waiting_event_id
                )
            elif failure == "conflicting_predecessor":
                await redis.set(
                    f"{store.prefix}:run:{cp.run_id}:confirmed-recovery:{request.successor.attempt_id}:predecessor",
                    "different-immutable-record",
                )
            elif failure == "partial_predecessor":
                raw = await redis.get(run_record_key(store.prefix, cp.run_id))
                await redis.set(
                    f"{store.prefix}:run:{cp.run_id}:confirmed-recovery:{request.successor.attempt_id}:predecessor", raw
                )
            if failure in {"changed_checkpoint", "jobs", "state", "config", "history", "arguments", "resource", "key"}:
                # Recompute exact matching digests through the synthetic
                # authority so semantic preservation guards, not just hashes, run.
                relation_value = request.successor.model_dump(mode="json")
                config_digest = executable_request_digest(
                    CreateRunRequest.model_validate(objects["new-config"]["config"])
                )
                objects["new-config"]["config_digest"] = config_digest
                relation_value["successor"]["config_digest"] = config_digest
                objects["new-checkpoint"]["config_digest"] = config_digest
                relation_value["successor_checkpoint"]["payload_digest"] = digest(objects["new-checkpoint"])
                relation = AgentRecoverySuccessor.model_validate(relation_value)
                request = InstallConfirmedRecoverySuccessorRequest(
                    successor=relation,
                    successor_object_ref="relation",
                    successor_digest=recovery_successor_digest(relation),
                )
                objects["relation"] = relation.model_dump(mode="json")
            original = await redis.get(run_record_key(store.prefix, cp.run_id))
            if failure and failure != "partial_predecessor":
                with pytest.raises(NativeContinuationConflict):
                    await store.install_confirmed_recovery_successor(request)
                assert await redis.get(run_record_key(store.prefix, cp.run_id)) == original
                return
            receipts = await asyncio.gather(*(store.install_confirmed_recovery_successor(request) for _ in range(4)))
            assert len(set(item.model_dump_json() for item in receipts)) == 1
            receipt = receipts[0]
            assert receipt.waiting_event_id != request.successor.predecessor_waiting_event_id
            assert await store.install_confirmed_recovery_successor(request) == receipt  # ACK-loss readback.
            selected = await store.get_checkpoint(cp.run_id)
            assert selected.result_refs == cp.result_refs
            assert selected.history == cp.history
            assert selected.operation_cursor == cp.operation_cursor
            assert selected.session_snapshot.layers["shell"]["initialized"] is False
            assert (await store.lookup_run(selection)).run_id == cp.run_id
            assert (await store.get_run(cp.run_id)).create_request_digest == selection.request_digest
            from dify_agent.storage.redis_run_store import RunCreateConflictError

            with pytest.raises(RunCreateConflictError):
                await store.lookup_run(
                    LookupRunRequest(
                        idempotency_key=selection.idempotency_key,
                        request_digest=create_run_fingerprint(configuration("new-binding-ref")),
                    )
                )
            assert not (await store.claim_run(selection=selection)).inserted
            with pytest.raises(NativeContinuationConflict):
                await store.read_run_identity(
                    run_id=cp.run_id,
                    selection=ReadAgentRuntimeIdentity(parent_node=PARENT, request_digest=cp.config_digest),
                )
            with pytest.raises(NativeContinuationConflict):
                await store.persist_waiting(run_id=cp.run_id, checkpoint=cp, event=cp.waiting_event())
            assert len((await store.get_events(cp.run_id)).events) == 2
            predecessor = await redis.get(
                f"{store.prefix}:run:{cp.run_id}:confirmed-recovery:{request.successor.attempt_id}:predecessor"
            )
            assert predecessor == original
            with pytest.raises(NativeContinuationConflict):
                await store.claim_continuation(
                    run_id=cp.run_id,
                    expected_generation=0,
                    idempotency_key="stale-claim",
                    expected_config_digest=cp.config_digest,
                )
            with pytest.raises(NativeContinuationConflict):
                await store.stop_native_run(
                    run_id=cp.run_id,
                    expected_generation=0,
                    reason_code="stale-stop",
                    expected_config_digest=cp.config_digest,
                )
            claim = await store.claim_continuation(
                run_id=cp.run_id,
                expected_generation=0,
                idempotency_key="resume-new",
                expected_config_digest=request.successor.successor.config_digest,
            )
            assert await store.start_continuation(claim)
            with pytest.raises(NativeContinuationConflict):
                await store.persist_waiting(
                    run_id=cp.run_id,
                    checkpoint=cp.model_copy(update={"generation": 1}),
                    event=cp.model_copy(update={"generation": 1}).waiting_event(),
                )
        finally:
            keys = [key async for key in redis.scan_iter(store.prefix + ":*")]
            if keys:
                await redis.delete(*keys)
            await client.aclose()
            await redis.aclose()

    objects = {}
    with authority(objects) as (url, calls):
        asyncio.run(run(url, objects))
    assert all(path.endswith("/read-result") for path, _ in calls)


@pytest.mark.parametrize(
    "layers,jobs",
    [
        ({"shell": {"job_ids": ["job"]}}, ()),
        ({"shell": {"job_offsets": {"job": 1}}}, ()),
        ({"shell": {"job_refs": {"job": {}}}}, ()),
        ({"shell": {"initialized": "yes"}}, ()),
        ({"shell": {"files": []}}, ()),
        ({"config": {"pulled_file_outputs": {"file": "path"}}}, ()),
        ({"config": {"pulled_skill_outputs": {"skill": "path"}}}, ()),
        ({"knowledge": {}}, ()),
        ({"unknown": {}}, ()),
        ({"runtime": {"resource": "old"}}, ()),
        ({"history": {"messages": []}}, ()),
        ({}, ("job",)),
    ],
)
def test_snapshot_whitelist_rejects_environment_state(layers, jobs):
    from dify_agent.protocol.snapshot import SessionSnapshot
    from dify_agent.runtime.confirmed_recovery import recovery_snapshot

    cp = checkpoint("run", "a" * 64).model_copy(
        update={"job_refs": jobs, "session_snapshot": SessionSnapshot(layers=layers)}
    )
    with pytest.raises(NativeContinuationConflict):
        recovery_snapshot(cp)


def test_snapshot_retains_history_and_clears_only_empty_initialization():
    from dify_agent.protocol.snapshot import SessionSnapshot
    from dify_agent.runtime.confirmed_recovery import recovery_snapshot

    cp = checkpoint("run", "a" * 64)
    cp = cp.model_copy(
        update={
            "session_snapshot": SessionSnapshot(
                layers={
                    "shell": {"initialized": True},
                    "config": {"initialized": True},
                    "history": {"messages": cp.model_dump(mode="json")["history"]},
                    "runtime": {},
                }
            )
        }
    )
    sanitized = recovery_snapshot(cp)
    assert sanitized.layers["history"] == cp.session_snapshot.layers["history"]
    assert sanitized.layers["shell"] == {"initialized": False}
    assert sanitized.layers["config"] == {"initialized": False}
    assert cp.session_snapshot.layers["shell"] == {"initialized": True}


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires disposable Redis")
def test_authenticated_route_and_async_sync_clients_use_same_wait_without_scheduling():
    import socket

    import httpx
    import uvicorn
    from fastapi import FastAPI

    from dify_agent.client import Client
    from dify_agent.runtime.context import Services
    from dify_agent.runtime.run_scheduler import RunScheduler
    from dify_agent.server.auth import create_bearer_token_dependency
    from dify_agent.server.routes.native_testing import create_native_testing_router

    async def run(url, objects):
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        store, api_client, request, cp, _selection = await scenario(redis, url, objects)
        owner = store.confirmed_recovery_owner
        scheduler = RunScheduler(
            store=store,
            native_owner=owner,
            services=Services(
                plugin_daemon_http_client=api_client,
                dify_api_http_client=api_client,
                confirmed_api_http_client=api_client,
            ),
        )
        app = FastAPI()
        app.include_router(
            create_native_testing_router(lambda: store, lambda: scheduler),
            dependencies=[create_bearer_token_dependency("service")],
        )
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(16)
        server = uvicorn.Server(uvicorn.Config(app, log_level="error", lifespan="off", ws="none"))
        server_task = asyncio.create_task(server.serve(sockets=[listener]))
        try:

            async def ready():
                while not server.started:
                    await asyncio.sleep(0.01)

            await asyncio.wait_for(ready(), timeout=5)
            base_url = f"http://127.0.0.1:{listener.getsockname()[1]}"
            async with httpx.AsyncClient(base_url=base_url) as anonymous:
                response = await anonymous.post(
                    f"/runs/{cp.run_id}/confirmed-recovery-successor", json=request.model_dump(mode="json")
                )
                assert response.status_code == 401
            async with Client(base_url=base_url, headers={"Authorization": "Bearer service"}) as client:
                receipt = await client.install_confirmed_recovery_successor(request)
                assert await client.install_confirmed_recovery_successor(request) == receipt

                def sync_readback():
                    with Client(base_url=base_url, headers={"Authorization": "Bearer service"}) as sync_client:
                        return sync_client.install_confirmed_recovery_successor_sync(request)

                assert await asyncio.to_thread(sync_readback) == receipt
            assert scheduler.active_tasks == {}
            assert len((await store.get_events(cp.run_id)).events) == 2
        finally:
            server.should_exit = True
            await asyncio.wait_for(server_task, timeout=5)
            listener.close()
            keys = [key async for key in redis.scan_iter(store.prefix + ":*")]
            if keys:
                await redis.delete(*keys)
            await api_client.aclose()
            await redis.aclose()

    objects = {}
    with authority(objects) as (url, _calls):
        asyncio.run(run(url, objects))


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires disposable Redis")
def test_conflicting_real_cas_fences_old_transport_and_restores_only_successor():
    from dify_agent.adapters.native_testing.transport import AgentRuntimeTransportError, bind_runtime_identity
    from dify_agent.runtime.context import Services
    from dify_agent.runtime.native_effects import NativeEffectsCapability
    from dify_agent.runtime.run_scheduler import RunScheduler

    async def run(url, objects, calls):
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        store, api_client, request, cp, _selection = await scenario(redis, url, objects)
        scheduler = RunScheduler(
            store=store,
            native_owner=store.confirmed_recovery_owner,
            services=Services(
                plugin_daemon_http_client=api_client,
                dify_api_http_client=api_client,
                confirmed_api_http_client=api_client,
            ),
        )
        ready, released = asyncio.Event(), asyncio.Event()

        async def old_worker():
            async with scheduler._transport_scope(
                cp.run_id, expected_generation=0, expected_digest=cp.config_digest, expected_ref=cp.ref
            ):
                ready.set()
                await released.wait()
                with pytest.raises(AgentRuntimeTransportError):
                    await api_client.post(
                        url + "/inner/api/agent/runtime/native-testing/read-result",
                        json={"ref": REF, "result_ref": "old-config"},
                    )

        worker = asyncio.create_task(old_worker())
        try:
            await ready.wait()
            other_relation = request.successor.model_copy(update={"attempt_id": "e" * 64})
            other = InstallConfirmedRecoverySuccessorRequest(
                successor=other_relation,
                successor_object_ref="relation-other",
                successor_digest=recovery_successor_digest(other_relation),
            )
            objects["relation-other"] = other_relation.model_dump(mode="json")
            results = await asyncio.gather(
                store.install_confirmed_recovery_successor(request),
                store.install_confirmed_recovery_successor(other),
                return_exceptions=True,
            )
            assert sum(isinstance(item, NativeContinuationConflict) for item in results) == 1
            selected = await store.get_checkpoint(cp.run_id)
            before_old_send = len(calls)
            released.set()
            await worker
            assert len(calls) == before_old_send
            assert len((await store.get_events(cp.run_id)).events) == 2
            owner = store.confirmed_recovery_owner
            assert owner is not None
            identity = await store.read_run_identity(
                run_id=cp.run_id,
                selection=ReadAgentRuntimeIdentity(parent_node=PARENT, request_digest=selected.config_digest),
            )
            with bind_runtime_identity(identity):
                with pytest.raises(NativeContinuationConflict):
                    await owner.restore(checkpoint=cp)
                prepared = await owner.restore(checkpoint=selected)
            assert prepared.continuation.recovery_workspace_generation == 1
            assert prepared.continuation.session_snapshot == selected.session_snapshot
            assert prepared.continuation.session_snapshot != cp.session_snapshot
            assert prepared.continuation.result_refs == cp.result_refs
            capability = prepared.continuation.capabilities[0]
            assert isinstance(capability, NativeEffectsCapability)
            pending, decision = capability.session.restored_calls["call"]
            assert pending.pending_operation_id == "new-pending"
            assert isinstance(decision, AgentDispatchPermit)
            assert decision.permit_id == "fresh-permit"
            assert calls[-1][0].endswith("/before-call")
            objects["completed-result"] = {"value": "completed-before-recovery"}
            with bind_runtime_identity(identity):
                assert await capability.session.result_store.load("completed-result") == objects["completed-result"]
            assert len((await store.get_events(cp.run_id)).events) == 2
            assert scheduler.active_tasks == {}
        finally:
            if not worker.done():
                worker.cancel()
                await asyncio.gather(worker, return_exceptions=True)
            keys = [key async for key in redis.scan_iter(store.prefix + ":*")]
            if keys:
                await redis.delete(*keys)
            await api_client.aclose()
            await redis.aclose()

    objects = {}
    with authority(objects, restore=True) as (url, calls):
        asyncio.run(run(url, objects, calls))


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires disposable Redis")
@pytest.mark.parametrize("race", ["cancel", "prune", "claim"])
def test_final_cas_rechecks_cancellation_claim_and_pruned_wait_after_authority_io(race):
    from dify_agent.storage.redis_keys import run_events_key

    validation_ready, validation_release = threading.Event(), threading.Event()

    def on_read(route, body):
        if route == "read-result" and body["result_ref"] == "new-config":
            validation_ready.set()
            assert validation_release.wait(timeout=5)

    async def run(url, objects):
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        store, client, request, cp, _selection = await scenario(redis, url, objects)
        task = asyncio.create_task(store.install_confirmed_recovery_successor(request))
        try:
            assert await asyncio.to_thread(validation_ready.wait, 5)
            if race == "cancel":
                await store.request_cancellation(cp.run_id, CancelRunRequest())
            elif race == "prune":
                await redis.xdel(
                    run_events_key(store.prefix, cp.run_id), request.successor.predecessor_waiting_event_id
                )
            else:
                await store.claim_continuation(
                    run_id=cp.run_id, expected_generation=0, idempotency_key="concurrent-claim"
                )
            expected = await redis.get(run_record_key(store.prefix, cp.run_id))
            validation_release.set()
            with pytest.raises(NativeContinuationConflict):
                await task
            assert await redis.get(run_record_key(store.prefix, cp.run_id)) == expected
            assert not await redis.exists(
                f"{store.prefix}:run:{cp.run_id}:confirmed-recovery:{request.successor.attempt_id}:predecessor"
            )
            assert (await store.get_checkpoint(cp.run_id)) == cp
        finally:
            validation_release.set()
            await asyncio.gather(task, return_exceptions=True)
            keys = [key async for key in redis.scan_iter(store.prefix + ":*")]
            if keys:
                await redis.delete(*keys)
            await client.aclose()
            await redis.aclose()

    objects = {}
    with authority(objects, on_read=on_read) as (url, _calls):
        asyncio.run(run(url, objects))


@pytest.mark.parametrize(
    "case", ["valid", "bootstrap", "files", "unknown_layer", "pending_shell", "completed", "state", "missing_runtime"]
)
def test_preallocation_eligibility_requires_no_successor_resources(case):
    from dify_agent.runtime.confirmed_recovery import validate_recovery_eligibility
    from dify_agent.protocol.snapshot import SessionSnapshot

    config_value = configuration("old-binding-ref").model_dump(mode="json")
    cp = checkpoint("run", executable_request_digest(configuration("old-binding-ref")))
    if case == "bootstrap":
        config_value["composition"]["layers"][1]["config"] = {"cli_tools": [{"install_commands": ["echo unavailable"]}]}
    elif case == "files":
        config_value["composition"]["layers"].append(
            {"name": "user_prompt", "config": {"files": [{"id": "dynamic-file"}]}}
        )
    elif case == "unknown_layer":
        config_value["composition"]["layers"].append({"name": "unknown", "config": {}})
    elif case == "pending_shell":
        value = cp.model_dump(mode="json")
        value["pending_calls"][0]["intent"]["kind"] = "shell"
        value["pending_calls"][0]["intent"]["key"]["occurrence_path"][-2] = "shell_run"
        cp = AgentCheckpoint.model_validate(value)
    elif case == "completed":
        cp = cp.model_copy(update={"result_refs": {"call": "completed-result"}})
    elif case == "state":
        cp = cp.model_copy(update={"session_snapshot": SessionSnapshot(layers={"shell": {"job_ids": ["old-job"]}})})
    elif case == "missing_runtime":
        config_value["composition"]["layers"] = config_value["composition"]["layers"][1:]
    config = CreateRunRequest.model_validate(config_value)
    before = (config.model_dump(mode="json"), cp.model_dump(mode="json"))
    if case == "valid":
        validate_recovery_eligibility(config, cp)
    else:
        with pytest.raises(NativeContinuationConflict):
            validate_recovery_eligibility(config, cp)
    assert before == (config.model_dump(mode="json"), cp.model_dump(mode="json"))


def reviewed_pending_history(cp: AgentCheckpoint, case: str) -> AgentCheckpoint:
    value = cp.model_dump(mode="json")
    pending = value["pending_calls"][0]
    path = pending["intent"]["key"]["occurrence_path"]
    if case in {
        "unknown_namespace",
        "recovery",
        "zero_generation",
        "leading_zero",
        "signed_generation",
        "unicode_generation",
        "overflow_generation",
        "generation_mismatch",
    }:
        generation = {
            "zero_generation": "0",
            "leading_zero": "01",
            "signed_generation": "+1",
            "unicode_generation": "١",
            "overflow_generation": str(2**63),
            "generation_mismatch": "2",
        }.get(case, "1")
        marker = "unknown-namespace" if case == "unknown_namespace" else "recovery"
        pending["intent"]["key"]["occurrence_path"] = [path[0], marker, generation, *path[-2:]]
    elif case == "foreign_parent":
        path[0] = "8c959aea-9025-4db9-9361-eed1191c11c7"
    elif case == "bootstrap_wait":
        value["stage"] = pending["stage"] = "bootstrap"
        pending["wait_reason"] = "configuration"
    elif case == "checkpoint_stage":
        value["stage"] = "bootstrap"
    elif case == "pending_stage":
        pending["stage"] = "model"
    elif case == "kind_boundary":
        pending["intent"]["kind"] = "model"
    elif case == "boundary_stage":
        path[-2] = "model"
    elif case == "unknown_boundary":
        path[-2] = "tool"
    elif case == "configuration_wait":
        pending["wait_reason"] = "configuration"
    elif case == "interaction_wait":
        pending["wait_reason"] = "interaction"
    elif case == "model":
        value["stage"] = pending["stage"] = "model"
        pending["tool_name"] = path[-2] = pending["intent"]["kind"] = "model"
    elif case in {"valid", "missing_recovery_marker"}:
        pass
    else:
        raise AssertionError(case)
    return AgentCheckpoint.model_validate(value)


@pytest.mark.parametrize(
    "case",
    [
        "unknown_namespace",
        "zero_generation",
        "leading_zero",
        "signed_generation",
        "unicode_generation",
        "overflow_generation",
        "foreign_parent",
        "bootstrap_wait",
        "checkpoint_stage",
        "pending_stage",
        "kind_boundary",
        "boundary_stage",
        "unknown_boundary",
        "configuration_wait",
        "interaction_wait",
    ],
)
def test_preallocation_rejects_unsupported_pending_history(case):
    from dify_agent.runtime.confirmed_recovery import validate_recovery_eligibility

    config = configuration("old-binding-ref")
    cp = reviewed_pending_history(checkpoint("run", executable_request_digest(config)), case)
    with pytest.raises(NativeContinuationConflict):
        validate_recovery_eligibility(config, cp)


@pytest.mark.parametrize("case", ["valid", "recovery", "model", "generation_mismatch"])
def test_preallocation_accepts_only_known_history_without_inventing_workspace_generation(case):
    from dify_agent.runtime.confirmed_recovery import validate_recovery_eligibility

    config = configuration("old-binding-ref")
    cp = reviewed_pending_history(checkpoint("run", executable_request_digest(config)), case)
    validate_recovery_eligibility(config, cp)


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires disposable Redis")
@pytest.mark.parametrize(
    "case",
    [
        "unknown_namespace",
        "leading_zero",
        "foreign_parent",
        "bootstrap_wait",
        "pending_stage",
        "generation_mismatch",
        "missing_recovery_marker",
    ],
)
def test_full_relation_and_real_cas_reject_matching_digest_unsupported_history(case):
    from dify_agent.runtime.confirmed_recovery import validate_recovery_checkpoint

    async def run(url, objects):
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        store, client, request, cp, _selection = await scenario(
            redis,
            url,
            objects,
            history_case=case,
            workspace_generation=1 if case == "missing_recovery_marker" else 0,
        )
        try:
            successor = AgentCheckpoint.model_validate(objects["new-checkpoint"])
            original = await redis.get(run_record_key(store.prefix, cp.run_id))
            with pytest.raises(NativeContinuationConflict):
                await store.install_confirmed_recovery_successor(request)
            with pytest.raises(NativeContinuationConflict):
                validate_recovery_checkpoint(request.successor, cp, successor)
            assert await redis.get(run_record_key(store.prefix, cp.run_id)) == original
            assert len((await store.get_events(cp.run_id)).events) == 1
            assert not await redis.exists(
                f"{store.prefix}:run:{cp.run_id}:confirmed-recovery:{request.successor.attempt_id}:predecessor"
            )
        finally:
            keys = [key async for key in redis.scan_iter(store.prefix + ":*")]
            if keys:
                await redis.delete(*keys)
            await client.aclose()
            await redis.aclose()

    objects = {}
    with authority(objects) as (url, _calls):
        asyncio.run(run(url, objects))


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires disposable Redis")
def test_full_config_validation_requires_exact_successor_generation_and_namespace():
    from dify_agent.runtime.confirmed_recovery import validate_recovery_configs

    async def run(url, objects):
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        store, client, request, cp, _selection = await scenario(redis, url, objects)
        try:
            selected = AgentCheckpoint.model_validate(objects["new-checkpoint"])
            for marker, generation in [
                ("unknown-namespace", "1"),
                ("recovery", "0"),
                ("recovery", "01"),
                ("recovery", "2"),
            ]:
                value = selected.model_dump(mode="json")
                value["pending_calls"][0]["intent"]["key"]["occurrence_path"][1:3] = [marker, generation]
                invalid = AgentCheckpoint.model_validate(value)
                with pytest.raises(NativeContinuationConflict):
                    validate_recovery_configs(
                        request.successor, configuration("old-binding-ref"), configuration("new-binding-ref"), invalid
                    )
        finally:
            keys = [key async for key in redis.scan_iter(store.prefix + ":*")]
            if keys:
                await redis.delete(*keys)
            await client.aclose()
            await redis.aclose()

    objects = {}
    with authority(objects) as (url, _calls):
        asyncio.run(run(url, objects))


@pytest.mark.skipif(not os.environ.get("DIFY_AGENT_NATIVE_TEST_REDIS_URL"), reason="requires disposable Redis")
@pytest.mark.parametrize("case,predecessor_generation", [("recovery", 1), ("model", 0)])
def test_real_cas_preserves_supported_model_and_recovered_tool_history(case, predecessor_generation):
    from dify_agent.runtime.confirmed_recovery import (
        validate_recovery_eligibility,
        validate_recovery_checkpoint,
        validate_recovery_configs,
    )

    async def run(url, objects):
        redis = Redis.from_url(os.environ["DIFY_AGENT_NATIVE_TEST_REDIS_URL"])
        store, client, request, cp, _selection = await scenario(
            redis, url, objects, history_case=case, workspace_generation=predecessor_generation
        )
        try:
            successor = AgentCheckpoint.model_validate(objects["new-checkpoint"])
            validate_recovery_eligibility(configuration("old-binding-ref"), cp)
            validate_recovery_checkpoint(request.successor, cp, successor)
            validate_recovery_configs(
                request.successor, configuration("old-binding-ref"), configuration("new-binding-ref"), successor
            )
            receipt = await store.install_confirmed_recovery_successor(request)
            assert receipt.workspace_generation == predecessor_generation + 1
            selected = await store.get_checkpoint(cp.run_id)
            assert selected == successor
            assert selected.history == cp.history
            assert selected.operation_cursor == cp.operation_cursor
            assert selected.result_refs == cp.result_refs
            assert selected.pending_calls[0].intent.key.occurrence_path[1:3] == (
                "recovery",
                str(receipt.workspace_generation),
            )
            assert len((await store.get_events(cp.run_id)).events) == 2
        finally:
            keys = [key async for key in redis.scan_iter(store.prefix + ":*")]
            if keys:
                await redis.delete(*keys)
            await client.aclose()
            await redis.aclose()

    objects = {}
    with authority(objects) as (url, _calls):
        asyncio.run(run(url, objects))

"""Protocol boundary tests; removing negotiation must allow the guarded side effect."""

import asyncio

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from dify_agent.protocol.native_testing import (
    AgentApprovalWait,
    AgentNativeTestRef,
    ContinueRunRequest,
    NativeTestCapabilities,
    NativeTestProtocolUnsupported,
    require_native_test_capabilities,
)
from dify_agent.protocol.schemas import CreateRunRequest
from dify_agent.server.routes.runs import create_runs_router

REF = {
    "policy_version": "builder-native-test-v1",
    "request_id": "request-1",
    "invocation_id": "invocation-1",
    "context_digest": "a" * 64,
}


def test_reference_exact_wire_and_no_authority_fields():
    assert AgentNativeTestRef.model_validate(REF).model_dump() == REF
    for change in ({"policy_version": "v2"}, {"approved": True}, {"request_id": ""}):
        with pytest.raises(ValidationError):
            AgentNativeTestRef.model_validate(REF | change)


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_wait_reason_survives_wire_roundtrip(reason):
    waiting = AgentApprovalWait(pending_operation_id="pending-1", wait_reason=reason)
    decoded = AgentApprovalWait.model_validate_json(waiting.model_dump_json())
    assert decoded.wait_reason == reason
    assert decoded.pending_operation_id == "pending-1"


def test_continue_cannot_supply_decisions_or_execution_arguments():
    payload = dict(ref=REF, expected_generation=0, idempotency_key="schedule-1")
    assert ContinueRunRequest.model_validate(payload).expected_generation == 0
    for change in ({"approved": True}, {"composition": {}}, {"expected_generation": -1}, {"expected_generation": True}):
        with pytest.raises(ValidationError):
            ContinueRunRequest.model_validate(payload | change)


@pytest.mark.parametrize(
    "payload",
    [
        {"execution_mode": "builder_test"},
        {"native_test_ref": REF},
        {"execution_mode": "builder_test", "native_test_ref": REF, "native_test_protocol_version": 0},
        {"execution_mode": "builder_test", "native_test_ref": REF, "native_test_protocol_version": True},
    ],
)
def test_mode_and_reference_must_agree(payload):
    with pytest.raises(ValidationError):
        CreateRunRequest.model_validate({"composition": {"layers": []}} | payload)


def test_all_features_are_required():
    required = {"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
    require_native_test_capabilities(NativeTestCapabilities(protocol_version=1, features=required))
    for missing in required:
        with pytest.raises(NativeTestProtocolUnsupported):
            require_native_test_capabilities(NativeTestCapabilities(protocol_version=1, features=required - {missing}))
    with pytest.raises(NativeTestProtocolUnsupported):
        require_native_test_capabilities(NativeTestCapabilities(protocol_version=0, features=required))


def test_http_rejects_before_scheduler_or_any_execution_boundary():
    counters = dict(model=0, tool=0, eager=0, config=0, bootstrap=0, lease=0)

    class Scheduler:
        async def create_run(self, request):
            for key in counters:
                counters[key] += 1
            raise AssertionError("unnegotiated request reached execution")

    app = FastAPI()
    app.include_router(create_runs_router(lambda: None, lambda: Scheduler()))

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            caps = await client.get("/runs/capabilities")
            assert caps.status_code == 200
            assert not {"test-scope-v1", "child-continuation-v1"}.intersection(caps.json()["features"])
            response = await client.post(
                "/runs",
                json={
                    "composition": {"layers": []},
                    "execution_mode": "builder_test",
                    "native_test_ref": REF,
                    "native_test_protocol_version": 1,
                },
            )
            assert response.status_code == 409
            assert response.json()["detail"]["code"] == "native_test_protocol_unsupported"
            response = await client.post(
                "/runs/run-1/continue", json={"ref": REF, "expected_generation": 0, "idempotency_key": "schedule-1"}
            )
            assert response.status_code == 409

    asyncio.run(exercise())
    from dify_agent.runtime.native_continuation import NativePolicyStopped

    class DeniedScheduler:
        async def create_run(self, request):
            raise NativePolicyStopped("approval_revoked")

    denied = FastAPI()
    ready = NativeTestCapabilities(
        protocol_version=1, features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
    )
    denied.include_router(create_runs_router(lambda: None, lambda: DeniedScheduler(), lambda: ready))

    async def exercise_denial():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=denied), base_url="http://test") as client:
            response = await client.post(
                "/runs",
                json={
                    "composition": {"layers": []},
                    "execution_mode": "builder_test",
                    "native_test_ref": REF,
                    "native_test_protocol_version": 1,
                },
            )
            assert response.status_code == 409
            assert response.json()["detail"] == {"code": "native_policy_stopped", "reason_code": "approval_revoked"}

    asyncio.run(exercise_denial())
    assert counters == dict(model=0, tool=0, eager=0, config=0, bootstrap=0, lease=0)


def test_client_refreshes_capabilities_and_never_falls_back():
    from dify_agent.client import Client

    required = ["pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"]
    seen = []
    full = True

    async def handler(request):
        seen.append((request.method, request.url.path))
        if request.url.path == "/runs/capabilities":
            return httpx.Response(200, json={"protocol_version": 1, "features": required if full else []})
        return httpx.Response(202, json={"run_id": "run-1", "status": "running"})

    async def exercise():
        nonlocal full
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = Client(base_url="http://test", async_http_client=http)
            request = CreateRunRequest(
                composition={"layers": []},
                execution_mode="builder_test",
                native_test_ref=REF,
                native_test_protocol_version=1,
            )
            await client.create_run(request)
            full = False
            with pytest.raises(NativeTestProtocolUnsupported):
                await client.create_run(request)

    asyncio.run(exercise())
    assert seen == [("GET", "/runs/capabilities"), ("POST", "/runs"), ("GET", "/runs/capabilities")]


@pytest.mark.parametrize(
    "response",
    [httpx.Response(404), httpx.Response(200, json={"protocol_version": 1, "features": "wrong"}), httpx.Response(503)],
)
def test_client_maps_unavailable_capability_endpoint_to_stable_error(response):
    from dify_agent.client import Client

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response)) as http:
            client = Client(base_url="http://test", async_http_client=http)
            with pytest.raises(NativeTestProtocolUnsupported):
                await client.native_test_capabilities()

    asyncio.run(exercise())


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), {1: "not a JSON key"}, (1, 2), "\ud800"])
def test_executable_wire_rejects_non_finite_or_non_json_arguments(bad):
    from dify_agent.protocol.native_testing import AgentEffectIntent

    with pytest.raises(ValidationError):
        AgentEffectIntent.model_validate(
            {
                "key": {"invocation_id": "i", "occurrence_path": ["p"], "cursor": 0},
                "kind": "tool",
                "resource_ref": "r",
                "implementation_revision": "v",
                "account_ref": None,
                "target": {},
                "parameters": bad,
                "input_digest": "a" * 64,
                "capability_digest": "b" * 64,
            }
        )


@pytest.mark.parametrize(
    "payload",
    [
        {
            "kind": "dispatch",
            "permit_id": "p",
            "attempt_id": "a",
            "operation_id": "o",
            "expires_at": "2026-10-14T00:00:00Z",
        },
        {"kind": "waiting", "pending_operation_id": "pending", "wait_reason": "interaction"},
        {"kind": "recorded", "operation_id": "o", "result_ref": "result"},
        {"kind": "stop", "reason_code": "approval_denied"},
    ],
)
def test_exact_decision_wire_contract(payload):
    from pydantic import TypeAdapter
    from dify_agent.protocol.native_testing import AgentEffectDecision

    adapter = TypeAdapter(AgentEffectDecision)
    assert adapter.validate_python(payload).model_dump(mode="json") == payload
    with pytest.raises(ValidationError):
        adapter.validate_python(payload | {"grant": True})


def test_invalid_checkpoint_does_not_enter_public_status_or_events():
    from dify_agent.protocol.schemas import RunStatusResponse, RunWaitingEventData

    with pytest.raises(ValidationError):
        RunWaitingEventData(generation=0, pending_actions=[], config={"secret": "value"})
    with pytest.raises(ValidationError):
        RunStatusResponse(
            run_id="r",
            status="waiting",
            created_at="2026-10-14T00:00:00Z",
            updated_at="2026-10-14T00:00:00Z",
            native_checkpoint_json="protected",
        )


@pytest.mark.parametrize("sync", [False, True])
def test_ordinary_client_wire_remains_compatible_with_frozen_old_server(sync):
    """The old server forbids unknown fields; expectations are literal old JSON."""
    from pydantic import BaseModel, ConfigDict, Field
    from fastapi.testclient import TestClient
    from dify_agent.client import Client

    class OldRequest(BaseModel):
        model_config = ConfigDict(extra="forbid")
        composition: dict
        idempotency_key: str | None = None
        metadata: dict = Field(default_factory=dict)
        session_snapshot: dict | None = None

    app = FastAPI()
    received = []

    @app.get("/runs/capabilities")
    async def forbidden_negotiation():
        raise AssertionError("ordinary requests must not negotiate native testing")

    @app.post("/runs", status_code=202)
    async def old_create(request: OldRequest):
        received.append(request.model_dump())
        return {"run_id": "old-run", "status": "running"}

    request = CreateRunRequest(composition={"layers": []}, metadata={"tag": "ordinary"})
    if sync:
        with TestClient(app) as server:

            def proxy(incoming):
                response = server.request(
                    incoming.method, incoming.url.path, content=incoming.content, headers=incoming.headers
                )
                return httpx.Response(response.status_code, content=response.content, headers=response.headers)

            with httpx.Client(transport=httpx.MockTransport(proxy)) as http:
                client = Client(base_url="http://testserver", sync_http_client=http)
                assert client.create_run_sync(request).run_id == "old-run"
    else:

        async def exercise():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as http:
                client = Client(base_url="http://test", async_http_client=http)
                assert (await client.create_run(request)).run_id == "old-run"

        asyncio.run(exercise())
    assert received == [
        {
            "composition": {"schema_version": 2, "layers": []},
            "idempotency_key": None,
            "metadata": {"tag": "ordinary"},
            "session_snapshot": None,
        }
    ]

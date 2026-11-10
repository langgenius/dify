"""Real authenticated FastAPI boundary, explicit persisted-store stand-in."""

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from dify_agent.protocol import native_testing as wire
from dify_agent.server.auth import create_bearer_token_dependency
from dify_agent.server.routes.native_testing import create_native_testing_router
from dify_agent.server.schemas import RunRecord

REF = {
    "policy_version": "builder-native-test-v1",
    "request_id": "req",
    "invocation_id": "inv",
    "context_digest": "a" * 64,
}
PARENT = {
    "ref": REF,
    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
    "input_result_ref": "input",
    "input_digest": "b" * 64,
}


def test_identity_is_private_persisted_metadata_and_not_public_response():
    assert "runtime_identity" in RunRecord.model_fields, "S1 persisted identity is missing"
    identity = wire.AgentRuntimeIdentity(
        run_id="run", execution_mode="builder_test", parent_node=PARENT, request_digest="c" * 64, agent_generation=0
    )
    record = RunRecord(run_id="run", status="running", runtime_identity=identity)
    assert RunRecord.model_validate_json(record.model_dump_json()).runtime_identity == identity
    from dify_agent.protocol.schemas import RunStatusResponse

    assert "runtime_identity" not in RunStatusResponse.model_fields


@pytest.mark.parametrize("token,status", [(None, 401), ("wrong", 401), ("synthetic", 200)])
def test_bearer_precedes_body_and_store(token, status):
    calls = []

    class Store:
        async def read_run_identity(self, *, run_id, selection):
            calls.append((run_id, selection))
            return wire.AgentRuntimeIdentity(
                run_id=run_id,
                execution_mode="builder_test",
                parent_node=PARENT,
                request_digest="c" * 64,
                agent_generation=0,
            )

    app = FastAPI()
    protected = APIRouter(dependencies=[create_bearer_token_dependency("synthetic")])
    protected.include_router(create_native_testing_router(lambda: Store()))
    app.include_router(protected)
    with TestClient(app) as client:
        response = client.post(
            "/runs/run/native-identity",
            json={"parent_node": PARENT, "request_digest": "c" * 64},
            headers={} if token is None else {"Authorization": "Bearer " + token},
        )
    assert response.status_code == status
    assert len(calls) == (1 if status == 200 else 0)
    if status == 200:
        assert response.headers["cache-control"] == "no-store"
        assert len(response.content) <= 4096


def test_oversize_and_authority_fields_stop_before_store():
    calls = []

    class Store:
        async def read_run_identity(self, **kwargs):
            calls.append(kwargs)
            raise AssertionError("invalid body reached store")

    app = FastAPI()
    app.include_router(create_native_testing_router(lambda: Store()))
    with TestClient(app) as client:
        response = client.post("/runs/run/native-identity", content=b" " * 4097)
        assert response.status_code == 413
        response = client.post(
            "/runs/run/native-identity", json={"parent_node": PARENT, "request_digest": "c" * 64, "approved": True}
        )
        assert response.status_code == 422
    assert not calls


def test_scheduler_persists_exact_actual_identity_before_callback_and_schedules_zero_on_denial():
    """Real scheduler ordering; explicit store/continuation doubles, no Redis/runtime readiness."""
    import asyncio

    import httpx

    from dify_agent.protocol.schemas import CreateRunRequest
    from dify_agent.runtime.context import Services
    from dify_agent.runtime.event_sink import RunFinalizationResult
    from dify_agent.runtime.native_continuation import NativePolicyStopped
    from dify_agent.runtime.run_scheduler import RunScheduler

    calls = []
    persisted = []
    request = CreateRunRequest(
        composition={"layers": []},
        execution_mode="builder_test",
        native_test_ref=REF,
        native_parent_node=PARENT,
        native_test_protocol_version=1,
    )

    class Store:
        async def create_run(self, *, identity):
            calls.append("persist")
            record = RunRecord(
                run_id="actual-run",
                status="running",
                runtime_identity=wire.AgentRuntimeIdentity(
                    run_id="actual-run", agent_generation=0, **identity.model_dump()
                ),
            )
            persisted.append(record)
            return record

        async def finalize_run(self, event):
            calls.append("finalize")
            return RunFinalizationResult(applied=True, status="failed")

    class Owner:
        capabilities = wire.NativeTestCapabilities(
            protocol_version=1, features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
        )

        async def prepare(self, *, run_id, request):
            calls.append("callback")
            identity = persisted[0].runtime_identity
            assert identity.run_id == run_id == "actual-run"
            assert identity.parent_node == request.native_parent_node
            assert identity.execution_mode == request.execution_mode == "builder_test"
            assert identity.request_digest == wire.executable_request_digest(request)
            raise NativePolicyStopped("approval_denied")

    def runner(*_args, **_kwargs):
        calls.append("runner")
        raise AssertionError("callback refusal scheduled a runner")

    async def exercise():
        async with httpx.AsyncClient() as http:
            scheduler = RunScheduler(
                store=Store(), services=Services(http, http), native_owner=Owner(), runner_factory=runner
            )
            with pytest.raises(NativePolicyStopped):
                await scheduler.create_run(request)
            assert not scheduler.active_tasks

    asyncio.run(exercise())
    assert calls == ["persist", "callback", "finalize"]

"""Actual scheduler scopes, durable-owner double (no Redis or native readiness)."""

import asyncio
import base64
import json

import httpx
import pytest

from dify_agent.adapters.native_testing.transport import AgentRuntimeHTTPClient, AgentRuntimeTransportError
from dify_agent.protocol.native_testing import (
    AgentRuntimeIdentity,
    ContinuationClaim,
    ContinueRunRequest,
    NativeTestCapabilities,
    executable_request_digest,
)
from dify_agent.protocol.schemas import CreateRunRequest
from dify_agent.runtime.context import Services
from dify_agent.runtime.native_continuation import NativeContinuation, PreparedContinuation, NativeApprovalSuspended
from dify_agent.runtime.run_scheduler import RunScheduler
from dify_agent.server.schemas import RunRecord
from tests.local.dify_agent.runtime.test_native_continuation import pending

PARENT = {
    "ref": {
        "policy_version": "builder-native-test-v1",
        "request_id": "request-1",
        "invocation_id": "invocation-1",
        "context_digest": "a" * 64,
    },
    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
    "input_result_ref": "input",
    "input_digest": "c" * 64,
}
CAPS = NativeTestCapabilities(
    protocol_version=1, features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
)
URL = "http://api/inner/api/agent/runtime/tools/invoke"


class Store:
    def __init__(self):
        self.records = {}
        self.reads = []
        self.checkpoint = None
        self.tamper = None

    async def create_run(self, *, identity):
        run_id = f"run-{len(self.records) + 1}"
        actual = AgentRuntimeIdentity(run_id=run_id, agent_generation=0, **identity.model_dump())
        record = RunRecord(run_id=run_id, status="running", runtime_identity=actual)
        self.records[run_id] = record
        return record

    async def get_run(self, run_id):
        return self.records[run_id]

    async def read_run_identity(self, *, run_id, selection):
        record = self.records[run_id]
        actual = record.runtime_identity
        assert selection.parent_node == actual.parent_node
        assert selection.request_digest == actual.request_digest
        self.reads.append((run_id, record.native_generation))
        result = actual.model_copy(update={"agent_generation": record.native_generation})
        return result if self.tamper is None else result.model_copy(update=self.tamper)

    async def wait_for_cancellation(self, run_id):
        await asyncio.Event().wait()

    async def get_cancellation_intent(self, run_id):
        return None

    async def get_checkpoint(self, run_id):
        return self.checkpoint

    async def claim_continuation(self, *, run_id, expected_generation, idempotency_key):
        return ContinuationClaim(
            run_id=run_id, generation=expected_generation + 1, idempotency_key=idempotency_key, claim_id="claim"
        )

    async def start_continuation(self, claim):
        self.records[claim.run_id] = self.records[claim.run_id].model_copy(
            update={"native_generation": claim.generation, "status": "running"}
        )
        return True


class Runner:
    terminal_session_snapshot = None
    terminal_usage = None

    def __init__(self, http):
        self.http = http

    async def run(self):
        await self.http.post(URL, json={})


def decoded(request):
    value = request.headers.get("X-Dify-Agent-Run", "")
    return json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))


def native_request():
    return CreateRunRequest(
        composition={"layers": []},
        execution_mode="builder_test",
        native_test_ref=PARENT["ref"],
        native_parent_node=PARENT,
        native_test_protocol_version=1,
    )


def test_scheduled_ordinary_runs_use_actual_persisted_identity_with_concurrent_shared_client():
    async def exercise():
        store = Store()
        seen = []
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(
                lambda request: seen.append(decoded(request)) or httpx.Response(200, json={"observation": "ok"})
            ),
        ) as http:
            scheduler = RunScheduler(store=store, services=Services(http, http), runner_factory=lambda *_: Runner(http))
            a, b = await asyncio.gather(
                scheduler.create_run(CreateRunRequest(composition={"layers": []})),
                scheduler.create_run(CreateRunRequest(composition={"layers": []})),
            )
            await asyncio.gather(*tuple(scheduler.active_tasks.values()))
            assert {item["agent_run_id"] for item in seen} == {a.run_id, b.run_id}
            assert all(item["parent_node"] is None and item["agent_generation"] == 0 for item in seen)
            assert set(store.reads) == {(a.run_id, 0), (b.run_id, 0)}
            with pytest.raises(AgentRuntimeTransportError):
                await http.post(URL, json={})

    asyncio.run(exercise())


def test_initial_native_preparation_and_runner_have_separate_persisted_scopes():
    async def exercise():
        store = Store()
        seen = []
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda request: seen.append(decoded(request)) or httpx.Response(200)),
        ) as http:

            class Owner:
                capabilities = CAPS

                async def prepare(self, *, run_id, request):
                    await http.post(URL, json={})
                    return NativeContinuation(
                        run_id=run_id,
                        ref=request.native_test_ref,
                        generation=0,
                        config_ref="cfg",
                        config_digest=executable_request_digest(request),
                    )

            scheduler = RunScheduler(
                store=store, services=Services(http, http), native_owner=Owner(), runner_factory=lambda *_: Runner(http)
            )
            record = await scheduler.create_run(native_request())
            await asyncio.gather(*tuple(scheduler.active_tasks.values()))
            assert [item["agent_run_id"] for item in seen] == [record.run_id, record.run_id]
            assert [item["agent_generation"] for item in seen] == [0, 0]
            assert store.reads == [(record.run_id, 0), (record.run_id, 0)]

    asyncio.run(exercise())


def test_restore_uses_persisted_old_generation_then_execution_rereads_after_start_cas():
    async def exercise():
        store = Store()
        seen = []
        request = native_request()
        state = NativeContinuation(
            run_id="run-1",
            ref=request.native_test_ref,
            generation=0,
            config_ref="cfg",
            config_digest=executable_request_digest(request),
        )
        cp = state.capture_wait(NativeApprovalSuspended(pending(stage="bootstrap")))
        store.checkpoint = cp
        from dify_agent.protocol.native_testing import AgentRuntimeIdentitySeed

        record = await store.create_run(
            identity=AgentRuntimeIdentitySeed(
                execution_mode="builder_test",
                parent_node=request.native_parent_node,
                request_digest=state.config_digest,
            )
        )
        store.records[record.run_id] = record.model_copy(update={"status": "waiting"})
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(decoded(req)) or httpx.Response(200)),
        ) as http:

            class Owner:
                capabilities = CAPS

                async def restore(self, *, checkpoint):
                    await http.post(
                        "http://api/inner/api/agent/runtime/native-testing/prepared-config", json={"config_ref": "cfg"}
                    )
                    return PreparedContinuation(
                        request=request.model_copy(update={"session_snapshot": cp.session_snapshot}), continuation=state
                    )

            scheduler = RunScheduler(
                store=store, services=Services(http, http), native_owner=Owner(), runner_factory=lambda *_: Runner(http)
            )
            await scheduler.continue_run(
                record.run_id,
                ContinueRunRequest(ref=request.native_test_ref, expected_generation=0, idempotency_key="resume"),
            )
            await asyncio.gather(*tuple(scheduler.active_tasks.values()))
            assert [item["agent_generation"] for item in seen] == [0, 1]
            assert all(item["request_digest"] == state.config_digest for item in seen)
            assert store.reads == [(record.run_id, 0), (record.run_id, 1)]

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "tamper",
    [
        {"run_id": "foreign"},
        {"request_digest": "f" * 64},
        {"agent_generation": 9},
        {"execution_mode": "ordinary", "parent_node": None},
    ],
)
def test_scheduler_refuses_changed_readback_before_any_native_callback_or_send(tamper):
    async def exercise():
        store = Store()
        store.tamper = tamper
        seen = []
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200)),
        ) as http:

            class Owner:
                capabilities = CAPS

                async def prepare(self, **kwargs):
                    pytest.fail("unverified identity reached preparation")

            scheduler = RunScheduler(store=store, services=Services(http, http), native_owner=Owner())

            # Failure settlement in this isolated test store has no side effects.
            async def finalize_run(event):
                from dify_agent.runtime.event_sink import RunFinalizationResult

                return RunFinalizationResult(applied=True, status="failed")

            store.finalize_run = finalize_run
            with pytest.raises(AgentRuntimeTransportError):
                await scheduler.create_run(native_request())
            assert not scheduler.active_tasks
        assert seen == []

    asyncio.run(exercise())


@pytest.mark.parametrize("credential", ["inner_api_key", "plugin_daemon_api_key"])
def test_scheduler_itself_cannot_install_native_owner_with_legacy_authority(credential):
    async def exercise():
        async with httpx.AsyncClient() as http:
            with pytest.raises(AgentRuntimeTransportError):
                RunScheduler(
                    store=Store(), services=Services(http, http, **{credential: "legacy"}), native_owner=object()
                )

    asyncio.run(exercise())


@pytest.mark.parametrize("failure", [False, True])
def test_actual_scheduler_finally_revokes_inherited_detached_runner_task(failure):
    async def exercise():
        store = Store()
        seen = []
        detached = []
        release = asyncio.Event()
        async with AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200)),
        ) as http:

            async def orphan():
                await release.wait()
                with pytest.raises(AgentRuntimeTransportError):
                    await http.post(URL, json={})

            class DetachingRunner(Runner):
                async def run(self):
                    detached.append(asyncio.create_task(orphan()))
                    if failure:
                        raise ValueError("runner failed")

            scheduler = RunScheduler(
                store=store, services=Services(http, http), runner_factory=lambda *_: DetachingRunner(http)
            )
            await scheduler.create_run(CreateRunRequest(composition={"layers": []}))
            outcomes = await asyncio.gather(*tuple(scheduler.active_tasks.values()), return_exceptions=True)
            assert outcomes == [None]  # Existing scheduler logs runner exceptions after draining.
            release.set()
            await asyncio.gather(*detached)
        assert seen == []

    asyncio.run(exercise())

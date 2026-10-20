"""Synthetic FunctionModel proves our checkpoint's real native deferral contract."""

import asyncio
from types import ModuleType

import httpx
import pytest
from pydantic_ai import Agent, DeferredToolRequests, DeferredToolResults, ToolApproved
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel

from dify_agent.protocol.native_testing import AgentEffectIntent, AgentNativeTestRef, AgentOperationKey
from dify_agent.protocol.schemas import RUN_EVENT_ADAPTER, CreateRunRequest
from dify_agent.runtime.context import Deps, Services
from dify_agent.runtime.native_continuation import (
    AgentCheckpoint,
    AgentPendingCall,
    NativeApprovalSuspended,
    NativeContinuation,
    NativePolicyStopped,
    defer_native_call,
    validate_deferred_results,
)

REF = AgentNativeTestRef(
    policy_version="builder-native-test-v1",
    request_id="request-1",
    invocation_id="invocation-1",
    context_digest="a" * 64,
)


def pending(reason="approval", stage="tool"):
    return AgentPendingCall(
        call_id="call-1",
        tool_name="write",
        intent=AgentEffectIntent(
            key=AgentOperationKey(invocation_id="invocation-1", occurrence_path=("tool", "call-1"), cursor=0),
            kind="tool",
            resource_ref="tool-1",
            implementation_revision="revision-1",
            account_ref=None,
            target={"table": "t"},
            parameters={"values": [1, True, {"file_ref": "file-1"}]},
            input_digest="b" * 64,
            capability_digest="c" * 64,
        ),
        stage=stage,
        pending_operation_id="pending-1",
        wait_reason=reason,
    )


def continuation():
    return NativeContinuation(
        run_id="run-1", ref=REF, generation=0, config_ref="protected-config-1", config_digest="d" * 64
    )


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_stage_checkpoint_preserves_reason_without_faking_tool_history(reason):
    state = continuation()
    checkpoint = state.capture_wait(NativeApprovalSuspended(pending(reason, "bootstrap")))
    assert checkpoint.stage == "bootstrap"
    assert checkpoint.history == []
    restored = AgentCheckpoint.model_validate_json(checkpoint.model_dump_json())
    event = RUN_EVENT_ADAPTER.validate_json(restored.waiting_event().model_dump_json())
    assert event.data.pending_actions[0].wait_reason == reason
    assert event.data.pending_actions[0].pending_operation_id == "pending-1"
    assert restored.pending_calls[0].intent.parameters == {"values": [1, True, {"file_ref": "file-1"}]}


@pytest.mark.parametrize("deferred_kind", ["approval", "external"])
def test_real_native_deferral_checkpoint_and_resume_without_reissuing_call(deferred_kind):
    async def exercise():
        executions = []

        class Gate(AbstractCapability):
            async def before_tool_execute(self, ctx, *, call, tool_def, args):
                if not ctx.tool_call_approved:
                    call_pending = pending()
                    call_pending = call_pending.model_copy(
                        update={
                            "intent": call_pending.intent.model_copy(
                                update={"parameters": {"values": args["values"], "enabled": args["enabled"]}}
                            )
                        }
                    )
                    defer_native_call(call_pending.model_copy(update={"deferred_kind": deferred_kind}))
                return args

        def synthetic(messages, info):
            if any(isinstance(part, ToolReturnPart) for message in messages for part in message.parts):
                return ModelResponse(parts=[TextPart("done")])
            return ModelResponse(
                parts=[ToolCallPart("write", {"values": [1, True, {"file_ref": "file-1"}]}, tool_call_id="call-1")]
            )

        agent = Agent(FunctionModel(synthetic), output_type=[str, DeferredToolRequests], capabilities=[Gate()])

        @agent.tool_plain
        def write(values: list, enabled: bool = True):
            executions.append(values)
            return "stored"

        first = await agent.run("write it")
        assert isinstance(first.output, DeferredToolRequests)
        assert executions == []
        async with httpx.AsyncClient() as client:
            deps = Deps(layers={}, services=Services(client, client), run_id="run-1")
            checkpoint = continuation().capture(result=first, deps=deps)
        restored = AgentCheckpoint.model_validate_json(checkpoint.model_dump_json())
        assert restored.history[-1].state == "complete"
        assert restored.pending_calls[0].call_id == "call-1"
        results = (
            DeferredToolResults(approvals={"call-1": ToolApproved()})
            if deferred_kind == "approval"
            else DeferredToolResults(calls={"call-1": "stored"})
        )
        validate_deferred_results(restored, results)
        last = await agent.run(message_history=restored.history, deferred_tool_results=results)
        assert last.output == "done"
        assert executions == ([[1, True, {"file_ref": "file-1"}]] if deferred_kind == "approval" else [])

    asyncio.run(exercise())


def test_denied_or_changed_native_arguments_never_become_model_feedback():
    checkpoint = continuation().capture_wait(NativeApprovalSuspended(pending()))
    for results in [
        DeferredToolResults(approvals={"call-1": False}),
        DeferredToolResults(approvals={"call-1": ToolApproved(override_args={"values": []})}),
    ]:
        with pytest.raises(NativePolicyStopped):
            validate_deferred_results(checkpoint, results)


def test_direct_runner_rejects_marked_test_before_module_loading():
    from dify_agent.protocol.native_testing import NativeTestProtocolUnsupported
    from dify_agent.runtime.event_sink import InMemoryRunEventSink
    from dify_agent.runtime.runner import AgentRunRunner

    async def exercise():
        async with httpx.AsyncClient() as client:
            runner = AgentRunRunner(
                sink=InMemoryRunEventSink(),
                run_id="run-1",
                services=Services(client, client),
                request=CreateRunRequest(
                    composition={"layers": []},
                    execution_mode="builder_test",
                    native_test_ref=REF,
                    native_parent_node={
                        "ref": REF,
                        "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                        "input_result_ref": "input",
                        "input_digest": "b" * 64,
                    },
                    native_test_protocol_version=1,
                ),
            )
            with pytest.raises(NativeTestProtocolUnsupported):
                await runner.run()

    asyncio.run(exercise())


def test_scheduler_rejects_native_before_persistence():
    from dify_agent.protocol.native_testing import NativeTestProtocolUnsupported
    from dify_agent.runtime.run_scheduler import RunScheduler

    class NoCallsStore:
        async def create_run(self, *, identity=None):
            raise AssertionError("capability check must precede persistence")

    async def exercise():
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=NoCallsStore(), services=Services(client, client))
            request = CreateRunRequest(
                composition={"layers": []},
                execution_mode="builder_test",
                native_test_ref=REF,
                native_parent_node={
                    "ref": REF,
                    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                    "input_result_ref": "input",
                    "input_digest": "b" * 64,
                },
                native_test_protocol_version=1,
            )
            with pytest.raises(NativeTestProtocolUnsupported):
                await scheduler.create_run(request)

    asyncio.run(exercise())


@pytest.mark.parametrize("stage", ["tool", "model"])
def test_runner_commits_wait_instead_of_success_and_persistence_failure_is_not_resumable(monkeypatch, stage):
    from pydantic import BaseModel
    from pydantic_ai.models.function import DeltaToolCall
    from pydantic_ai.toolsets import FunctionToolset

    from dify_agent.layers.dify_plugin import llm_layer
    from dify_agent.protocol.native_testing import NativeTestCapabilities
    from dify_agent.runtime.event_sink import InMemoryRunEventSink
    from dify_agent.runtime.modules import REGISTRY
    from dify_agent.runtime.native_effects import (
        NativeEffectDispatcher,
        NativeEffectsCapability,
        NativeEffectSession,
        NativeToolBoundary,
    )
    from dify_agent.runtime.runner import AgentRunRunner

    async def arguments(args):
        return args

    def effect_gate(state, *, suspend_model=False):
        class Policy:
            async def before_call(self, **kwargs):
                from dify_agent.protocol.native_testing import AgentApprovalWait

                return AgentApprovalWait(pending_operation_id="pending-1")

        async def prepare(**kwargs):
            return pending().intent.model_copy(
                update={"key": kwargs["key"], "target": kwargs["target"], "parameters": kwargs["parameters"]}
            )

        class Gate(NativeEffectsCapability):
            async def before_model_request(self, ctx, request_context):
                if suspend_model:
                    raise NativeApprovalSuspended(pending("configuration", "model"))
                return request_context

        return Gate(
            NativeEffectSession(
                continuation=state,
                dispatcher=NativeEffectDispatcher(policy=Policy()),
                result_store=None,
                prepare_intent=prepare,
            )
        )

    class Config(BaseModel):
        pass

    class Tools(FunctionToolset):
        def __init__(self, name):
            super().__init__()
            self.add_function(
                lambda values: "unexpected effect",
                name="write",
                metadata={"native_effect": NativeToolBoundary("tool", {"provider": "test"}, arguments)},
            )

    async def stream(messages, info):
        yield {
            0: DeltaToolCall(name="write", json_args='{"values":[1,true,{"file_ref":"file-1"}]}', tool_call_id="call-1")
        }

    model = FunctionModel(stream_function=stream)
    monkeypatch.setattr(llm_layer.Capability, "build_model", lambda self, deps: model)
    module = ModuleType("native_test_tool")
    module.Config, module.State, module.Toolset = Config, Config, Tools
    registry = dict(REGISTRY, write=module)
    request = CreateRunRequest(
        composition={
            "layers": [
                {
                    "name": "execution_context",
                    "config": {
                        "tenant_id": "tenant",
                        "user_id": "user",
                        "user_from": "account",
                        "app_id": "app",
                        "agent_mode": "agent_app",
                        "invoke_from": "web-app",
                    },
                },
                {"name": "llm", "config": {"plugin_id": "openai", "model_provider": "openai", "model": "synthetic"}},
                {"name": "history"},
                {"name": "prompt", "config": {"user": "write it"}},
                {"name": "write"},
            ]
        },
        execution_mode="builder_test",
        native_test_ref=REF,
        native_parent_node={
            "ref": REF,
            "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
            "input_result_ref": "input",
            "input_digest": "b" * 64,
        },
        native_test_protocol_version=1,
    )

    async def exercise():
        async with httpx.AsyncClient() as client:
            for fail in (False, True):

                class Sink(InMemoryRunEventSink):
                    async def persist_waiting(self, **kwargs):
                        if fail:
                            raise ConnectionError("persistence failed")
                        return await super().persist_waiting(**kwargs)

                state = continuation()
                state.capabilities = [effect_gate(state, suspend_model=stage == "model")]
                sink = Sink()
                runner = AgentRunRunner(
                    sink=sink,
                    request=request,
                    run_id="run-1",
                    services=Services(client, client),
                    registry=registry,
                    native_continuation=state,
                    native_capabilities=NativeTestCapabilities(
                        protocol_version=1,
                        features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"},
                    ),
                )
                if fail:
                    with pytest.raises(ConnectionError):
                        await runner.run()
                    assert "run_waiting" not in [e.type for e in sink.events["run-1"]]
                    assert sink.statuses["run-1"] == "failed"
                else:
                    await runner.run()
                    assert sink.events["run-1"][-1].type == "run_waiting"
                    assert sink.statuses["run-1"] == "waiting"
                    cp = sink.checkpoints["run-1"]
                    assert cp.pending_calls[0].call_id == "call-1"
                    assert cp.history
                    assert cp.stage == stage
                    if stage == "tool":
                        assert cp.session_snapshot.layers["history"]["messages"][-1]["state"] == "complete"
                    else:
                        from pydantic_ai.messages import UserPromptPart

                        async def resumed_stream(messages, info):
                            assert (
                                sum(isinstance(part, UserPromptPart) for message in messages for part in message.parts)
                                == 1
                            )
                            yield "done"

                        resumed_model = FunctionModel(stream_function=resumed_stream)
                        monkeypatch.setattr(llm_layer.Capability, "build_model", lambda self, deps: resumed_model)
                        resumed_state = continuation()
                        resumed_state.generation = 1
                        resumed_state.history = cp.history
                        resumed_state.session_snapshot = cp.session_snapshot
                        resumed_state.capabilities = [effect_gate(resumed_state)]
                        resumed_sink = InMemoryRunEventSink()
                        resumed = AgentRunRunner(
                            sink=resumed_sink,
                            request=request.model_copy(update={"session_snapshot": cp.session_snapshot}),
                            run_id="run-1",
                            services=Services(client, client),
                            registry=registry,
                            native_continuation=resumed_state,
                            native_capabilities=runner.native_capabilities,
                        )
                        await resumed.run()
                        assert "run_started" not in [event.type for event in resumed_sink.events["run-1"]]
                        assert resumed_sink.events["run-1"][-1].data.output == "done"

    asyncio.run(exercise())


def test_scheduler_restores_only_matching_pinned_snapshot_before_scheduling():
    from dify_agent.protocol.native_testing import ContinuationClaim, ContinueRunRequest, NativeTestCapabilities
    from dify_agent.runtime.native_continuation import NativeContinuationConflict, PreparedContinuation
    from dify_agent.runtime.run_scheduler import RunScheduler
    from dify_agent.server.schemas import RunRecord

    cp = continuation().capture_wait(NativeApprovalSuspended(pending()))

    class Store:
        async def get_checkpoint(self, run_id):
            return cp

        async def claim_continuation(self, **kwargs):
            return ContinuationClaim(run_id="run-1", generation=1, idempotency_key="continue-1", claim_id="claim-1")

        async def get_run(self, run_id):
            return RunRecord(run_id=run_id, status="waiting")

        async def start_continuation(self, claim):
            raise AssertionError("mismatched snapshot must not schedule")

    class Owner:
        capabilities = NativeTestCapabilities(
            protocol_version=1, features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
        )

        async def restore(self, *, checkpoint):
            request = CreateRunRequest(
                composition={"layers": []},
                execution_mode="builder_test",
                native_test_ref=REF,
                native_parent_node={
                    "ref": REF,
                    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                    "input_result_ref": "input",
                    "input_digest": "b" * 64,
                },
                native_test_protocol_version=1,
                session_snapshot={"schema_version": 2, "layers": {"history": {"messages": []}}},
            )
            return PreparedContinuation(
                request=request,
                continuation=continuation(),
                deferred_tool_results=DeferredToolResults(approvals={"call-1": ToolApproved()}),
            )

    async def exercise():
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=Store(), services=Services(client, client), native_owner=Owner())
            with pytest.raises(NativeContinuationConflict):
                await scheduler.continue_run(
                    "run-1", ContinueRunRequest(ref=REF, expected_generation=0, idempotency_key="continue-1")
                )
            assert scheduler.active_tasks == {}

    asyncio.run(exercise())


@pytest.mark.parametrize("finishing_wait", [False, True])
def test_scheduler_resume_keeps_run_and_claim_after_lost_acknowledgement(finishing_wait):
    """Scheduler wiring only: real Redis atomicity is covered in CI store tests."""
    from dify_agent.protocol.native_testing import ContinuationClaim, ContinueRunRequest, NativeTestCapabilities
    from dify_agent.runtime.native_continuation import PreparedContinuation
    from dify_agent.runtime.run_scheduler import RunScheduler
    from dify_agent.server.schemas import RunRecord

    cp = continuation().capture_wait(NativeApprovalSuspended(pending()))
    executions = []
    claim = ContinuationClaim(run_id="run-1", generation=1, idempotency_key="continue-1", claim_id="claim-1")

    class Store:
        started = False

        async def get_checkpoint(self, run_id):
            return cp

        async def claim_continuation(self, **kwargs):
            assert kwargs == {"run_id": "run-1", "expected_generation": 0, "idempotency_key": "continue-1"}
            return claim

        async def get_run(self, run_id):
            return RunRecord(
                run_id=run_id, status="running" if self.started else "waiting", native_dispatch_started=self.started
            )

        async def start_continuation(self, incoming):
            assert incoming == claim
            if self.started:
                return False
            self.started = True
            return True

        async def wait_for_cancellation(self, run_id):
            await asyncio.Event().wait()

        async def get_cancellation_intent(self, run_id):
            return None

    class Owner:
        capabilities = NativeTestCapabilities(
            protocol_version=1, features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
        )

        async def restore(self, *, checkpoint):
            request = CreateRunRequest(
                composition={"layers": []},
                execution_mode="builder_test",
                native_test_ref=REF,
                native_parent_node={
                    "ref": REF,
                    "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                    "input_result_ref": "input",
                    "input_digest": "b" * 64,
                },
                native_test_protocol_version=1,
                session_snapshot=checkpoint.session_snapshot,
            )
            return PreparedContinuation(
                request=request,
                continuation=continuation(),
                deferred_tool_results=DeferredToolResults(approvals={"call-1": ToolApproved()}),
            )

    class Runner:
        terminal_session_snapshot = None
        terminal_usage = None

        async def run(self):
            executions.append("run-1")

    async def exercise():
        async with httpx.AsyncClient() as client:
            store = Store()
            request = ContinueRunRequest(ref=REF, expected_generation=0, idempotency_key="continue-1")
            scheduler = RunScheduler(
                store=store,
                services=Services(client, client),
                native_owner=Owner(),
                runner_factory=lambda record, req: Runner(),
            )
            if finishing_wait:
                scheduler.active_tasks["run-1"] = asyncio.create_task(asyncio.sleep(0))
            assert await scheduler.continue_run("run-1", request) == claim
            await asyncio.gather(*scheduler.active_tasks.values())
            assert executions == ["run-1"]
            # New process with the same durable scheduling result cannot execute again.
            restarted = RunScheduler(
                store=store,
                services=Services(client, client),
                native_owner=Owner(),
                runner_factory=lambda record, req: Runner(),
            )
            assert await restarted.continue_run("run-1", request) == claim
            await asyncio.gather(*restarted.active_tasks.values())
            assert executions == ["run-1"]

    asyncio.run(exercise())


def test_api_owner_denial_stops_waiting_run_instead_of_returning_model_feedback():
    from dify_agent.protocol.native_testing import ContinuationClaim, ContinueRunRequest, NativeTestCapabilities
    from dify_agent.runtime.run_scheduler import RunScheduler

    cp = continuation().capture_wait(NativeApprovalSuspended(pending()))
    stopped = []
    failed_reasons = []

    class Store:
        async def create_run(self, *, identity=None):
            from dify_agent.server.schemas import RunRecord

            return RunRecord(run_id="run-1", status="running")

        async def finalize_run(self, event):
            from dify_agent.runtime.event_sink import RunFinalizationResult

            failed_reasons.append(event.data.reason)
            return RunFinalizationResult(applied=True, status="failed")

        async def get_checkpoint(self, run_id):
            return cp

        async def claim_continuation(self, **kwargs):
            return ContinuationClaim(run_id="run-1", generation=1, idempotency_key="continue-1", claim_id="claim-1")

        async def stop_native_run(self, *, run_id, expected_generation, reason_code):
            stopped.append((run_id, expected_generation, reason_code))

    class Owner:
        capabilities = NativeTestCapabilities(
            protocol_version=1, features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"}
        )

        async def restore(self, *, checkpoint):
            raise NativePolicyStopped("approval_denied")

        async def prepare(self, *, run_id, request):
            raise NativePolicyStopped("approval_revoked")

    async def exercise():
        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(store=Store(), services=Services(client, client), native_owner=Owner())
            with pytest.raises(NativePolicyStopped):
                await scheduler.continue_run(
                    "run-1", ContinueRunRequest(ref=REF, expected_generation=0, idempotency_key="continue-1")
                )
            assert stopped == [("run-1", 0, "approval_denied")]
            assert scheduler.active_tasks == {}
            with pytest.raises(NativePolicyStopped):
                await scheduler.create_run(
                    CreateRunRequest(
                        composition={"layers": []},
                        execution_mode="builder_test",
                        native_test_ref=REF,
                        native_parent_node={
                            "ref": REF,
                            "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                            "input_result_ref": "input",
                            "input_digest": "b" * 64,
                        },
                        native_test_protocol_version=1,
                    )
                )
            assert failed_reasons == ["approval_revoked"]

    asyncio.run(exercise())


def test_continuation_cannot_relabel_pending_approval_as_external_result():
    checkpoint = continuation().capture_wait(NativeApprovalSuspended(pending()))
    with pytest.raises(NativePolicyStopped):
        validate_deferred_results(checkpoint, DeferredToolResults(calls={"call-1": {"ok": True}}))


def test_duplicate_before_start_cas_does_not_block_unrelated_admission_or_shutdown():
    """Local scheduling race only; Redis CAS atomicity remains a separate CI test."""
    from dify_agent.protocol.native_testing import ContinuationClaim, ContinueRunRequest, NativeTestCapabilities
    from dify_agent.runtime.event_sink import RunFinalizationResult
    from dify_agent.runtime.native_continuation import PreparedContinuation
    from dify_agent.runtime.run_scheduler import RunScheduler
    from dify_agent.server.schemas import RunRecord

    async def exercise():
        checkpoint = continuation().capture_wait(NativeApprovalSuspended(pending()))
        claim = ContinuationClaim(run_id="run-1", generation=1, idempotency_key="continue-1", claim_id="claim-1")
        before_cas = asyncio.Event()
        release_cas = asyncio.Event()
        native_started = asyncio.Event()
        native_cleanup = asyncio.Event()
        release_execution = asyncio.Event()
        ordinary_finished = asyncio.Event()
        executions = []

        class Store:
            started = False

            async def get_checkpoint(self, run_id):
                return checkpoint

            async def claim_continuation(self, **kwargs):
                return claim

            async def get_run(self, run_id):
                return RunRecord(
                    run_id=run_id, status="running" if self.started else "waiting", native_dispatch_started=self.started
                )

            async def start_continuation(self, incoming):
                assert incoming == claim
                before_cas.set()
                await release_cas.wait()
                if self.started:
                    return False
                self.started = True
                return True

            async def create_run(self, *, identity=None):
                return RunRecord(run_id="ordinary-1", status="running")

            async def wait_for_cancellation(self, run_id):
                await asyncio.Event().wait()

            async def get_cancellation_intent(self, run_id):
                return None

            async def finalize_run(self, event):
                return RunFinalizationResult(applied=True, status="failed")

        class Owner:
            capabilities = NativeTestCapabilities(
                protocol_version=1,
                features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"},
            )

            async def restore(self, *, checkpoint):
                request = CreateRunRequest(
                    composition={"layers": []},
                    execution_mode="builder_test",
                    native_test_ref=REF,
                    native_parent_node={
                        "ref": REF,
                        "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
                        "input_result_ref": "input",
                        "input_digest": "b" * 64,
                    },
                    native_test_protocol_version=1,
                    session_snapshot=checkpoint.session_snapshot,
                )
                return PreparedContinuation(
                    request=request,
                    continuation=continuation(),
                    deferred_tool_results=DeferredToolResults(approvals={"call-1": ToolApproved()}),
                )

        class Runner:
            terminal_session_snapshot = None
            terminal_usage = None

            def __init__(self, run_id):
                self.run_id = run_id

            async def run(self):
                executions.append(self.run_id)
                if self.run_id == "ordinary-1":
                    ordinary_finished.set()
                    return
                native_started.set()
                try:
                    await release_execution.wait()
                finally:
                    native_cleanup.set()

        async with httpx.AsyncClient() as client:
            scheduler = RunScheduler(
                store=Store(),
                services=Services(client, client),
                native_owner=Owner(),
                shutdown_grace_seconds=0,
                runner_factory=lambda record, request: Runner(record.run_id),
            )
            request = ContinueRunRequest(ref=REF, expected_generation=0, idempotency_key="continue-1")
            try:
                assert await scheduler.continue_run("run-1", request) == claim
                await asyncio.wait_for(before_cas.wait(), timeout=1)
                # The same local claim must be acknowledged while CAS is paused.
                assert await asyncio.wait_for(scheduler.continue_run("run-1", request), timeout=0.5) == claim
                assert not native_started.is_set()
                ordinary = await asyncio.wait_for(
                    scheduler.create_run(CreateRunRequest(composition={"layers": []})), timeout=0.5
                )
                assert ordinary.run_id == "ordinary-1"
                await asyncio.wait_for(ordinary_finished.wait(), timeout=0.5)
                release_cas.set()
                await asyncio.wait_for(native_started.wait(), timeout=0.5)
                assert not release_execution.is_set()
                assert await asyncio.wait_for(scheduler.continue_run("run-1", request), timeout=0.5) == claim
                await asyncio.wait_for(scheduler.shutdown(), timeout=0.5)
                assert native_cleanup.is_set()
                assert executions.count("run-1") == 1
                assert executions.count("ordinary-1") == 1
                assert scheduler.active_tasks == {}
            finally:
                release_cas.set()
                release_execution.set()
                await scheduler.shutdown()

    asyncio.run(exercise())


def test_private_protocol_move_preserves_runtime_capture_and_wire_contract():
    from dify_agent.protocol.native_continuation import AgentCheckpoint as WireCheckpoint

    state = continuation()
    cp = state.capture_wait(NativeApprovalSuspended(pending("configuration", "bootstrap")))
    decoded = WireCheckpoint.model_validate_json(cp.model_dump_json())
    assert isinstance(cp, WireCheckpoint)
    assert decoded.run_id == "run-1"
    assert decoded.ref == REF
    assert decoded.generation == 0
    assert decoded.config_ref == "protected-config-1"
    assert decoded.pending_calls[0].wait_reason == "configuration"
    assert decoded.pending_calls[0].intent.key.cursor == 0
    assert decoded.history == []

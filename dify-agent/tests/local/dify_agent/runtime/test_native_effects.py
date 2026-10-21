"""Effect dispatch and real SDK deferral; providers remain controlled fixtures."""

import asyncio
import importlib
import importlib.util

import pytest

from dify_agent.protocol.native_testing import (
    AgentApprovalWait,
    AgentDispatchPermit,
    AgentEffectIntent,
    AgentNativeTestRef,
    AgentOperationKey,
    AgentPolicyStop,
    AgentRecordedResult,
)
from dify_agent.runtime.native_continuation import NativeApprovalSuspended, NativePolicyStopped
from tests.local.dify_agent.runtime.native_test_entities import run_context

REF = AgentNativeTestRef(
    policy_version="builder-native-test-v1", request_id="request", invocation_id="invocation", context_digest="a" * 64
)
INTENT = AgentEffectIntent(
    key=AgentOperationKey(invocation_id="invocation", occurrence_path=("tool", "call"), cursor=0),
    kind="tool",
    resource_ref="resource",
    implementation_revision="revision",
    account_ref=None,
    target={"provider": "test/action"},
    parameters={"values": [True, 3, {"reference": "file"}]},
    input_digest="b" * 64,
    capability_digest="c" * 64,
)
PERMIT = AgentDispatchPermit(
    permit_id="permit", attempt_id="attempt", operation_id="operation", expires_at="2030-01-01T00:00:00Z"
)


def implementation():
    assert importlib.util.find_spec("dify_agent.runtime.native_effects") is not None, (
        "Actual native effect dispatcher is missing"
    )
    return importlib.import_module("dify_agent.runtime.native_effects")


class Policy:
    def __init__(self, decision):
        self.decision = decision
        self.intents = []
        self.outcomes = []

    async def before_call(self, *, ref, intent):
        self.intents.append((ref, intent))
        return self.decision

    async def record_outcome(self, *, permit, outcome, result_ref):
        self.outcomes.append((permit, outcome, result_ref))


class Results:
    def __init__(self):
        self.values = {"recorded": {"ok": True}}

    async def store(self, *, ref, key, result):
        self.values["saved"] = result
        return "saved"

    async def load(self, result_ref):
        return self.values[result_ref]


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_waiting_preserves_typed_payload_and_never_invokes(reason):
    async def exercise():
        policy = Policy(AgentApprovalWait(pending_operation_id="pending", wait_reason=reason))
        calls = []

        async def invoke(permit):
            calls.append(permit)
            return {"ok": True}

        dispatcher = implementation().NativeEffectDispatcher(policy=policy)
        with pytest.raises(NativeApprovalSuspended) as caught:
            await dispatcher.dispatch(
                ref=REF,
                intent=INTENT,
                invoke=invoke,
                result_store=Results(),
                call_id="call",
                tool_name="test",
                stage="eager",
            )
        assert caught.value.pending.intent == INTENT
        assert caught.value.wait_reason == reason
        assert calls == []
        assert policy.outcomes == []

    asyncio.run(exercise())


def test_recorded_result_and_denial_never_invoke():
    async def exercise():
        async def invoke(permit):
            pytest.fail("recorded/denied effect was invoked")

        for decision in [
            AgentRecordedResult(operation_id="operation", result_ref="recorded"),
            AgentPolicyStop(reason_code="denied"),
        ]:
            dispatcher = implementation().NativeEffectDispatcher(policy=Policy(decision))
            kwargs = {
                "ref": REF,
                "intent": INTENT,
                "invoke": invoke,
                "result_store": Results(),
                "call_id": "call",
                "tool_name": "test",
                "stage": "eager",
            }
            if isinstance(decision, AgentPolicyStop):
                with pytest.raises(NativePolicyStopped, match="denied"):
                    await dispatcher.dispatch(**kwargs)
            else:
                assert await dispatcher.dispatch(**kwargs) == {"ok": True}

    asyncio.run(exercise())


def test_success_stores_protected_result_before_receipt():
    async def exercise():
        policy, results = Policy(PERMIT), Results()

        async def invoke(permit):
            assert permit == PERMIT
            return {"values": [True, 3]}

        value = (
            await implementation()
            .NativeEffectDispatcher(policy=policy)
            .dispatch(
                ref=REF,
                intent=INTENT,
                invoke=invoke,
                result_store=results,
                call_id="call",
                tool_name="test",
                stage="eager",
            )
        )
        assert value == results.values["saved"] == {"values": [True, 3]}
        assert policy.outcomes == [(PERMIT, "completed", "saved")]

    asyncio.run(exercise())


def test_ambiguous_io_closes_as_unknown_without_retry():
    async def exercise():
        policy = Policy(PERMIT)
        calls = []

        async def invoke(permit):
            calls.append(permit)
            raise TimeoutError("lost response")

        with pytest.raises(TimeoutError):
            await (
                implementation()
                .NativeEffectDispatcher(policy=policy)
                .dispatch(
                    ref=REF,
                    intent=INTENT,
                    invoke=invoke,
                    result_store=Results(),
                    call_id="call",
                    tool_name="test",
                    stage="eager",
                )
            )
        assert calls == [PERMIT]
        assert policy.outcomes == [(PERMIT, "unknown", None)]

    asyncio.run(exercise())


def test_opaque_call_discloses_uncertainty():
    assert implementation().opaque_invocation_disclosure(
        kind="plugin", target="provider/action", capability_scope="mailbox:test"
    ) == {
        "kind": "plugin",
        "target": "provider/action",
        "authorization_granularity": "single_bounded_invocation",
        "internal_effects": "opaque",
        "capability_scope": "mailbox:test",
    }


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_real_sdk_pre_tool_boundary_checkpoints_wait_before_handler(reason):
    async def exercise():
        import httpx
        from pydantic_ai import Agent, DeferredToolRequests
        from pydantic_ai.messages import ModelResponse, ToolCallPart
        from pydantic_ai.models.function import FunctionModel

        from dify_agent.runtime.context import Deps, Services
        from dify_agent.runtime.native_continuation import NativeContinuation

        module = implementation()
        assert hasattr(module, "NativeEffectsCapability"), "Real SDK effect capability is missing"
        policy = Policy(AgentApprovalWait(pending_operation_id="pending", wait_reason=reason))
        continuation = NativeContinuation(
            run_id="run", ref=REF, generation=0, config_ref="config", config_digest="d" * 64
        )

        async def prepare(**kwargs):
            return INTENT.model_copy(
                update={"key": kwargs["key"], "target": kwargs["target"], "parameters": kwargs["parameters"]}
            )

        session = module.NativeEffectSession(
            continuation=continuation,
            dispatcher=module.NativeEffectDispatcher(policy=policy),
            result_store=Results(),
            prepare_intent=prepare,
        )
        capability = module.NativeEffectsCapability(session)
        calls = []
        async with httpx.AsyncClient() as client:
            deps = Deps(layers={}, services=Services(client, client), run_id="run")
            agent = Agent(
                FunctionModel(
                    lambda messages, info: ModelResponse(
                        parts=[ToolCallPart("write", {"values": [True, 3]}, tool_call_id="call")]
                    )
                ),
                output_type=[str, DeferredToolRequests],
                capabilities=[capability],
            )

            async def arguments(args):
                return {"hidden": "bound", **args}

            @agent.tool_plain(
                metadata={
                    "native_effect": module.NativeToolBoundary(
                        boundary="tool", target={"provider": "test/action"}, prepare_arguments=arguments
                    )
                }
            )
            def write(values: list):
                calls.append(values)
                return "done"

            result = await agent.run("do it", deps=deps)
            checkpoint = continuation.capture(result=result, deps=deps)
        assert calls == []
        assert checkpoint.pending_calls[0].wait_reason == reason
        assert checkpoint.pending_calls[0].intent.parameters == {"hidden": "bound", "values": [True, 3]}
        assert len(policy.intents) == 1

    asyncio.run(exercise())


@pytest.mark.parametrize("family", ["direct_plugin", "core_tool"])
@pytest.mark.parametrize("file_kind", ["string", "file"])
@pytest.mark.parametrize("permit_available", [False, True])
def test_actual_tool_layer_defers_with_final_arguments_before_transport(family, file_kind, permit_available):
    async def exercise():
        import httpx
        from pydantic_ai import Agent, DeferredToolRequests
        from pydantic_ai.messages import ModelResponse, ToolCallPart
        from pydantic_ai.models.function import FunctionModel

        from dify_agent.layers.dify_core_tools.layer import Toolset as CoreTools
        from dify_agent.layers.dify_plugin.tools_layer import Toolset as PluginTools
        from dify_agent.runtime.context import Deps, Services
        from dify_agent.runtime.native_continuation import NativeContinuation

        module = implementation()
        transport_calls = []

        def transport(request):
            transport_calls.append(request)
            return httpx.Response(500)

        policy = Policy(PERMIT if permit_available else AgentApprovalWait(pending_operation_id="pending"))
        state = NativeContinuation(run_id="run", ref=REF, generation=0, config_ref="config", config_digest="d" * 64)

        async def prepare(**kwargs):
            return INTENT.model_copy(
                update={"key": kwargs["key"], "target": kwargs["target"], "parameters": kwargs["parameters"]}
            )

        session = module.NativeEffectSession(
            continuation=state,
            dispatcher=module.NativeEffectDispatcher(policy=policy),
            result_store=Results(),
            prepare_intent=prepare,
        )
        tool = {
            "tool_name": "write",
            "runtime_parameters": {"hidden": "bound"},
            "parameters": [
                {"name": "enabled", "type": "boolean", "form": "llm", "default": True},
                {"name": "file", "type": file_kind, "form": "llm"},
            ],
            "parameters_json_schema": {"type": "object", "properties": {"file": {"type": "string"}}},
        }
        tool.update(
            {"plugin_id": "test/plugin", "provider": "provider", "credential_type": "unauthorized"}
            if family == "direct_plugin"
            else {"provider_type": "api", "provider_id": "provider"}
        )
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            deps = Deps(
                layers={
                    "execution_context": {
                        "config": {
                            "agent_mode": "workflow_run",
                            "tenant_id": "tenant",
                            "user_id": "user",
                            "user_from": "account",
                            "app_id": "app",
                            "invoke_from": "debugger",
                        },
                        "state": {},
                    },
                    "tools": {"config": {"tools": [tool]}, "state": {}},
                },
                services=Services(client, client),
                run_id="run",
            )
            agent = Agent(
                FunctionModel(
                    lambda messages, info: ModelResponse(
                        parts=[ToolCallPart("write", {"file": "/workspace/input.csv"}, tool_call_id="call")]
                    )
                ),
                toolsets=[PluginTools("tools") if family == "direct_plugin" else CoreTools("tools")],
                capabilities=[module.NativeEffectsCapability(session)],
                output_type=[str, DeferredToolRequests],
            )
            if file_kind == "file":
                with pytest.raises(NativePolicyStopped, match="native_file_dependency_unavailable"):
                    await agent.run("write", deps=deps)
                assert transport_calls == []
                assert policy.intents == []
                return
            if permit_available:
                with pytest.raises(NativePolicyStopped, match="native_dispatch_fence_unavailable"):
                    await agent.run("write", deps=deps)
                assert transport_calls == []
                assert len(policy.intents) == 1
                return
            result = await agent.run("write", deps=deps)
            checkpoint = state.capture(result=result, deps=deps)
        assert transport_calls == []
        assert checkpoint.pending_calls[0].intent.parameters == {
            "hidden": "bound",
            "enabled": True,
            "file": "/workspace/input.csv",
        }

    asyncio.run(exercise())


def test_sdk_permit_is_spent_once_and_result_can_replay_without_handler():
    async def exercise():
        import httpx
        from pydantic_ai import Agent, DeferredToolRequests
        from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
        from pydantic_ai.models.function import FunctionModel

        from dify_agent.runtime.context import Deps, Services
        from dify_agent.runtime.native_continuation import NativeContinuation

        module = implementation()
        calls = []
        policy, results = Policy(PERMIT), Results()

        async def prepare(**kwargs):
            return INTENT.model_copy(
                update={"key": kwargs["key"], "target": kwargs["target"], "parameters": kwargs["parameters"]}
            )

        async def arguments(args):
            return args

        def model(messages, info):
            return (
                ModelResponse(parts=[TextPart("done")])
                if any(isinstance(p, ToolReturnPart) for m in messages for p in m.parts)
                else ModelResponse(parts=[ToolCallPart("write", {"enabled": True}, tool_call_id="call")])
            )

        async with httpx.AsyncClient() as client:
            for replay in [False, True]:
                state = NativeContinuation(
                    run_id="run", ref=REF, generation=0, config_ref="config", config_digest="d" * 64
                )
                session = module.NativeEffectSession(
                    continuation=state,
                    dispatcher=module.NativeEffectDispatcher(policy=policy),
                    result_store=results,
                    prepare_intent=prepare,
                )
                if replay:
                    policy.decision = AgentRecordedResult(operation_id="operation", result_ref="saved")
                agent = Agent(
                    FunctionModel(model),
                    output_type=[str, DeferredToolRequests],
                    capabilities=[module.NativeEffectsCapability(session)],
                )

                @agent.tool_plain(
                    metadata={"native_effect": module.NativeToolBoundary("tool", {"provider": "test"}, arguments)}
                )
                def write(enabled: bool):
                    calls.append(enabled)
                    return {"done": enabled}

                result = await agent.run("write", deps=Deps(layers={}, services=Services(client, client), run_id="run"))
                assert result.output == "done"
        assert calls == [True]
        assert len(policy.intents) == 2
        assert policy.outcomes == [(PERMIT, "completed", "saved")]

    asyncio.run(exercise())


def waiting_session():
    from dify_agent.runtime.native_continuation import NativeContinuation

    module = implementation()
    policy = Policy(AgentApprovalWait(pending_operation_id="pending"))

    async def prepare(**kwargs):
        return INTENT.model_copy(
            update={"key": kwargs["key"], "target": kwargs["target"], "parameters": kwargs["parameters"]}
        )

    async def fixture_lineage(**kwargs):
        return None

    return module.NativeEffectSession(
        continuation=NativeContinuation(
            run_id="run", ref=REF, generation=0, config_ref="config", config_digest="d" * 64
        ),
        dispatcher=module.NativeEffectDispatcher(policy=policy),
        result_store=Results(),
        prepare_intent=prepare,
        validate_shell_lineage=fixture_lineage,
    )


def test_eager_knowledge_waits_before_http_and_cache_write():
    async def exercise():
        import httpx

        from dify_agent.layers.knowledge.layer import _KnowledgeOperations
        from tests.local.dify_agent.layers.knowledge.test_layer import config, deps_for

        calls = []

        def transport(request):
            calls.append(request)
            return httpx.Response(200, json={"results": [], "usage": {}})

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            deps = deps_for(client, config(eager=True))
            deps.native_effects = waiting_session()
            with pytest.raises(NativeApprovalSuspended):
                await _KnowledgeOperations("knowledge", deps)._refresh_eager_results_if_needed()
        assert calls == []
        assert deps.layers["knowledge"]["state"]["eager_results"] == []

    asyncio.run(exercise())


def test_config_pull_waits_before_shell_io(monkeypatch):
    async def exercise():
        from dify_agent.adapters.shell.protocols import CompleteShellCommandResult
        from dify_agent.layers.config.layer import Config, State, _ConfigContext

        calls = []

        async def run(self, script, **kwargs):
            calls.append(script)
            return CompleteShellCommandResult("pull", "exited", True, 0, "{}", True, None, 2)

        from dify_agent.layers.shell.layer import DifyShellLayerConfig, ShellSession
        from dify_agent.layers.shell.layer import State as ShellState
        from tests.local.dify_agent.module_support import deps_for

        deps = deps_for("shell", DifyShellLayerConfig(), ShellState().model_dump(mode="json"))
        deps.native_effects = waiting_session()
        shell = ShellSession("shell", deps)
        monkeypatch.setattr(ShellSession, "run_remote_script", run)
        context = _ConfigContext(Config(), State(), shell)
        with pytest.raises(NativeApprovalSuspended):
            await context._run_mentioned_pull(script="dify-agent config files pull --json file", target_kind="file")
        assert calls == []

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "name,arguments",
    [
        ("shell_run", {"script": "printf fixture"}),
        ("shell_input", {"job_id": "job", "text": "answer\n"}),
        ("shell_wait", {"job_id": "job"}),
        ("shell_interrupt", {"job_id": "job"}),
    ],
)
def test_shell_native_tool_waits_before_session_access(name, arguments):
    async def exercise():
        import httpx
        from pydantic_ai import Agent, DeferredToolRequests
        from pydantic_ai.messages import ModelResponse, ToolCallPart
        from pydantic_ai.models.function import FunctionModel

        from dify_agent.layers.shell.layer import Capability
        from dify_agent.runtime.context import Deps, Services

        session = waiting_session()
        async with httpx.AsyncClient() as client:
            deps = Deps(layers={}, services=Services(client, client), run_id="run")
            agent = Agent(
                FunctionModel(
                    lambda messages, info: ModelResponse(parts=[ToolCallPart(name, arguments, tool_call_id="call")])
                ),
                toolsets=[Capability("shell").get_toolset()],
                capabilities=[implementation().NativeEffectsCapability(session)],
                output_type=[str, DeferredToolRequests],
            )
            result = await agent.run("do it", deps=deps)
            checkpoint = session.continuation.capture(result=result, deps=deps)
        assert checkpoint.pending_calls[0].tool_name == name
        assert checkpoint.pending_calls[0].intent.parameters.items() >= arguments.items()

    asyncio.run(exercise())


def test_bootstrap_waits_before_runtime_resource_access():
    async def exercise():
        import httpx

        from dify_agent.layers.shell.layer import Capability, State
        from dify_agent.runtime.context import Deps, Services

        async with httpx.AsyncClient() as client:
            deps = Deps(
                layers={
                    "shell": {
                        "config": {"cli_tools": [{"install_commands": ["printf fixture"]}]},
                        "state": State().model_dump(mode="json"),
                    }
                },
                services=Services(client, client),
                run_id="run",
                native_effects=waiting_session(),
            )

            async def handler():
                pytest.fail("run entered before bootstrap approval")

            with pytest.raises(NativeApprovalSuspended):
                await Capability("shell").wrap_run(run_context(deps), handler=handler)
        assert deps.layers["shell"]["state"]["initialized"] is False

    asyncio.run(exercise())


def test_actual_model_client_waits_before_http():
    async def exercise():
        import httpx

        from dify_agent.adapters.llm.provider import DifyApiLLMClient
        from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig

        assert "native_effects" in DifyApiLLMClient.__dataclass_fields__, "Model transport has no native gate"
        calls = []

        def transport(request):
            calls.append(request)
            return httpx.Response(500)

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
            client = DifyApiLLMClient(
                plugin_id="plugin",
                inner_api_url="http://api",
                inner_api_key="",
                execution_context=DifyExecutionContextLayerConfig(
                    tenant_id="tenant",
                    user_id="user",
                    user_from="account",
                    app_id="app",
                    agent_mode="workflow_run",
                    invoke_from="debugger",
                ),
                agent_run_id="run",
                http_client=http,
                native_effects=waiting_session(),
            )
            with pytest.raises(NativeApprovalSuspended):
                _ = [
                    chunk
                    async for chunk in client.iter_llm_result_chunks(
                        provider="provider",
                        model="model",
                        prompt_messages=[],
                        model_parameters={"temperature": 0.1},
                        tools=None,
                        stop=None,
                        stream=True,
                    )
                ]
        assert calls == []

    asyncio.run(exercise())


def test_marked_runner_requires_real_effect_owner_before_loading(monkeypatch):
    async def exercise():
        import httpx

        import dify_agent.runtime.runner as runner_module
        from dify_agent.protocol.native_testing import NativeTestCapabilities, NativeTestProtocolUnsupported
        from dify_agent.protocol.schemas import CreateRunRequest
        from dify_agent.runtime.context import Services
        from dify_agent.runtime.event_sink import InMemoryRunEventSink
        from dify_agent.runtime.native_continuation import NativeContinuation

        calls = []

        def load(*args, **kwargs):
            calls.append("loaded")
            raise AssertionError("modules loaded without actual policy owner")

        monkeypatch.setattr(runner_module, "load_modules", load)
        async with httpx.AsyncClient() as client:
            runner = runner_module.AgentRunRunner(
                sink=InMemoryRunEventSink(),
                run_id="run",
                services=Services(client, client),
                request=CreateRunRequest(
                    composition={"layers": []},
                    execution_mode="builder_test",
                    native_test_ref=REF,
                    native_parent_node=dict(
                        ref=REF,
                        execution_id="4c959aea-9025-4db9-9361-eed1191c11c7",
                        input_result_ref="input",
                        input_digest="b" * 64,
                    ),
                    native_test_protocol_version=1,
                ),
                native_continuation=NativeContinuation(
                    run_id="run", ref=REF, generation=0, config_ref="config", config_digest="d" * 64
                ),
                native_capabilities=NativeTestCapabilities(
                    protocol_version=1,
                    features={"pending-call-v1", "policy-gate-v1", "test-scope-v1", "child-continuation-v1"},
                ),
            )
            with pytest.raises(NativeTestProtocolUnsupported):
                await runner.run()
        assert calls == []

    asyncio.run(exercise())


@pytest.mark.parametrize("claim_allowed", [True, False])
def test_actual_direct_plugin_claim_precedes_one_daemon_request(claim_allowed):
    async def exercise():
        import json

        import httpx
        from pydantic_ai import Agent
        from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart
        from pydantic_ai.models.function import FunctionModel

        from dify_agent.adapters.native_testing.client import AgentPolicyTransportUnavailable, HttpAgentPolicyClient
        from dify_agent.layers.dify_plugin.tools_layer import Toolset
        from dify_agent.runtime.context import Deps, Services
        from tests.local.dify_agent.layers.dify_plugin.test_layers import identity

        events = []

        def transport(request):
            path = request.url.path.rsplit("/", 1)[-1]
            payload = json.loads(request.content)
            events.append(path)
            if path == "before-call":
                return httpx.Response(200, json=PERMIT.model_dump(mode="json"))
            if path == "materialize":
                assert payload["permit"] == PERMIT.model_dump(mode="json")
                return httpx.Response(
                    200,
                    json={"credential_type": "api-key", "credentials": {"token": "fixture"}, "runtime_parameters": {}},
                )
            if path == "claim-dispatch":
                return httpx.Response(200, json={"claimed": True}) if claim_allowed else httpx.Response(409)
            if path == "outcome":
                return httpx.Response(
                    200,
                    json={
                        "operation_id": "operation",
                        "attempt_id": "attempt",
                        "outcome": payload["outcome"],
                        "result_ref": payload["result_ref"],
                    },
                )
            assert path == "invoke" and events[-2] == "claim-dispatch"
            assert payload["data"]["credentials"] == {"token": "fixture"}
            assert payload["data"]["tool_parameters"] == {"enabled": True}
            return httpx.Response(
                200, text='data: {"code":0,"message":"ok","data":{"type":"text","message":{"text":"done"}}}\n'
            )

        def model(messages, info):
            return (
                ModelResponse(parts=[TextPart("done")])
                if any(isinstance(p, ToolReturnPart) for m in messages for p in m.parts)
                else ModelResponse(parts=[ToolCallPart("write", {"enabled": True}, tool_call_id="call")])
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            session = waiting_session()
            session.dispatcher.policy = HttpAgentPolicyClient(
                base_url="http://api", api_key="fixture", http_client=client, ref=REF
            )
            deps = Deps(
                layers={
                    "execution_context": {"config": identity().model_dump(mode="json"), "state": {}},
                    "tools": {
                        "config": {
                            "tools": [
                                {
                                    "plugin_id": "test/plugin",
                                    "provider": "provider",
                                    "tool_name": "write",
                                    "credential_type": "unauthorized",
                                    "parameters_json_schema": {
                                        "type": "object",
                                        "properties": {"enabled": {"type": "boolean"}},
                                    },
                                }
                            ]
                        },
                        "state": {},
                    },
                },
                services=Services(client, client),
                run_id="run",
            )
            agent = Agent(
                FunctionModel(model),
                toolsets=[Toolset("tools")],
                capabilities=[implementation().NativeEffectsCapability(session)],
            )
            if claim_allowed:
                await agent.run("write", deps=deps)
            else:
                with pytest.raises(AgentPolicyTransportUnavailable):
                    await agent.run("write", deps=deps)
        assert events == (
            ["before-call", "materialize", "claim-dispatch", "invoke", "outcome"]
            if claim_allowed
            else ["before-call", "materialize", "claim-dispatch", "outcome"]
        )

    asyncio.run(exercise())


def test_private_policy_http_preserves_discriminants_and_typed_arguments():
    async def exercise():
        import json

        import httpx

        assert importlib.util.find_spec("dify_agent.adapters.native_testing") is not None, (
            "Private policy adapter is missing"
        )
        from dify_agent.adapters.native_testing.client import HttpAgentPolicyClient

        requests = []

        def transport(request):
            requests.append(json.loads(request.content))
            return httpx.Response(
                200, json={"kind": "waiting", "pending_operation_id": "pending", "wait_reason": "configuration"}
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
            client = HttpAgentPolicyClient(base_url="http://api", api_key="service", http_client=http)
            decision = await client.before_call(ref=REF, intent=INTENT)
        assert decision == AgentApprovalWait(pending_operation_id="pending", wait_reason="configuration")
        assert requests == [{"ref": REF.model_dump(mode="json"), "intent": INTENT.model_dump(mode="json")}]

    asyncio.run(exercise())


def test_missing_shell_lineage_stops_before_effect_reservation():
    async def exercise():
        session = waiting_session()
        session.validate_shell_lineage = None
        with pytest.raises(NativePolicyStopped, match="native_shell_lineage_unavailable"):
            await session.intent(
                boundary="shell_run", call_id="call", target={"shell": "shell"}, parameters={"script": "printf fixture"}
            )
        assert session.dispatcher.policy.intents == []

    asyncio.run(exercise())


_TYPED_JSON_CASES = [
    pytest.param({"nested": {"flag": True}}, {"nested": {"flag": 1}}, False, id="nested-true-integer"),
    pytest.param({"items": [{"flag": False}]}, {"items": [{"flag": 0}]}, False, id="array-false-integer"),
    pytest.param({"items": [1]}, {"items": [1.0]}, False, id="integer-float"),
    pytest.param({"items": [-0.0]}, {"items": [0.0]}, False, id="signed-zero"),
    pytest.param(
        {"z": [True, 1.0], "a": {"b": 2, "a": 1}}, {"a": {"a": 1, "b": 2}, "z": [True, 1.0]}, True, id="key-order"
    ),
]


@pytest.mark.parametrize("field", ["target", "parameters"])
@pytest.mark.parametrize(("approved", "actual", "matches"), _TYPED_JSON_CASES)
def test_session_typed_json_guard_precedes_authorization_and_dispatch(field, approved, actual, matches):
    async def exercise():
        session = waiting_session()
        session.dispatcher.policy.decision = PERMIT
        calls = []

        async def prepare(**kwargs):
            return INTENT.model_copy(
                update={
                    "key": kwargs["key"],
                    "target": kwargs["target"],
                    "parameters": kwargs["parameters"],
                    field: approved,
                }
            )

        async def invoke(_permit):
            calls.append("dispatch")
            return {"done": True}

        session.prepare_intent = prepare
        kwargs = {"target": INTENT.target, "parameters": INTENT.parameters, field: actual}
        if matches:
            assert await session.stage(boundary="tool", call_id="call", stage="tool", invoke=invoke, **kwargs) == {
                "done": True
            }
            assert calls == ["dispatch"]
            assert len(session.dispatcher.policy.intents) == 1
        else:
            with pytest.raises(NativePolicyStopped, match="native_effect_arguments_changed"):
                await session.stage(boundary="tool", call_id="call", stage="tool", invoke=invoke, **kwargs)
            assert calls == []
            assert session.dispatcher.policy.intents == []

    asyncio.run(exercise())


@pytest.mark.parametrize(("approved", "actual", "matches"), _TYPED_JSON_CASES)
def test_direct_plugin_typed_json_guard_precedes_materialize_claim_and_dispatch(approved, actual, matches):
    asyncio.run(_exercise_direct_plugin_json_guard(approved, actual, matches))


def test_direct_plugin_target_guard_precedes_materialize_claim_and_dispatch():
    asyncio.run(_exercise_direct_plugin_json_guard({}, {}, False, changed_target=True))


async def _exercise_direct_plugin_json_guard(approved, actual, matches, *, changed_target=False):
    import httpx

    from dify_agent.adapters.native_testing.client import HttpAgentPolicyClient
    from dify_agent.layers.dify_plugin.configs import DifyPluginToolConfig
    from dify_agent.layers.dify_plugin.tool_client import DifyPluginDaemonToolClient
    from dify_agent.layers.dify_plugin.tools_layer import _build_pydantic_ai_tool

    module = implementation()
    events = []

    def transport(request):
        path = request.url.path.rsplit("/", 1)[-1]
        events.append(path)
        if path == "materialize":
            return httpx.Response(
                200, json={"credential_type": "unauthorized", "credentials": {}, "runtime_parameters": {}}
            )
        if path == "claim-dispatch":
            return httpx.Response(200, json={"claimed": True})
        assert path == "invoke"
        return httpx.Response(
            200, text='data: {"code":0,"message":"ok","data":{"type":"text","message":{"text":"done"}}}\n'
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        session = waiting_session()
        session.dispatcher.policy = HttpAgentPolicyClient(
            base_url="http://api", api_key="fixture", http_client=client, ref=REF
        )
        config = DifyPluginToolConfig(
            plugin_id="test/plugin", provider="provider", tool_name="write", credential_type="unauthorized"
        )
        tool = _build_pydantic_ai_tool(
            client=DifyPluginDaemonToolClient("http://daemon", "fixture", "tenant", "test/plugin", "actor", client),
            tool_config=config,
            effective_parameters=[],
            file_context=None,
        )
        # Reversed target key order is equivalent; a different actual tool is not.
        target = {
            "tool_name": "other" if changed_target else "write",
            "provider": "provider",
            "plugin_id": "test/plugin",
        }
        effect = INTENT.model_copy(update={"target": target, "parameters": approved})
        token = module._dispatch.set(module.NativeDispatchEnvelope(REF, effect, PERMIT))
        try:
            from dify_agent.runtime.context import Deps, Services

            ctx = run_context(Deps(layers={}, services=Services(client, client), run_id="run", native_effects=session))
            if matches:
                assert await tool.function(ctx, **actual) == "done"
                assert events == ["materialize", "claim-dispatch", "invoke"]
            else:
                with pytest.raises(NativePolicyStopped, match="native_effect_arguments_changed"):
                    await tool.function(ctx, **actual)
                assert events == []
        finally:
            module._dispatch.reset(token)

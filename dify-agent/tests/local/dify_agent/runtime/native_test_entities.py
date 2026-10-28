"""Concrete SDK contexts and native runtime entities for focused boundary tests."""

from typing import Literal, Never

from pydantic_ai import RunContext
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from dify_agent.adapters.native_testing.client import HttpAgentPolicyClient
from dify_agent.adapters.shell.protocols import ShellCommandProtocol
from dify_agent.adapters.shell.shellctl import ShellctlCommands, create_default_shellctl_client_factory
from dify_agent.protocol.native_testing import AgentNativeTestRef
from dify_agent.runtime.confirmed_continuation import _APIResultStore
from dify_agent.runtime.context import Deps
from dify_agent.runtime.native_continuation import NativeContinuation
from dify_agent.runtime.native_effects import NativeEffectDispatcher, NativeEffectSession
from dify_agent.runtime_backend.native_test_scope import NativeScopeLease
from dify_agent.runtime_backend.protocols import RuntimeLayout


def run_context(deps: Deps) -> RunContext[Deps]:
    return RunContext(deps=deps, model=TestModel(), usage=RunUsage())


def native_effects(deps: Deps, *, profile: Literal["isolated", "confirmed"] = "isolated") -> NativeEffectSession:
    ref = AgentNativeTestRef(
        policy_version="builder-native-test-v1", request_id="request", invocation_id="inv", context_digest="a" * 64
    )
    continuation = NativeContinuation(
        run_id="run", ref=ref, generation=0, config_ref="config", config_digest="b" * 64, native_test_profile=profile
    )
    client = HttpAgentPolicyClient(
        base_url="http://api.invalid", api_key="test", http_client=deps.services.dify_api_http_client, ref=ref
    )

    async def forbidden_intent(**_kwargs: object) -> Never:
        raise AssertionError("Unexpected native intent preparation")

    return NativeEffectSession(
        continuation=continuation,
        dispatcher=NativeEffectDispatcher(policy=client),
        result_store=_APIResultStore(client=client, ref=ref),
        prepare_intent=forbidden_intent,
    )


def native_lease(commands: ShellCommandProtocol | None = None, *, generation: int = 1) -> NativeScopeLease:
    client = create_default_shellctl_client_factory(entrypoint="http://runtime.invalid", token="test")()
    return NativeScopeLease(
        handle="native:binding-1:1",
        layout=RuntimeLayout(home_dir="/home/dify", workspace_dir="/workspace"),
        client=client,
        commands=commands if commands is not None else ShellctlCommands(client),
        workspace_generation=generation,
    )

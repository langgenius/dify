"""Acquire an operation lease without owning Binding or Workspace retirement."""

from typing import override

from pydantic import BaseModel, ConfigDict
from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.capabilities.abstract import WrapRunHandler
from pydantic_ai.run import AgentRunResult

from dify_agent.layers.runtime.configs import DifyRuntimeLayerConfig
from dify_agent.runtime.context import Deps
from dify_agent.runtime.native_continuation import NativePolicyStopped
from dify_agent.runtime_backend.leases import open_runtime_lease
from dify_agent.runtime_backend.native_test_scope import native_binding_identity


class Config(DifyRuntimeLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Capability(AbstractCapability[Deps]):
    def __init__(self, name: str):
        self.id = name
        self.name = name

    @override
    async def wrap_run(self, ctx: RunContext[Deps], *, handler: WrapRunHandler) -> AgentRunResult:
        config = Config.model_validate(ctx.deps.layers[self.name]["config"])
        profile = ctx.deps.services.runtime_backend_profile
        if profile is None:
            raise ValueError("Runtime module requires a configured runtime backend.")
        native = native_binding_identity(config.backend_binding_ref)
        confirmed = (
            ctx.deps.native_effects is not None
            and getattr(getattr(ctx.deps.native_effects, "continuation", None), "native_test_profile", None)
            == "confirmed"
        )
        if confirmed and native is not None:
            raise NativePolicyStopped("native_runtime_lineage_mismatch")
        if not confirmed and (native is None) != (ctx.deps.native_effects is None):
            raise NativePolicyStopped("native_runtime_lineage_mismatch")
        if ctx.deps.native_effects is not None:
            validate = ctx.deps.native_effects.validate_shell_lineage
            if validate is None:
                raise NativePolicyStopped("native_shell_lineage_unavailable")
            await validate(
                ref=ctx.deps.native_effects.continuation.ref,
                boundary="runtime_acquire",
                target={"backend_binding_ref": config.backend_binding_ref},
                parameters={},
            )
        async with open_runtime_lease(profile.execution_bindings, config.backend_binding_ref) as lease:
            ctx.deps.resources.leases[self.name] = lease
            try:
                return await handler()
            finally:
                del ctx.deps.resources.leases[self.name]

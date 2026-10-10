"""Acquire an operation lease without owning Binding or Workspace retirement."""

from pydantic import BaseModel, ConfigDict
from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.capabilities.abstract import WrapRunHandler
from pydantic_ai.run import AgentRunResult

from dify_agent.layers.runtime.configs import DifyRuntimeLayerConfig
from dify_agent.runtime.context import Deps
from dify_agent.runtime_backend.leases import open_runtime_lease


class Config(DifyRuntimeLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Capability(AbstractCapability[Deps]):
    def __init__(self, name: str):
        self.id = name
        self.name = name

    async def wrap_run(self, ctx: RunContext[Deps], *, handler: WrapRunHandler) -> AgentRunResult:
        config = Config.model_validate(ctx.deps.layers[self.name]["config"])
        profile = ctx.deps.services.runtime_backend_profile
        if profile is None:
            raise ValueError("Runtime module requires a configured runtime backend.")
        async with open_runtime_lease(profile.execution_bindings, config.backend_binding_ref) as lease:
            ctx.deps.resources.leases[self.name] = lease
            try:
                return await handler()
            finally:
                del ctx.deps.resources.leases[self.name]

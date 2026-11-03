"""Data builders for module behavior tests; no legacy runtime is emulated."""

import httpx
from pydantic import BaseModel
from dify_agent.runtime.context import Deps, Services


def deps_for(name: str, config: BaseModel | dict, state: dict | None = None) -> Deps:
    return Deps(
        layers={
            name: {
                "config": config.model_dump(mode="json") if isinstance(config, BaseModel) else config,
                "state": state or {},
            }
        },
        services=Services(httpx.AsyncClient(), httpx.AsyncClient()),
        run_id="test",
    )


async def invoke_native_tool(deps, toolset, name, arguments, *, inspect=None):
    """Exercise schema preparation, validation and invocation in the real Agent."""
    from pydantic_ai import Agent
    from pydantic_ai.messages import ModelRequest, ModelResponse, ToolReturnPart, ToolCallPart, TextPart
    from pydantic_ai.models.function import FunctionModel

    async def model(messages, info):
        if inspect is not None:
            inspect(info)
        returns = [p for m in messages if isinstance(m, ModelRequest) for p in m.parts if isinstance(p, ToolReturnPart)]
        if not returns:
            return ModelResponse(parts=[ToolCallPart(name, arguments, tool_call_id="call")])
        return ModelResponse(parts=[TextPart(str(returns[-1].content))])

    return await Agent(FunctionModel(model), deps_type=Deps, toolsets=[toolset]).run("Use the tool", deps=deps)

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolParameter, ToolProviderType
from core.tools.tool_manager import ToolManager

OUTPUT_TOOL_PROVIDER = "agent_output"

OUTPUT_TEXT_TOOL = "output_text"
FINAL_OUTPUT_TOOL = "final_output_answer"
FINAL_STRUCTURED_OUTPUT_TOOL = "final_structured_output"
ILLEGAL_OUTPUT_TOOL = "illegal_output"

OUTPUT_TOOL_NAMES: Sequence[str] = (
    OUTPUT_TEXT_TOOL,
    FINAL_OUTPUT_TOOL,
    FINAL_STRUCTURED_OUTPUT_TOOL,
    ILLEGAL_OUTPUT_TOOL,
)

OUTPUT_TOOL_NAME_SET = set(OUTPUT_TOOL_NAMES)


def select_output_tool_names(
    *,
    structured_output_enabled: bool,
    include_illegal_output: bool = False,
) -> list[str]:
    tool_names = [OUTPUT_TEXT_TOOL]
    if structured_output_enabled:
        tool_names.append(FINAL_STRUCTURED_OUTPUT_TOOL)
    else:
        tool_names.append(FINAL_OUTPUT_TOOL)
    if include_illegal_output:
        tool_names.append(ILLEGAL_OUTPUT_TOOL)
    return tool_names


def select_terminal_tool_name(*, structured_output_enabled: bool) -> str:
    return FINAL_STRUCTURED_OUTPUT_TOOL if structured_output_enabled else FINAL_OUTPUT_TOOL


def build_agent_output_tools(
    *,
    tenant_id: str,
    invoke_from: InvokeFrom,
    tool_invoke_from: ToolInvokeFrom,
    output_tool_names: Sequence[str],
    structured_output_schema: dict[str, Any] | None = None,
) -> list[Tool]:
    tools: list[Tool] = []
    tool_names: list[str] = []
    for tool_name in output_tool_names:
        if tool_name not in OUTPUT_TOOL_NAME_SET:
            raise ValueError(f"Unknown output tool name: {tool_name}")
        if tool_name not in tool_names:
            tool_names.append(tool_name)

    for tool_name in tool_names:
        tool = ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id=OUTPUT_TOOL_PROVIDER,
            tool_name=tool_name,
            tenant_id=tenant_id,
            invoke_from=invoke_from,
            tool_invoke_from=tool_invoke_from,
        )

        if tool_name == FINAL_STRUCTURED_OUTPUT_TOOL and structured_output_schema:
            tool.entity = tool.entity.model_copy(deep=True)
            for parameter in tool.entity.parameters:
                if parameter.name != "data":
                    continue
                parameter.type = ToolParameter.ToolParameterType.OBJECT
                parameter.form = ToolParameter.ToolParameterForm.LLM
                parameter.required = True
                parameter.input_schema = structured_output_schema
        tools.append(tool)

    return tools

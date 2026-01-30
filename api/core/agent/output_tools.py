from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolInvokeMessage, ToolParameter, ToolProviderType
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

TERMINAL_OUTPUT_TOOL_NAMES: Sequence[str] = (FINAL_OUTPUT_TOOL, FINAL_STRUCTURED_OUTPUT_TOOL)


TERMINAL_OUTPUT_MESSAGE = "Final output received. This ends the current session."


def is_terminal_output_tool(tool_name: str) -> bool:
    return tool_name in TERMINAL_OUTPUT_TOOL_NAMES


def get_terminal_tool_name(structured_output_enabled: bool) -> str:
    return FINAL_STRUCTURED_OUTPUT_TOOL if structured_output_enabled else FINAL_OUTPUT_TOOL


OUTPUT_TOOL_NAME_SET = set(OUTPUT_TOOL_NAMES)


def build_agent_output_tools(
    tenant_id: str,
    invoke_from: InvokeFrom,
    tool_invoke_from: ToolInvokeFrom,
    structured_output_schema: Mapping[str, Any] | None = None,
) -> list[Tool]:
    def get_tool_runtime(_tool_name: str) -> Tool:
        return ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id=OUTPUT_TOOL_PROVIDER,
            tool_name=_tool_name,
            tenant_id=tenant_id,
            invoke_from=invoke_from,
            tool_invoke_from=tool_invoke_from,
        )

    tools: list[Tool] = [
        get_tool_runtime(OUTPUT_TEXT_TOOL),
        get_tool_runtime(ILLEGAL_OUTPUT_TOOL),
    ]

    if structured_output_schema:
        raw_tool = get_tool_runtime(FINAL_STRUCTURED_OUTPUT_TOOL)
        raw_tool.entity = raw_tool.entity.model_copy(deep=True)
        data_parameter = ToolParameter(
            name="data",
            type=ToolParameter.ToolParameterType.OBJECT,
            form=ToolParameter.ToolParameterForm.LLM,
            required=True,
            input_schema=dict(structured_output_schema),
            label=I18nObject(en_US="__Data", zh_Hans="__Data"),
        )
        raw_tool.entity.parameters = [data_parameter]

        def invoke_tool(
            user_id: str,
            tool_parameters: dict[str, Any],
            conversation_id: str | None = None,
            app_id: str | None = None,
            message_id: str | None = None,
        ) -> ToolInvokeMessage:
            data = tool_parameters["data"]
            if not data:
                return ToolInvokeMessage(message=ToolInvokeMessage.TextMessage(text="`data` field is required"))
            if not isinstance(data, dict):
                return ToolInvokeMessage(message=ToolInvokeMessage.TextMessage(text="`data` must be a dict"))
            return ToolInvokeMessage(message=ToolInvokeMessage.TextMessage(text=TERMINAL_OUTPUT_MESSAGE))

        raw_tool._invoke = invoke_tool  # pyright: ignore[reportPrivateUsage]
        tools.append(raw_tool)
    else:
        raw_tool = get_tool_runtime(FINAL_STRUCTURED_OUTPUT_TOOL)

        def invoke_tool(
            user_id: str,
            tool_parameters: dict[str, Any],
            conversation_id: str | None = None,
            app_id: str | None = None,
            message_id: str | None = None,
        ) -> ToolInvokeMessage:
            return ToolInvokeMessage(message=ToolInvokeMessage.TextMessage(text=TERMINAL_OUTPUT_MESSAGE))
        raw_tool._invoke = invoke_tool  # pyright: ignore[reportPrivateUsage]
        tools.append(raw_tool)

    return tools

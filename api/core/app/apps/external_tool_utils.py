"""Shared utilities for resolving external tool definitions and results from API args."""

import json
from collections.abc import Mapping
from typing import Any

from core.app.entities.app_invoke_entities import ToolResult
from core.model_runtime.entities import PromptMessageTool


def resolve_tools(args: Mapping[str, Any]) -> list[PromptMessageTool] | None:
    tools = args.get("tools")
    if not isinstance(tools, list):
        return None

    resolved: list[PromptMessageTool] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        if tool.get("type") != "function":
            continue
        function = tool.get("function")
        if not isinstance(function, dict):
            continue
        name = function.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        description = function.get("description")
        parameters = function.get("parameters")
        resolved.append(
            PromptMessageTool(
                name=name.strip(),
                description=description if isinstance(description, str) else "",
                parameters=parameters if isinstance(parameters, dict) else {},
            )
        )

    return resolved or None


def resolve_tool_results(args: Mapping[str, Any]) -> list[ToolResult] | None:
    tool_results = args.get("tool_results")
    if not isinstance(tool_results, list):
        return None

    resolved: list[ToolResult] = []
    for result in tool_results:
        if not isinstance(result, dict):
            continue
        tool_call_id = result.get("tool_call_id")
        output = result.get("output")
        if not isinstance(tool_call_id, str) or not tool_call_id.strip():
            continue
        if output is None:
            continue
        output_value = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False)
        is_error = result.get("is_error")
        resolved.append(
            ToolResult(
                tool_call_id=tool_call_id.strip(),
                output=output_value,
                is_error=bool(is_error) if isinstance(is_error, bool) else None,
            )
        )

    return resolved or None

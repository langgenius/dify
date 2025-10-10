"""Prompt utilities for agent built-in tools."""

from collections.abc import Sequence
from typing import TYPE_CHECKING

from core.file import File
from core.tools.entities.tool_entities import ToolParameter

if TYPE_CHECKING:
    from core.tools.__base.tool import Tool


def generate_file_prompt(files: Sequence[File]) -> str:
    """Generate a prompt describing available files.

    Args:
        files: Available files

    Returns:
        Formatted prompt string describing the files
    """
    if not files:
        return ""

    file_info = "Files are available for your use. Use the 'dispatch_file' tool to work with them:\n"

    for i, file in enumerate(files, 1):
        file_type = file.type.value if file.type else "unknown"
        file_size = f"{file.size:,} bytes" if file.size else "unknown size"
        file_info += f"{i}. {file.filename} (Type: {file_type}, Size: {file_size}, ID: {file.filename})\n"

    file_info += "\nUse dispatch_file with:\n"
    file_info += "- target='self' to analyze file content yourself\n"
    file_info += "- target='<tool_name>' to send file to another tool (see tool file parameters below)"

    return file_info


def generate_tool_file_params_prompt(tools: Sequence["Tool"]) -> str:
    """Generate a prompt describing which tools accept files and their parameter names.

    Args:
        tools: Available tools

    Returns:
        Formatted prompt string describing tool file parameters
    """
    tool_file_params: dict[str, list[str]] = {}

    for tool in tools:
        if hasattr(tool, "entity") and hasattr(tool.entity, "identity"):
            tool_name = tool.entity.identity.name
            file_params = []

            # Get tool parameters
            if hasattr(tool, "get_merged_runtime_parameters"):
                parameters = tool.get_merged_runtime_parameters()
            elif hasattr(tool, "entity") and hasattr(tool.entity, "parameters"):
                parameters = tool.entity.parameters
            else:
                continue

            # Find file parameters
            for param in parameters:
                if hasattr(param, "type") and param.type in {
                    ToolParameter.ToolParameterType.FILE,
                    ToolParameter.ToolParameterType.FILES,
                    ToolParameter.ToolParameterType.SYSTEM_FILES,
                }:
                    file_params.append(param.name)

            if file_params:
                tool_file_params[tool_name] = file_params

    if not tool_file_params:
        return ""

    prompt = "\nTools that accept files and their parameter names:\n"
    for tool_name, params in tool_file_params.items():
        params_str = ", ".join(f"'{p}'" for p in params)
        prompt += f"- {tool_name}: {params_str}\n"

    prompt += "\nWhen using dispatch_file, specify the exact tool name and parameter name from this list."

    return prompt

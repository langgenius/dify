"""Credential-free descriptions of the exact tools exposed to Agent V2."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .dify_tools_builder import WorkflowAgentToolLayers


@dataclass(frozen=True, slots=True)
class AgentRuntimeToolDefinition:
    tool_ref: str
    name: str
    display_name: str
    description: str
    input_schema: dict[str, Any]
    schema_available: bool = True


def build_runtime_tool_definitions(
    *,
    tool_layers: WorkflowAgentToolLayers,
    include_shell: bool,
) -> tuple[AgentRuntimeToolDefinition, ...]:
    """Return the non-secret, model-visible tool surface for evaluation."""

    definitions: list[AgentRuntimeToolDefinition] = []
    if tool_layers.plugin_tools is not None:
        for tool in tool_layers.plugin_tools.tools:
            name = tool.name or tool.tool_name
            definitions.append(
                AgentRuntimeToolDefinition(
                    tool_ref=f"plugin:{tool.plugin_id}/{tool.provider}/{tool.tool_name}",
                    name=name,
                    display_name=name,
                    description=tool.description or "",
                    input_schema=tool.parameters_json_schema or {},
                )
            )
    if tool_layers.core_tools is not None:
        for tool in tool_layers.core_tools.tools:
            name = tool.name or tool.tool_name
            definitions.append(
                AgentRuntimeToolDefinition(
                    tool_ref=f"core:{tool.provider_type}/{tool.provider_id}/{tool.tool_name}",
                    name=name,
                    display_name=name,
                    description=tool.description or "",
                    input_schema=tool.parameters_json_schema or {},
                )
            )
    if include_shell:
        definitions.extend(_shell_runtime_tool_definitions())
    return tuple(definitions)


def _shell_runtime_tool_definitions() -> tuple[AgentRuntimeToolDefinition, ...]:
    return (
        AgentRuntimeToolDefinition(
            tool_ref="dify.shell/shell_run",
            name="shell_run",
            display_name="Run shell command",
            description="Start a command or script in the isolated Agent workspace.",
            input_schema={
                "type": "object",
                "properties": {"script": {"type": "string"}, "timeout": {"type": "number"}},
                "required": ["script"],
            },
        ),
        AgentRuntimeToolDefinition(
            tool_ref="dify.shell/shell_wait",
            name="shell_wait",
            display_name="Wait for shell command",
            description="Wait for more output or completion from an existing shell job.",
            input_schema={
                "type": "object",
                "properties": {"job_id": {"type": "string"}, "timeout": {"type": "number"}},
                "required": ["job_id"],
            },
        ),
        AgentRuntimeToolDefinition(
            tool_ref="dify.shell/shell_input",
            name="shell_input",
            display_name="Send shell input",
            description="Send standard-input text to a running shell job.",
            input_schema={
                "type": "object",
                "properties": {
                    "job_id": {"type": "string"},
                    "text": {"type": "string"},
                    "timeout": {"type": "number"},
                },
                "required": ["job_id", "text"],
            },
        ),
        AgentRuntimeToolDefinition(
            tool_ref="dify.shell/shell_interrupt",
            name="shell_interrupt",
            display_name="Interrupt shell command",
            description="Interrupt a running shell job.",
            input_schema={
                "type": "object",
                "properties": {"job_id": {"type": "string"}, "grace_seconds": {"type": "number"}},
                "required": ["job_id"],
            },
        ),
    )


__all__ = ["AgentRuntimeToolDefinition", "build_runtime_tool_definitions"]

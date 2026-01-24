"""
Vibe Workflow Generator - Prompts and Formatters.

This module provides formatting functions for the workflow generator prompts.
Refactored to remove legacy logic not used by the new runner architecture.
"""

import json

from core.workflow.generator.config import BUILTIN_NODE_SCHEMAS
from core.workflow.generator.types import (
    AvailableModelDict,
    AvailableToolDict,
    WorkflowNodeDict,
)


def format_available_nodes(nodes: list[WorkflowNodeDict] | None) -> str:
    """Format available nodes as XML with parameter schemas."""
    lines = ["<available_nodes>"]

    # First, add built-in nodes with their schemas
    for node_type, schema in BUILTIN_NODE_SCHEMAS.items():
        lines.append(f'  <node type="{node_type}">')
        lines.append(f"    <description>{schema.get('description', '')}</description>")

        required = schema.get("required", [])
        if required:
            lines.append(f"    <required_params>{', '.join(required)}</required_params>")

        params = schema.get("parameters", {})
        if params:
            lines.append("    <params>")
            for param_name, param_info in params.items():
                param_type = param_info.get("type", "string")
                is_required = param_name in required
                desc = param_info.get("description", "")

                if param_type == "enum":
                    options = param_info.get("options", [])
                    lines.append(
                        f'      <param name="{param_name}" type="enum" '
                        f'options="{",".join(options)}" required="{str(is_required).lower()}">'
                        f"{desc}</param>"
                    )
                else:
                    lines.append(
                        f'      <param name="{param_name}" type="{param_type}" '
                        f'required="{str(is_required).lower()}">{desc}</param>'
                    )

                # Add example if present
                if "example" in param_info:
                    example = param_info["example"]
                    if isinstance(example, dict):
                        example = json.dumps(example)
                    lines.append(f"        <!-- example: {example} -->")
            lines.append("    </params>")

        outputs = schema.get("outputs", [])
        if outputs:
            lines.append(f"    <outputs>{', '.join(outputs)}</outputs>")

        lines.append("  </node>")

    # Add custom nodes from the provided list (without detailed schemas)
    if nodes:
        for node in nodes:
            node_type = node.get("type", "unknown")
            # Skip if already covered by built-in schemas
            if node_type in BUILTIN_NODE_SCHEMAS:
                continue
            description = node.get("description", "No description")
            lines.append(f'  <node type="{node_type}">')
            lines.append(f"    <description>{description}</description>")
            lines.append("  </node>")

    lines.append("</available_nodes>")
    return "\n".join(lines)


def format_available_tools(tools: list[AvailableToolDict] | None) -> str:
    """Format available tools as XML with parameter schemas."""
    lines = ["<available_tools>"]

    if not tools:
        lines.append("  <!-- No external tools installed -->")
        lines.append("  <!-- Use http-request or code nodes for external integrations -->")
        lines.append("</available_tools>")
        return "\n".join(lines)

    configured_tools: list[AvailableToolDict] = []
    unconfigured_tools: list[AvailableToolDict] = []

    for tool in tools:
        if tool.get("is_team_authorization", False):
            configured_tools.append(tool)
        else:
            unconfigured_tools.append(tool)

    # Configured tools (ready to use)
    lines.append("  <!-- CONFIGURED TOOLS: Ready to use in workflows -->")
    if configured_tools:
        for tool in configured_tools:
            tool_key = tool.get("tool_key") or f"{tool.get('provider_id')}/{tool.get('tool_name')}"
            description = tool.get("tool_description") or tool.get("description", "")
            lines.append(f'  <tool key="{tool_key}" status="configured">')
            lines.append(f"    <description>{description}</description>")

            # Add parameter schemas if available
            parameters = tool.get("parameters")
            if parameters:
                lines.append("    <params>")
                for param in parameters:
                    param_name = param.get("name", "")
                    param_type = param.get("type", "string")
                    required = param.get("required", False)
                    param_desc = param.get("human_description") or param.get("llm_description") or ""
                    # Handle localized descriptions
                    if isinstance(param_desc, dict):
                        param_desc = param_desc.get("en_US") or param_desc.get("zh_Hans") or str(param_desc)
                    options = param.get("options", [])

                    if options:
                        opt_str = ",".join(str(o.get("value", o)) if isinstance(o, dict) else str(o) for o in options)
                        lines.append(
                            f'      <param name="{param_name}" type="enum" options="{opt_str}" '
                            f'required="{str(required).lower()}">{param_desc}</param>'
                        )
                    else:
                        lines.append(
                            f'      <param name="{param_name}" type="{param_type}" '
                            f'required="{str(required).lower()}">{param_desc}</param>'
                        )
                lines.append("    </params>")

            lines.append("  </tool>")
    else:
        lines.append("  <!-- No configured tools. Use http-request or code nodes instead. -->")

    # Unconfigured tools (need setup first)
    lines.append("")
    lines.append("  <!-- UNCONFIGURED TOOLS: Available but need setup in Tools page -->")
    if unconfigured_tools:
        for tool in unconfigured_tools:
            tool_key = tool.get("tool_key") or f"{tool.get('provider_id')}/{tool.get('tool_name')}"
            description = tool.get("tool_description") or tool.get("description", "")
            lines.append(f'  <tool key="{tool_key}" status="unconfigured">')
            lines.append(f"    <description>{description}</description>")
            lines.append("    <!-- User must configure this tool before it can be used -->")
            lines.append("  </tool>")
    else:
        lines.append("  <!-- No unconfigured tools -->")

    lines.append("</available_tools>")
    return "\n".join(lines)


def format_available_models(models: list[AvailableModelDict] | None) -> str:
    """Format available models as XML for prompt inclusion."""
    if not models:
        return "<available_models>\n  <!-- No models configured - omit model config from nodes -->\n</available_models>"

    lines = ["<available_models>"]
    for model in models:
        provider = model.get("provider", "unknown")
        model_name = model.get("model", "unknown")
        lines.append(f'  <model provider="{provider}" name="{model_name}" />')
    lines.append("</available_models>")

    # Add model selection rule with concrete example
    lines.append("")
    lines.append("<model_selection_rule>")
    lines.append("  CRITICAL: For LLM, question-classifier, and parameter-extractor nodes:")
    lines.append("  - You MUST include a 'model' field in the config")
    lines.append("  - You MUST use ONLY models from available_models above")
    lines.append("  - NEVER use openai/gpt-4o, gpt-3.5-turbo, gpt-4 unless they appear in available_models")
    lines.append("")

    # Provide concrete JSON example to copy
    first_model = models[0]
    provider = first_model.get("provider", "unknown")
    model_name = first_model.get("model", "unknown")
    lines.append("  COPY THIS EXACT MODEL CONFIG for all LLM/question-classifier/parameter-extractor nodes:")
    lines.append(f'  "model": {{"provider": "{provider}", "name": "{model_name}", "mode": "chat"}}')

    if len(models) > 1:
        lines.append("")
        lines.append("  Alternative models you can use:")
        for m in models[1:4]:  # Show up to 3 alternatives
            p = m.get("provider", "unknown")
            n = m.get("model", "unknown")
            lines.append(f'  - "model": {{"provider": "{p}", "name": "{n}", "mode": "chat"}}')

    lines.append("</model_selection_rule>")

    return "\n".join(lines)

"""
Vibe Workflow Generator - Enhanced Prompts with Inline Intent Classification.

This module provides prompts for the agent-enhanced workflow generation
with inline intent classification (no separate ReAct loop to stay within
single endpoint constraints).
"""

import json
import re
from typing import Any

from core.workflow.generator.config import (
    BUILTIN_NODE_SCHEMAS,
    DEFAULT_SUGGESTIONS,
    FALLBACK_RULES,
    OFF_TOPIC_RESPONSES,
)


def extract_instruction_values(instruction: str) -> dict[str, Any]:
    """
    Extract concrete values from user instruction for auto-fill hints.

    This pre-processes the instruction to find URLs, emails, and other
    concrete values that can be used as defaults in the generated workflow.
    """
    urls = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', instruction)

    return {
        "urls": urls,
        "emails": re.findall(r'[\w.-]+@[\w.-]+\.\w+', instruction),
        "api_endpoints": [u for u in urls if "/api/" in u or "/v1/" in u or "/v2/" in u],
        "file_extensions": re.findall(r'\.(json|csv|txt|pdf|docx?)(?:\s|$)', instruction, re.IGNORECASE),
        "json_paths": re.findall(r'\.[\w]+(?:\.[\w]+)+', instruction),  # e.g., .data.results
    }


def format_extracted_values(extracted: dict[str, Any]) -> str:
    """Format extracted values as XML for prompt inclusion."""
    parts = []

    if extracted.get("urls"):
        urls_str = ", ".join(extracted["urls"])
        parts.append(f"  <urls>{urls_str}</urls>")

    if extracted.get("api_endpoints"):
        endpoints_str = ", ".join(extracted["api_endpoints"])
        parts.append(f"  <api_endpoints>{endpoints_str}</api_endpoints>")

    if extracted.get("emails"):
        emails_str = ", ".join(extracted["emails"])
        parts.append(f"  <emails>{emails_str}</emails>")

    if extracted.get("file_extensions"):
        exts_str = ", ".join(extracted["file_extensions"])
        parts.append(f"  <file_types>{exts_str}</file_types>")

    if parts:
        return "<extracted_values>\n" + "\n".join(parts) + "\n</extracted_values>"
    return "<extracted_values><none/></extracted_values>"


VIBE_ENHANCED_SYSTEM_PROMPT = """<role>
You are a Dify workflow design assistant.
You help users create AI automation workflows by generating workflow configurations.
</role>

<language_rules>
- Detect the language of the user's request automatically.
- Generate ALL node titles and user-facing text in the SAME language as the user's input.
- If the input language cannot be determined, use {preferred_language} as the fallback language.
- Example: If user writes in Chinese, node titles should be in Chinese (e.g., "获取数据", "处理结果").
- Example: If user writes in English, node titles should be in English (e.g., "Fetch Data", "Process Results").
</language_rules>

<capabilities>
- Generate workflow configurations from natural language descriptions
- Validate tool references against available integrations
- Provide clear, helpful responses
- Reject requests that are not about workflow design
</capabilities>

{available_nodes_formatted}

{available_tools_formatted}

{available_models_formatted}

<variable_syntax>
  <description>How to reference data from other nodes in your workflow</description>
  <pattern>{{{{#node_id.field_name#}}}}</pattern>
  <examples>
    <example context="Reference start node input">{{{{#start.url#}}}}</example>
    <example context="Reference start node query">{{{{#start.query#}}}}</example>
    <example context="Reference LLM output">{{{{#llm_node_id.text#}}}}</example>
    <example context="Reference HTTP response">{{{{#http_node_id.body#}}}}</example>
    <example context="Reference code output">{{{{#code_node_id.result#}}}}</example>
  </examples>
</variable_syntax>

<rules>
  <rule id="model_selection" priority="critical">
    For LLM, question-classifier, parameter-extractor nodes:
    - You MUST include a "model" config with provider and name from available_models section
    - Copy the EXACT provider and name values from available_models
    - NEVER use openai/gpt-4o, openai/gpt-3.5-turbo, openai/gpt-4 unless they appear in available_models
    - If available_models is empty or not provided, omit the model config entirely
  </rule>
  <rule id="tool_usage" priority="critical">
    ONLY use tools with status="configured" from available_tools.
    NEVER invent tool names like "webscraper", "email_sender", etc.
    If no matching tool exists, use http-request or code node as fallback.
  </rule>
  <rule id="node_config" priority="critical">
    ALWAYS fill ALL required_params for each node type.
    Check the node's params section to know what config is needed.
  </rule>
  <rule id="variable_reference" priority="high">
    Use {{{{#node_id.field#}}}} syntax to reference outputs from previous nodes.
    Start node variables: {{{{#start.variable_name#}}}}
  </rule>
</rules>

<fallback_behavior>
  <description>When user requests capability with NO matching tool in available_tools</description>
  <fallback request="Web scraping, fetch URL" use_node="http-request">
    Configure with: url (the URL to fetch), method: GET
  </fallback>
  <fallback request="API calls, webhooks" use_node="http-request">
    Configure with: url, method, headers, body as needed
  </fallback>
  <fallback request="Custom logic, calculations" use_node="code">
    Write Python/JavaScript code with main() function
  </fallback>
  <fallback request="Text processing, AI analysis" use_node="llm">
    Use prompt_template with appropriate system/user messages
  </fallback>
  <warning>Add warning to response explaining the fallback substitution</warning>
</fallback_behavior>

<workflow_context>
  <existing_nodes>
{existing_nodes_formatted}
  </existing_nodes>
  <selected_nodes>
{selected_nodes_formatted}
  </selected_nodes>
</workflow_context>

<response_format>
  <format type="generate">
```json
{{{{
  "intent": "generate",
  "thinking": "Brief analysis of user request and approach",
  "message": "User-friendly explanation of the workflow",
  "mermaid": "flowchart TD\\n  N1[\\"type=start|title=Start\\"]\\n  ...",
  "nodes": [
    {{{{
      "id": "node_id",
      "type": "node_type",
      "title": "Display Name",
      "config": {{{{ /* REQUIRED: Fill all required_params from node schema */ }}}}
    }}}}
  ],
  "edges": [{{{{"source": "node1_id", "target": "node2_id"}}}}],
  "warnings": ["Any warnings about fallbacks or missing features"]
}}}}
```
  </format>
  <format type="off_topic">
```json
{{{{
  "intent": "off_topic",
  "message": "Explanation of what you can help with",
  "suggestions": ["Workflow suggestion 1", "Suggestion 2"]
}}}}
```
  </format>
</response_format>

<off_topic_detection>
  <reject>Weather queries, math calculations, jokes, general knowledge</reject>
  <reject>Translation requests, general coding help, account/billing questions</reject>
  <accept>Workflow creation, node configuration, automation design</accept>
  <accept>Questions about Dify workflow capabilities</accept>
</off_topic_detection>

<mermaid_syntax>
  <rule>Use `flowchart TD` for top-down flow</rule>
  <rule>Node format: `ID["type=TYPE|title=TITLE"]` or `ID["type=tool|title=TITLE|tool=TOOL_KEY"]`</rule>
  <rule>type= and title= are REQUIRED for EVERY node</rule>
  <rule>Declare all nodes BEFORE edges</rule>
  <rule>Use `-->` for connections, `-->|true|` and `-->|false|` for branches</rule>
  <examples>
    <correct>N1["type=start|title=Start"]</correct>
    <correct>N2["type=http-request|title=Fetch Data"]</correct>
    <correct>N3["type=tool|title=Search|tool=google/google_search"]</correct>
    <wrong reason="missing type=">Start[Start]</wrong>
    <wrong reason="invented tool">N1["type=tool|title=Scrape|tool=webscraper"]</wrong>
  </examples>
</mermaid_syntax>

<node_config_examples>
  <example type="http-request" title="Fetch a webpage">
    {{{{
      "id": "fetch",
      "type": "http-request",
      "title": "Fetch Webpage",
      "config": {{{{
        "url": "{{{{#start.url#}}}}",
        "method": "GET",
        "headers": "",
        "params": "",
        "body": {{{{"type": "none", "data": []}}}},
        "authorization": {{{{"type": "no-auth"}}}}
      }}}}
    }}}}
  </example>
  <example type="llm" title="Analyze content">
    {{{{
      "id": "analyze",
      "type": "llm",
      "title": "Analyze Content",
      "config": {{{{
        "model": {{{{"provider": "USE_FROM_AVAILABLE_MODELS", "name": "USE_FROM_AVAILABLE_MODELS", "mode": "chat"}}}},
        "prompt_template": [
          {{{{"role": "system", "text": "You are a helpful analyst."}}}},
          {{{{"role": "user", "text": "Analyze this content:\\n\\n{{{{#fetch.body#}}}}"}}}}
        ]
      }}}}
    }}}}
    NOTE: Replace "USE_FROM_AVAILABLE_MODELS" with actual values from available_models section!
  </example>
  <example type="code" title="Process data">
    {{{{
      "id": "process",
      "type": "code",
      "title": "Process Data",
      "config": {{{{
        "language": "python3",
        "code": "def main(data):\\n    return {{\\"result\\": data.upper()}}"
      }}}}
    }}}}
  </example>
</node_config_examples>

<auto_fill_instructions>
  <description>CRITICAL: Auto-fill all parameters so workflow runs immediately</description>
  
  <start_node>
    <rule>MUST define input variables for ALL data the workflow needs from user</rule>
    <rule>Use extracted values from user instruction as "default" when available</rule>
    <examples>
      <example>URL fetching workflow → add "url" variable with type="text-input"</example>
      <example>Text processing workflow → add "content" or "query" variable</example>
      <example>API integration → add "api_key" variable if authentication needed</example>
    </examples>
    <config_format>
      {{{{
        "variables": [
          {{{{"variable": "url", "label": "Target URL", "type": "text-input", "required": true, "default": "https://..."}}}}
        ]
      }}}}
    </config_format>
  </start_node>
  
  <variable_flow>
    <rule>EVERY node parameter that needs data must reference a source:</rule>
    <rule>- User input from start node → {{{{#start.variable_name#}}}}</rule>
    <rule>- Output from previous node → {{{{#node_id.output_field#}}}}</rule>
    <rule>- Or a concrete hardcoded value extracted from user instruction</rule>
    <rule>NEVER leave parameters empty - always fill with variable reference or concrete value</rule>
  </variable_flow>
  
  <http_request_node>
    <rule>url: MUST be {{{{#start.url#}}}} OR concrete URL from instruction - NEVER empty</rule>
    <rule>method: Set based on action (fetch/get → GET, send/post/create → POST, update → PUT, delete → DELETE)</rule>
    <rule>headers: Include Authorization if API key is available</rule>
  </http_request_node>
  
  <llm_node>
    <rule>prompt_template MUST reference previous node output for context</rule>
    <rule>Example: {{{{"role": "user", "text": "Analyze this:\\n\\n{{{{#http_node.body#}}}}"}}}} </rule>
    <rule>Include system message to set AI behavior/role</rule>
  </llm_node>
  
  <code_node>
    <rule>variables array MUST include inputs from previous nodes</rule>
    <rule>Example: {{{{"variable": "data", "value_selector": ["http_node", "body"]}}}}</rule>
    <rule>code must define main() function that returns dict</rule>
  </code_node>
  
  <end_node>
    <rule>outputs MUST use value_selector to reference the final processing node's output</rule>
    <rule>Example: {{{{"variable": "result", "value_selector": ["llm_node", "text"]}}}}</rule>
  </end_node>
</auto_fill_instructions>

{extracted_values_formatted}
"""

VIBE_ENHANCED_USER_PROMPT = """<user_request>
{instruction}
</user_request>

<task_steps>
  <step number="1" name="Intent Classification">
    Is this request about workflow/automation design?
    - If NO (weather, jokes, math, translations, general questions) → return off_topic response
    - If YES → proceed to Step 2
  </step>

  <step number="2" name="Requirement Analysis">
    - What is the user trying to achieve?
    - What inputs are needed (define in start node)?
    - What processing steps are required?
    - What outputs should be produced (define in end node)?
  </step>

  <step number="3" name="Tool and Node Selection" priority="critical">
    - Check available_tools - which tools with status="configured" can be used?
    - For each required capability, check if a matching tool exists
    - If NO matching tool: use fallback node (http-request, code, or llm)
    - NEVER invent tool names - only use exact keys from available_tools
  </step>

  <step number="4" name="Node Configuration" priority="critical">
    - For EACH node, check its required_params in available_nodes
    - Fill ALL required config fields with proper values
    - Use {{{{#node_id.field#}}}} syntax to reference previous node outputs
    - http-request MUST have: url, method
    - code MUST have: code, language
    - llm MUST have: prompt_template
  </step>

  <step number="5" name="Generate Response">
    - Create mermaid flowchart with correct syntax
    - Generate nodes array with complete config for each node
    - Generate edges array connecting the nodes
    - Add warnings if using fallback nodes
  </step>
</task_steps>

{previous_attempt_formatted}

<output_instruction>
Generate your JSON response now. Remember:
1. Fill ALL required_params for each node type
2. Use variable references like {{{{#start.url#}}}} to connect nodes
3. Never invent tool names - use fallback nodes instead
</output_instruction>
"""


def format_available_nodes(nodes: list[dict[str, Any]] | None) -> str:
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


def format_available_tools(tools: list[dict[str, Any]] | None) -> str:
    """Format available tools as XML with parameter schemas."""
    lines = ["<available_tools>"]

    if not tools:
        lines.append("  <!-- No external tools installed -->")
        lines.append("  <!-- Use http-request or code nodes for external integrations -->")
        lines.append("</available_tools>")
        return "\n".join(lines)

    configured_tools: list[dict[str, Any]] = []
    unconfigured_tools: list[dict[str, Any]] = []

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


def format_existing_nodes(nodes: list[dict[str, Any]] | None) -> str:
    """Format existing workflow nodes for context."""
    if not nodes:
        return "No existing nodes in workflow (creating from scratch)."

    lines = []
    for node in nodes:
        node_id = node.get("id", "unknown")
        node_type = node.get("type", "unknown")
        title = node.get("title", "Untitled")
        lines.append(f"- [{node_id}] {title} ({node_type})")
    return "\n".join(lines)


def format_selected_nodes(
    selected_ids: list[str] | None,
    existing_nodes: list[dict[str, Any]] | None,
) -> str:
    """Format selected nodes for modification context."""
    if not selected_ids:
        return "No nodes selected (generating new workflow)."

    node_map = {n.get("id"): n for n in (existing_nodes or [])}
    lines = []
    for node_id in selected_ids:
        if node_id in node_map:
            node = node_map[node_id]
            lines.append(f"- [{node_id}] {node.get('title', 'Untitled')} ({node.get('type', 'unknown')})")
        else:
            lines.append(f"- [{node_id}] (not found in current workflow)")
    return "\n".join(lines)


def format_previous_attempt(
    previous_workflow: dict[str, Any] | None,
    regenerate_mode: bool = False,
) -> str:
    """
    Format previous workflow attempt as XML context for regeneration.

    When regenerating, we pass the previous workflow and warnings so the model
    can fix specific issues instead of starting from scratch.
    """
    if not regenerate_mode or not previous_workflow:
        return ""

    nodes = previous_workflow.get("nodes", [])
    edges = previous_workflow.get("edges", [])
    warnings = previous_workflow.get("warnings", [])

    parts = ["<previous_attempt>"]
    parts.append("  <description>")
    parts.append("    Your previous generation had issues. Please fix them while keeping the good parts.")
    parts.append("  </description>")

    if warnings:
        parts.append("  <warnings>")
        for warning in warnings:
            parts.append(f"    - {warning}")
        parts.append("  </warnings>")

    if nodes:
        # Summarize nodes without full config to save tokens
        parts.append("  <previous_nodes>")
        for node in nodes:
            node_id = node.get("id", "unknown")
            node_type = node.get("type", "unknown")
            title = node.get("title", "Untitled")
            config = node.get("config", {})

            # Show key config issues for debugging
            config_summary = ""
            if node_type == "http-request":
                url = config.get("url", "")
                if not url:
                    config_summary = " (url: EMPTY - needs fix)"
                elif url.startswith("{{#"):
                    config_summary = f" (url: {url})"
            elif node_type == "tool":
                tool_name = config.get("tool_name", "")
                config_summary = f" (tool: {tool_name})"

            parts.append(f"    - [{node_id}] {title} ({node_type}){config_summary}")
        parts.append("  </previous_nodes>")

    if edges:
        parts.append("  <previous_edges>")
        for edge in edges:
            parts.append(f"    - {edge.get('source', '?')} → {edge.get('target', '?')}")
        parts.append("  </previous_edges>")

    parts.append("  <fix_instructions>")
    parts.append("    1. Keep the workflow structure if it makes sense")
    parts.append("    2. Fix any invalid tool references - use http-request or code as fallback")
    parts.append("    3. Fill ALL required parameters (url, method, prompt_template, etc.)")
    parts.append("    4. Use {{#node_id.field#}} syntax for variable references")
    parts.append("    5. Define input variables in the Start node")
    parts.append("  </fix_instructions>")
    parts.append("</previous_attempt>")

    return "\n".join(parts)


def format_available_models(models: list[dict[str, Any]] | None) -> str:
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


def build_vibe_enhanced_prompt(
    instruction: str,
    available_nodes: list[dict[str, Any]] | None = None,
    available_tools: list[dict[str, Any]] | None = None,
    existing_nodes: list[dict[str, Any]] | None = None,
    selected_node_ids: list[str] | None = None,
    previous_workflow: dict[str, Any] | None = None,
    regenerate_mode: bool = False,
    preferred_language: str | None = None,
    available_models: list[dict[str, Any]] | None = None,
) -> tuple[str, str]:
    """Build the complete system and user prompts."""
    # Extract concrete values from user instruction for auto-fill hints
    extracted = extract_instruction_values(instruction)
    extracted_values_xml = format_extracted_values(extracted)

    # Format previous attempt context for regeneration
    previous_attempt_xml = format_previous_attempt(previous_workflow, regenerate_mode)

    # Default to English if no preferred language specified
    language_hint = preferred_language or "English"

    system_prompt = VIBE_ENHANCED_SYSTEM_PROMPT.format(
        preferred_language=language_hint,
        available_nodes_formatted=format_available_nodes(available_nodes),
        available_tools_formatted=format_available_tools(available_tools),
        existing_nodes_formatted=format_existing_nodes(existing_nodes),
        selected_nodes_formatted=format_selected_nodes(selected_node_ids, existing_nodes),
        extracted_values_formatted=extracted_values_xml,
        previous_attempt_formatted=previous_attempt_xml,
        available_models_formatted=format_available_models(available_models),
    )

    user_prompt = VIBE_ENHANCED_USER_PROMPT.format(
        instruction=instruction,
        previous_attempt_formatted=previous_attempt_xml,
    )

    return system_prompt, user_prompt


def parse_vibe_response(content: str) -> dict[str, Any]:
    """Parse LLM response into structured format."""
    # Extract JSON from markdown code block if present
    json_match = re.search(r"```(?:json)?\s*([\s\S]+?)```", content)
    if json_match:
        content = json_match.group(1).strip()

    # Try parsing JSON
    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        # Attempt simple repair: remove trailing commas
        cleaned = re.sub(r",\s*([}\]])", r"\1", content)
        try:
            data = json.loads(cleaned)
        except json.JSONDecodeError:
            # Return error format
            return {
                "intent": "error",
                "error": "Failed to parse LLM response as JSON",
                "raw_content": content[:500],  # First 500 chars for debugging
            }

    # Validate and normalize
    if "intent" not in data:
        data["intent"] = "generate"  # Default assumption

    # Ensure required fields for generate intent
    if data["intent"] == "generate":
        data.setdefault("mermaid", "")
        data.setdefault("nodes", [])
        data.setdefault("edges", [])
        data.setdefault("message", "")
        data.setdefault("warnings", [])

    # Ensure required fields for off_topic intent
    if data["intent"] == "off_topic":
        data.setdefault("message", OFF_TOPIC_RESPONSES["default"]["en"])
        data.setdefault("suggestions", DEFAULT_SUGGESTIONS["en"])

    return data


def validate_tool_references(
    nodes: list[dict[str, Any]],
    available_tools: list[dict[str, Any]] | None,
) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Validate tool references and return warnings and recommendations.

    Returns:
        tuple of (warnings, tool_recommendations)
    """
    if not available_tools:
        return [], []

    # Build lookup sets for configured and unconfigured tools
    configured_keys: set[str] = set()
    unconfigured_keys: set[str] = set()
    tool_info_map: dict[str, dict[str, Any]] = {}

    for tool in available_tools:
        provider = tool.get("provider_id") or tool.get("provider", "")
        tool_key = tool.get("tool_key") or tool.get("tool_name", "")
        is_authorized = tool.get("is_team_authorization", False)

        full_key = f"{provider}/{tool_key}" if provider else tool_key
        tool_info_map[full_key] = {
            "provider_id": provider,
            "tool_name": tool_key,
            "description": tool.get("tool_description") or tool.get("description", ""),
        }

        if is_authorized:
            configured_keys.add(full_key)
            if tool_key:
                configured_keys.add(tool_key)
        else:
            unconfigured_keys.add(full_key)
            if tool_key:
                unconfigured_keys.add(tool_key)

    warnings: list[str] = []
    recommendations: list[dict[str, Any]] = []
    seen_recommendations: set[str] = set()

    for node in nodes:
        if node.get("type") == "tool":
            config = node.get("config", {})
            tool_ref = config.get("tool_key") or config.get("tool") or node.get("tool_name")

            if not tool_ref:
                continue

            # Check if tool is configured
            if tool_ref in configured_keys:
                continue

            # Check if tool exists but is unconfigured
            if tool_ref in unconfigured_keys:
                if tool_ref not in seen_recommendations:
                    seen_recommendations.add(tool_ref)
                    warnings.append(f"Tool '{tool_ref}' requires configuration")
                    tool_info = tool_info_map.get(tool_ref, {})
                    recommendations.append({
                        "requested_capability": f"Use {tool_ref}",
                        "unconfigured_tools": [tool_info] if tool_info else [],
                        "configured_alternatives": [],
                        "recommendation": f"Configure '{tool_ref}' in Tools settings to enable this functionality",
                    })
            else:
                # Tool doesn't exist at all
                warnings.append(f"Tool '{tool_ref}' not found in available tools")

    return warnings, recommendations


def determine_fallback_type(tool_ref: str, node_title: str) -> str | None:
    """
    Determine the best fallback node type based on tool name/title semantics.

    Returns:
        - "http-request" for web/API related tools
        - "code" for logic/calculation related tools
        - "llm" for text/AI analysis related tools
        - None if no appropriate fallback can be determined
    """
    combined = f"{tool_ref} {node_title}".lower()

    for fallback_type, keywords in FALLBACK_RULES.items():
        if any(kw in combined for kw in keywords):
            return fallback_type

    # No matching rule - don't force a fallback
    return None


def create_http_request_fallback(original_node: dict[str, Any]) -> dict[str, Any]:
    """Create http-request fallback node, preserving original URL if present."""
    config = original_node.get("config", {})
    tool_params = config.get("tool_parameters", {})
    # Also check "params" - LLM may put tool parameters there
    params = config.get("params", {})
    if isinstance(params, str):
        # params might be a string (query params), not tool params
        params = {}

    # Try to preserve URL from original config (check multiple locations)
    original_url = (
        config.get("url")
        or tool_params.get("url")
        or params.get("url")
        or ""
    )

    # Headers should be a string (newline separated key: value pairs)
    headers = config.get("headers") or tool_params.get("headers") or params.get("headers") or ""
    if isinstance(headers, dict):
        # Convert dict to string format
        headers = "\n".join(f"{k}: {v}" for k, v in headers.items()) if headers else ""

    # Body should have a type field - use "none" as default
    body = config.get("body") or tool_params.get("body") or params.get("body") or {}
    if not isinstance(body, dict) or "type" not in body:
        body = {"type": "none", "data": []}

    # Method - check multiple locations
    method = config.get("method") or tool_params.get("method") or params.get("method") or "GET"

    return {
        "id": original_node.get("id", ""),
        "type": "http-request",
        "title": f"{original_node.get('title', 'Request')} (fallback)",
        "config": {
            "method": method,
            "url": original_url,
            "headers": headers,
            "params": "",
            "body": body,
            "authorization": {"type": "no-auth"},
        },
    }


def create_code_fallback(original_node: dict[str, Any]) -> dict[str, Any]:
    """Create code fallback node with placeholder implementation."""
    title = original_node.get("title", "Process")
    return {
        "id": original_node.get("id", ""),
        "type": "code",
        "title": f"{title} (fallback)",
        "config": {
            "language": "python3",
            "code": f'def main():\n    # TODO: Implement "{title}" logic\n    return {{"result": "placeholder"}}',
        },
    }


def create_llm_fallback(original_node: dict[str, Any]) -> dict[str, Any]:
    """Create LLM fallback node for text analysis tasks."""
    title = original_node.get("title", "Analyze")
    return {
        "id": original_node.get("id", ""),
        "type": "llm",
        "title": f"{title} (fallback)",
        "config": {
            "prompt_template": [
                {"role": "system", "text": "You are a helpful assistant."},
                {"role": "user", "text": f"Please help with: {title}"},
            ],
        },
    }


def sanitize_tool_nodes(
    nodes: list[dict[str, Any]],
    available_tools: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Replace invalid tool nodes with fallback nodes (http-request or code).

    This is a safety net for when the LLM hallucinates tool names despite prompt instructions.

    Returns:
        tuple of (sanitized_nodes, warnings)
    """
    if not nodes:
        return [], []

    # Build set of valid tool keys
    valid_tool_keys: set[str] = set()
    if available_tools:
        for tool in available_tools:
            provider = tool.get("provider_id") or tool.get("provider", "")
            tool_key = tool.get("tool_key") or tool.get("tool_name", "")
            if provider and tool_key:
                valid_tool_keys.add(f"{provider}/{tool_key}")
            if tool_key:
                valid_tool_keys.add(tool_key)

    sanitized: list[dict[str, Any]] = []
    warnings: list[str] = []

    for node in nodes:
        if node.get("type") != "tool":
            sanitized.append(node)
            continue

        # Check if tool reference is valid
        config = node.get("config", {})
        tool_ref = (
            config.get("tool_key")
            or config.get("tool_name")
            or config.get("provider_id", "") + "/" + config.get("tool_name", "")
        )

        # Normalize and check validity
        normalized_refs = [tool_ref]
        if "/" in tool_ref:
            # Also check just the tool name part
            normalized_refs.append(tool_ref.split("/")[-1])

        is_valid = any(ref in valid_tool_keys for ref in normalized_refs if ref)

        if is_valid:
            sanitized.append(node)
        else:
            # Determine the best fallback type based on tool semantics
            node_title = node.get("title", "")
            fallback_type = determine_fallback_type(tool_ref, node_title)

            if fallback_type == "http-request":
                fallback_node = create_http_request_fallback(node)
                sanitized.append(fallback_node)
                warnings.append(
                    f"Tool '{tool_ref}' not found. Replaced with http-request node. "
                    "Please configure the URL if not set."
                )
            elif fallback_type == "code":
                fallback_node = create_code_fallback(node)
                sanitized.append(fallback_node)
                warnings.append(
                    f"Tool '{tool_ref}' not found. Replaced with code node. "
                    "Please implement the logic in the code editor."
                )
            elif fallback_type == "llm":
                fallback_node = create_llm_fallback(node)
                sanitized.append(fallback_node)
                warnings.append(
                    f"Tool '{tool_ref}' not found. Replaced with LLM node. "
                    "Please configure the prompt template."
                )
            else:
                # No appropriate fallback - keep original node and warn
                sanitized.append(node)
                warnings.append(
                    f"Tool '{tool_ref}' not found and no suitable fallback determined. "
                    "Please configure a valid tool or replace this node manually."
                )

    return sanitized, warnings


def validate_node_parameters(nodes: list[dict[str, Any]]) -> list[str]:
    """
    Validate that all required parameters are properly filled in generated nodes.

    Returns a list of warnings for nodes with missing or empty parameters.
    """
    warnings: list[str] = []

    for node in nodes:
        node_id = node.get("id", "unknown")
        node_type = node.get("type", "")
        config = node.get("config", {})

        if node_type == "http-request":
            url = config.get("url", "")
            if not url:
                warnings.append(f"Node '{node_id}': http-request is missing required 'url' parameter")
            elif url == "":
                warnings.append(f"Node '{node_id}': http-request has empty 'url' - please configure")
            method = config.get("method", "")
            if not method:
                warnings.append(f"Node '{node_id}': http-request should have 'method' (GET, POST, etc.)")

        elif node_type == "llm":
            prompt_template = config.get("prompt_template", [])
            if not prompt_template:
                warnings.append(f"Node '{node_id}': LLM node is missing 'prompt_template'")
            else:
                # Check if any prompt references previous node output
                has_reference = any("{{#" in p.get("text", "") for p in prompt_template if isinstance(p, dict))
                if not has_reference:
                    warnings.append(
                        f"Node '{node_id}': LLM prompt should reference previous node output "
                        "using {{#node_id.field#}} syntax"
                    )

        elif node_type == "code":
            code = config.get("code", "")
            if not code:
                warnings.append(f"Node '{node_id}': code node is missing 'code' parameter")
            language = config.get("language", "")
            if not language:
                warnings.append(f"Node '{node_id}': code node should specify 'language' (python3 or javascript)")

        elif node_type == "start":
            variables = config.get("variables", [])
            if not variables:
                warnings.append(
                    "Start node should define input variables for user data (e.g., url, query, content)"
                )

        elif node_type == "end":
            outputs = config.get("outputs", [])
            if not outputs:
                warnings.append(
                    "End node should define output variables to return workflow results"
                )

    return warnings


def extract_mermaid_from_response(data: dict[str, Any]) -> str:
    """Extract mermaid flowchart from parsed response."""
    mermaid = data.get("mermaid", "")

    if not mermaid:
        return ""

    # Clean up mermaid code
    mermaid = mermaid.strip()
    # Remove code fence if present
    if mermaid.startswith("```"):
        match = re.search(r"```(?:mermaid)?\s*([\s\S]+?)```", mermaid)
        if match:
            mermaid = match.group(1).strip()

    # Sanitize edge labels to remove characters that break Mermaid parsing
    # Edge labels in Mermaid are ONLY in the pattern: -->|label|
    # We must NOT match |pipe| characters inside node labels like ["type=start|title=开始"]
    def sanitize_edge_label(match: re.Match) -> str:
        arrow = match.group(1)  # --> or ---
        label = match.group(2)  # the label between pipes
        # Remove or replace special characters that break Mermaid
        # Parentheses, brackets, braces have special meaning in Mermaid
        sanitized = re.sub(r'[(){}\[\]]', '', label)
        return f"{arrow}|{sanitized}|"

    # Only match edge labels: --> or --- followed by |label|
    # This pattern ensures we only sanitize actual edge labels, not node content
    mermaid = re.sub(r'(-->|---)\|([^|]+)\|', sanitize_edge_label, mermaid)

    return mermaid


def classify_validation_errors(
    nodes: list[dict[str, Any]],
    available_models: list[dict[str, Any]] | None = None,
    available_tools: list[dict[str, Any]] | None = None,
    edges: list[dict[str, Any]] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """
    Classify validation errors into fixable and user-required categories.

    This function uses the declarative rule engine to validate nodes.
    The rule engine provides deterministic, testable validation without
    relying on LLM judgment.

    Fixable errors can be automatically corrected by the LLM in subsequent
    iterations. User-required errors need manual intervention.

    Args:
        nodes: List of generated workflow nodes
        available_models: List of models the user has configured
        available_tools: List of available tools
        edges: List of edges connecting nodes

    Returns:
        dict with:
        - "fixable": errors that LLM can fix automatically
        - "user_required": errors that need user intervention
        - "all_warnings": combined warning messages for backwards compatibility
        - "stats": validation statistics
    """
    from core.workflow.generator.validation import ValidationContext, ValidationEngine

    # Build validation context
    context = ValidationContext(
        nodes=nodes,
        edges=edges or [],
        available_models=available_models or [],
        available_tools=available_tools or [],
    )

    # Run validation through rule engine
    engine = ValidationEngine()
    result = engine.validate(context)

    # Convert to legacy format for backwards compatibility
    fixable: list[dict[str, Any]] = []
    user_required: list[dict[str, Any]] = []

    for error in result.fixable_errors:
        fixable.append({
            "node_id": error.node_id,
            "node_type": error.node_type,
            "error_type": error.rule_id,
            "message": error.message,
            "is_fixable": True,
            "fix_hint": error.fix_hint,
            "category": error.category.value,
            "details": error.details,
        })

    for error in result.user_required_errors:
        user_required.append({
            "node_id": error.node_id,
            "node_type": error.node_type,
            "error_type": error.rule_id,
            "message": error.message,
            "is_fixable": False,
            "fix_hint": error.fix_hint,
            "category": error.category.value,
            "details": error.details,
        })

    # Include warnings in user_required (they're non-blocking but informative)
    for error in result.warnings:
        user_required.append({
            "node_id": error.node_id,
            "node_type": error.node_type,
            "error_type": error.rule_id,
            "message": error.message,
            "is_fixable": error.is_fixable,
            "fix_hint": error.fix_hint,
            "category": error.category.value,
            "severity": "warning",
            "details": error.details,
        })

    # Generate combined warnings for backwards compatibility
    all_warnings = [e["message"] for e in fixable + user_required]

    return {
        "fixable": fixable,
        "user_required": user_required,
        "all_warnings": all_warnings,
        "stats": result.stats,
    }


def build_fix_prompt(
    fixable_errors: list[dict[str, Any]],
    previous_nodes: list[dict[str, Any]],
    available_models: list[dict[str, Any]] | None = None,
) -> str:
    """
    Build a prompt for LLM to fix the identified errors.

    This creates a focused instruction that tells the LLM exactly what
    to fix in the previous generation.

    Args:
        fixable_errors: List of errors that can be automatically fixed
        previous_nodes: The nodes from the previous generation attempt
        available_models: Available models for model configuration fixes

    Returns:
        Formatted prompt string for the fix iteration
    """
    if not fixable_errors:
        return ""

    parts = ["<fix_required>"]
    parts.append("  <description>")
    parts.append("    Your previous generation has errors that need fixing.")
    parts.append("    Please regenerate with the following corrections:")
    parts.append("  </description>")

    # Group errors by node
    errors_by_node: dict[str, list[dict[str, Any]]] = {}
    for error in fixable_errors:
        node_id = error["node_id"]
        if node_id not in errors_by_node:
            errors_by_node[node_id] = []
        errors_by_node[node_id].append(error)

    parts.append("  <errors_to_fix>")
    for node_id, node_errors in errors_by_node.items():
        parts.append(f"    <node id=\"{node_id}\">")
        for error in node_errors:
            error_type = error["error_type"]
            message = error["message"]
            fix_hint = error.get("fix_hint", "")
            parts.append(f"      <error type=\"{error_type}\">")
            parts.append(f"        <message>{message}</message>")
            if fix_hint:
                parts.append(f"        <fix_hint>{fix_hint}</fix_hint>")
            parts.append("      </error>")
        parts.append("    </node>")
    parts.append("  </errors_to_fix>")

    # Add model selection help if there are model-related errors
    model_errors = [e for e in fixable_errors if "model" in e["error_type"]]
    if model_errors and available_models:
        parts.append("  <model_selection_help>")
        parts.append("    Use one of these models for nodes requiring model config:")
        for model in available_models[:3]:  # Show top 3
            provider = model.get("provider", "unknown")
            name = model.get("model", "unknown")
            parts.append(f'    - {{"provider": "{provider}", "name": "{name}", "mode": "chat"}}')
        parts.append("  </model_selection_help>")

    # Add previous nodes summary for context
    parts.append("  <previous_nodes_to_fix>")
    for node in previous_nodes:
        node_id = node.get("id", "unknown")
        if node_id in errors_by_node:
            # Only include nodes that have errors
            node_type = node.get("type", "unknown")
            title = node.get("title", "Untitled")
            config_summary = json.dumps(node.get("config", {}), ensure_ascii=False)[:200]
            parts.append(f"    <node id=\"{node_id}\" type=\"{node_type}\" title=\"{title}\">")
            parts.append(f"      <current_config>{config_summary}...</current_config>")
            parts.append("    </node>")
    parts.append("  </previous_nodes_to_fix>")

    parts.append("  <instructions>")
    parts.append("    1. Keep the workflow structure and logic unchanged")
    parts.append("    2. Fix ONLY the errors listed above")
    parts.append("    3. Ensure all required fields are properly filled")
    parts.append("    4. Use variable references {{#node_id.field#}} where appropriate")
    parts.append("  </instructions>")
    parts.append("</fix_required>")

    return "\n".join(parts)


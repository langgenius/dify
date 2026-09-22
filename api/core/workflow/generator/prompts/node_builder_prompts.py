"""Compact prompts for parallel, per-node workflow configuration.

Each call produces only the semantic ``data`` fields for one planned node.
Canvas wrappers, shared labels, topology, layout, and edge defaults are owned
by ``WorkflowGenerator`` so completion length scales with node configuration
rather than with the full ReactFlow graph.
"""

import json
from collections.abc import Iterable
from typing import Any

from core.workflow.generator.prompts.builder_prompts import get_node_config_snippet

_CONTAINER_CONFIG_SNIPPETS = {
    "iteration": """- iteration:
    {"iterator_selector": ["<src>", "<list-var>"],
     "output_selector": ["<last-child>", "<out-var>"],
     "is_parallel": false, "parallel_nums": 10,
     "error_handle_mode": "terminated", "flatten_output": true}
    The runner supplies start_node_id, child wrappers, and the synthetic start node.""",
    "loop": """- loop:
    {"break_conditions": [{"id": "c1",
                            "variable_selector": ["<child>", "<var>"],
                            "comparison_operator": "is",
                            "value": "<value>"}],
     "loop_count": 10, "logical_operator": "and"}
    The runner supplies start_node_id, child wrappers, and the synthetic start node.""",
}

_NODE_BUILDER_HEAD = """You configure exactly ONE node in a Dify workflow.

Return one JSON object with exactly this shape: {"config": {...}}.
``config`` contains only node-type-specific ``data`` fields. Do NOT repeat id,
type, title, desc, selected, position, wrapper fields, edges, or viewport.

Rules:
- Use only ids from the supplied normalized plan.
- Placeholder strings use ``{{#node_id.variable#}}``; selector fields use
  ``["node_id", "variable"]``. Never invent an upstream output. An upstream
  llm node exposes "text", "reasoning_content" and "usage"; each of its
  structured-output fields is one segment deeper —
  ``{{#node_id.structured_output.field#}}`` as a placeholder,
  ``["node_id", "structured_output", "field"]`` as a selector — never the
  flat ``{{#node_id.field#}}`` / ``["node_id", "field"]``.
- Use the selected model verbatim for llm, question-classifier, and
  parameter-extractor nodes.
- Keep prompts/code concise but complete for the user's requested behavior.
- Emit strict JSON only: no prose, Markdown, comments, or trailing commas.

# Target node schema

"""


NODE_BUILDER_USER_PROMPT = """# Target node

id={node_id}, type={node_type}, label={label!r}
purpose={purpose}

# User instruction

{instruction}

{ideal_output_section}{mode_section}{model_section}{tool_catalogue_section}{start_inputs_section}{existing_config_section}{node_outputs_section}\
# Normalized plan and topology

{plan_json}

Return {{"config": {{...}}}} for target node {node_id} now.
"""


def get_node_builder_system_prompt(node_type: str) -> str:
    """Build a one-node prompt containing only that node's semantic schema."""
    snippet = _CONTAINER_CONFIG_SNIPPETS.get(node_type) or get_node_config_snippet(node_type)
    return _NODE_BUILDER_HEAD + (snippet or f"- {node_type}: emit the minimum valid config fields.")


def format_parallel_plan(
    plan_nodes: list[dict[str, Any]],
    plan_edges: list[dict[str, Any]],
    start_inputs: list[dict[str, Any]] | None = None,
) -> str:
    """Serialize the shared plan compactly so every node call has graph context.

    ``start_inputs`` rides along so downstream builders reference the declared
    ``{{#<start-id>.<variable>#}}`` names instead of guessing them from prose
    — a guessed name gets auto-injected as a spurious form input later.

    The planner's declared producer outputs deliberately do NOT ride here:
    serialised raw they would give every consumer an llm producer's schema
    fields flat, which is the one reference form the engine cannot resolve.
    ``format_node_outputs_section`` renders them per call instead, where the
    node's type is known.
    """
    payload: dict[str, Any] = {"nodes": plan_nodes, "edges": plan_edges}
    if start_inputs:
        payload["start_inputs"] = start_inputs
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def format_mode_section(mode: str) -> str:
    """Tell each builder which app mode it is configuring for.

    Matters most in advanced-chat, where ``sys.query`` / ``sys.files`` are the
    sanctioned way to reference the user's message — without this the model
    invents start-node variables that postprocess then materializes as
    spurious form inputs.
    """
    if mode == "advanced-chat":
        return (
            "# App mode\n\n"
            "advanced-chat: the user's chat message is available as sys.query and uploaded files "
            'as sys.files — placeholder {{#sys.query#}}, selector ["sys", "query"]. Reference them '
            "directly; do NOT invent start-node variables for the chat message.\n\n"
        )
    return (
        "# App mode\n\n"
        "workflow: there are NO automatic system variables; reference user input only through "
        "the start node's declared variables.\n\n"
    )


def format_start_inputs_section(start_inputs: list[dict[str, Any]]) -> str:
    """Render planner-declared inputs for the start-node builder only."""
    if not start_inputs:
        return ""
    lines = ["# Start inputs (copy each entry verbatim into start.data.variables)", ""]
    for input_ in start_inputs:
        variable = str(input_.get("variable") or "").strip()
        if not variable:
            continue
        label = str(input_.get("label") or "").strip()
        type_ = str(input_.get("type") or "paragraph").strip()
        lines.append(f"- variable={variable!r}  label={label!r}  type={type_!r}")
    lines.append("")
    return "\n".join(lines) + "\n"


def format_node_outputs_section(
    node_outputs: dict[str, list[str]] | None,
    target_node_id: str,
    node_types: dict[str, str] | None = None,
) -> str:
    """Render the planner's declared producer outputs for one builder call.

    Two halves, both needed: the target node is told to expose exactly the
    names the plan promised on its behalf, and every other declared node is
    listed so this node references only names that will really exist.

    ``node_types`` (plan node id -> node type) makes the consumer half
    type-aware, which it must be: an ``llm`` producer's declared names are its
    structured-output SCHEMA FIELDS, and the engine publishes those under one
    ``structured_output`` object. Listing them flat would hand every consumer
    ``{{#<id>.<field>#}}`` — precisely the reference the engine can never
    resolve. A node whose type we don't know is listed as-is; only the four
    declaring types ever reach here, and the other three name their outputs
    flat.

    Returns an empty string when there is nothing to say, keeping the prompt
    identical to the one a plan without the key has always produced.
    """
    if not node_outputs:
        return ""
    types = node_types or {}
    body: list[str] = []
    own = node_outputs.get(target_node_id) or []
    if own:
        body.append(
            "This node MUST expose exactly these output names, spelled exactly: "
            + _quoted_names(own)
            + " (a code node's ``outputs`` keys, a parameter-extractor's parameter names, a "
            "human-input input's ``output_variable_name``, an llm's ``structured_output`` schema fields)."
        )
    others = [(node_id, names) for node_id, names in node_outputs.items() if node_id != target_node_id and names]
    if others:
        body.append("These nodes expose exactly the names below — reference no other name on them:")
        for node_id, names in others:
            if types.get(node_id) == "llm":
                # Schema fields live under the node's ``structured_output``
                # object: 3 segments, never flat.
                body.append(
                    f"- {node_id} (llm structured output): "
                    + _quoted_names(f"structured_output.{name}" for name in names)
                )
            else:
                body.append(f"- {node_id}: " + _quoted_names(names))
    if not body:
        return ""
    return "\n".join(["# Declared outputs (the plan's contract — binding)", "", *body, ""]) + "\n"


def _quoted_names(names: Iterable[str]) -> str:
    """Render output names as a readable, unambiguous comma-separated list."""
    return ", ".join(repr(name) for name in names)


def format_tool_catalogue_section(catalogue_text: str) -> str:
    """Render the legacy full catalogue when no structured selection exists."""
    if not catalogue_text.strip():
        return ""
    return (
        "# Available installed tools (use these exact provider/tool identifiers — "
        "set provider_id and provider_name to the provider portion and "
        "tool_name to the tool portion)\n\n"
        f"{catalogue_text}\n\n"
    )

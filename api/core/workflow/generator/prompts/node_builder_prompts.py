"""Compact prompts for parallel, per-node workflow configuration.

Each call produces only the semantic ``data`` fields for one planned node.
Canvas wrappers, shared labels, topology, layout, and edge defaults are owned
by ``WorkflowGenerator`` so completion length scales with node configuration
rather than with the full ReactFlow graph.
"""

import json
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
  ``["node_id", "variable"]``. Never invent an upstream output.
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

{ideal_output_section}{model_section}{tool_catalogue_section}{start_inputs_section}{existing_config_section}\
# Normalized plan and topology

{plan_json}

Return {{"config": {{...}}}} for target node {node_id} now.
"""


def get_node_builder_system_prompt(node_type: str) -> str:
    """Build a one-node prompt containing only that node's semantic schema."""
    snippet = _CONTAINER_CONFIG_SNIPPETS.get(node_type) or get_node_config_snippet(node_type)
    return _NODE_BUILDER_HEAD + (snippet or f"- {node_type}: emit the minimum valid config fields.")


def format_parallel_plan(plan_nodes: list[dict[str, Any]], plan_edges: list[dict[str, Any]]) -> str:
    """Serialize the shared plan compactly so every node call has graph context."""
    return json.dumps({"nodes": plan_nodes, "edges": plan_edges}, ensure_ascii=False, separators=(",", ":"))

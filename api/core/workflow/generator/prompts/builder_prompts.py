"""
Builder prompts.

The builder is the second step of the slim planner→builder pipeline. It takes
the planner's high-level node list and emits the *full* graph JSON consumed by
``WorkflowService.sync_draft_workflow``.

The builder owns: node configuration (prompts, code, headers, etc.), edge wiring,
handle ids ("source"/"target"), positions, and the viewport. It is the only
prompt that needs to know the concrete shape of each node type — keep its
examples accurate or the LLM will invent fields.
"""

from typing import Any

# Concise per-node-type configuration cheatsheet. We deliberately keep this
# short — the postprocessor in ``runner.py`` fills missing defaults, so the LLM
# only needs to commit to the fields that carry semantic meaning.
NODE_CONFIG_CHEATSHEET = """\
## Node configuration cheatsheet

All nodes share these "data" fields:
    {"type": "<node-type>", "title": "<label>", "desc": "<one-liner>", "selected": false}

Per type, ALSO include:

- start:
    {"variables": [
        {"variable": "query", "label": "Query", "type": "paragraph",
         "required": true, "max_length": 4096, "options": []}
    ]}
- end:
    {"outputs": [
        {"variable": "result", "value_selector": ["<source-node-id>", "<output-var>"]}
    ]}
- answer:
    {"answer": "{{#<source-node-id>.<output-var>#}}"}
- llm:
    {"model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {"temperature": 0.7}},
     "prompt_template": [
       {"role": "system", "text": "You are a helpful assistant."},
       {"role": "user",   "text": "<task instruction with {{#node.var#}} placeholders>"}
     ],
     "context": {"enabled": false, "variable_selector": []},
     "vision": {"enabled": false},
     "structured_output_enabled": false}
- knowledge-retrieval:
    {"query_variable_selector": ["<src-node>", "<var>"],
     "dataset_ids": [],
     "retrieval_mode": "multiple",
     "multiple_retrieval_config": {"top_k": 4, "score_threshold": null, "reranking_enable": false}}
- code:
    {"code_language": "python3",
     "code": "def main(arg1: str) -> dict:\\n    return {'result': arg1}",
     "variables": [{"variable": "arg1", "value_selector": ["<src-node>", "<var>"]}],
     "outputs": {"result": {"type": "string", "children": null}}}
- template-transform:
    {"template": "Hello {{ name }}",
     "variables": [{"variable": "name", "value_selector": ["<src-node>", "<var>"]}]}
- http-request:
    {"method": "get", "url": "https://example.com",
     "authorization": {"type": "no-auth", "config": null},
     "headers": "", "params": "", "body": {"type": "none", "data": []},
     "timeout": {"max_connect_timeout": 0, "max_read_timeout": 0, "max_write_timeout": 0}}
- tool:
    {"provider_id": "<provider>", "provider_type": "builtin", "provider_name": "<provider>",
     "tool_name": "<tool>", "tool_label": "<Tool>", "tool_configurations": {},
     "tool_parameters": {"<param>": {"type": "mixed", "value": "{{#<src-node>.<var>#}}"}}}
- if-else:
    {"logical_operator": "and",
     "cases": [
       {"case_id": "true",
        "logical_operator": "and",
        "conditions": [{"id": "c1", "variable_selector": ["<src>", "<var>"],
                       "comparison_operator": "is", "value": "<value>"}]}
     ]}
- question-classifier:
    {"query_variable_selector": ["<src>", "<var>"],
     "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
     "classes": [{"id": "class1", "name": "Class 1"}, {"id": "class2", "name": "Class 2"}],
     "instruction": ""}
- parameter-extractor:
    {"query": [["<src>", "<var>"]],
     "model": {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}},
     "parameters": [{"name": "topic", "type": "string", "description": "...", "required": true}],
     "instruction": "", "reasoning_mode": "function_call"}

## Edge handles

- Most nodes:      source handle "source", target handle "target".
- if-else cases:   source handle is the case_id ("true" / "false" / "<custom>").
- question-classifier: source handle is the class_id ("class1" / ...).
"""


_BASE_SYSTEM_PROMPT_HEAD = """You are a Dify workflow builder.

You are given:
  1. A user instruction (what the workflow should do).
  2. A node plan from the planner (which nodes to use, in execution order).

Your job: emit a complete Dify workflow graph as JSON. The graph will be written
directly into a Studio draft, so it must be syntactically valid and structurally
correct.

# Hard rules

1. The output is a single JSON object — no prose, no Markdown, no code fences.
2. Use the EXACT node IDs from the plan, formatted as "node-1", "node-2", ... in
   plan order. Edge "source"/"target" must reference these IDs.
3. Every node has top-level fields: id, type, position, data.
   - "type" is always "custom" (ReactFlow node renderer).
   - "data.type" is the actual node type ("llm", "start", etc.).
4. Every edge has top-level fields: id, source, target, type, sourceHandle, targetHandle.
   - "type" is always "custom".
   - "sourceHandle"/"targetHandle" follow the cheatsheet (default: "source"/"target").
   - Edge id format: "<source>-<sourceHandle>-<target>-<targetHandle>".
5. Use the model from the planner context for ALL "llm" / "question-classifier" /
   "parameter-extractor" nodes (provider, name, mode, completion_params).
6. Reference upstream outputs with {#<node-id>.<output-var>#} (literal `{# … #}`)
   inside prompts/templates, and ["<node-id>", "<output-var>"] for variable_selectors.
7. The "start" node owns input variables; downstream nodes reference them as
   ["<start-node-id>", "<var-name>"] for selectors or {#<start-node-id>.<var-name>#}
   inside prompt strings.

"""


_BASE_SYSTEM_PROMPT_TAIL = """\

# Layout

- Place nodes left-to-right with x=80 + 320 * index, y=280.
- Viewport: {"x": 0, "y": 0, "zoom": 0.7}.

"""


_BASE_SYSTEM_PROMPT_FOOTER = """

# Output schema

{
  "nodes": [...],
  "edges": [...],
  "viewport": {"x": 0, "y": 0, "zoom": 0.7}
}
"""


_WORKFLOW_MODE_RULES = """# Mode-specific rules — Workflow

- The graph MUST start with exactly one "start" node and end with exactly one "end" node.
- Do NOT use "answer" nodes (those are for Advanced Chat only).
- The "end" node's outputs[].value_selector must point at a real upstream output.
"""


_ADVANCED_CHAT_MODE_RULES = """# Mode-specific rules — Advanced Chat (Chatflow)

- The graph MUST start with exactly one "start" node and end with exactly one "answer" node.
- Do NOT use "end" nodes (those are for plain Workflow apps).
- The "start" node should expose "sys.query" / "sys.files" automatically; user-defined
  variables go in start.data.variables.
- The "answer" node's "answer" field references upstream outputs as
  {{#<node-id>.<var>#}} and is what the user sees in chat.
"""


BUILDER_SYSTEM_PROMPT_WORKFLOW = (
    _BASE_SYSTEM_PROMPT_HEAD
    + _WORKFLOW_MODE_RULES
    + _BASE_SYSTEM_PROMPT_TAIL
    + NODE_CONFIG_CHEATSHEET
    + _BASE_SYSTEM_PROMPT_FOOTER
)

BUILDER_SYSTEM_PROMPT_ADVANCED_CHAT = (
    _BASE_SYSTEM_PROMPT_HEAD
    + _ADVANCED_CHAT_MODE_RULES
    + _BASE_SYSTEM_PROMPT_TAIL
    + NODE_CONFIG_CHEATSHEET
    + _BASE_SYSTEM_PROMPT_FOOTER
)


BUILDER_USER_PROMPT = """# User instruction

{instruction}

{ideal_output_section}\
# Selected model (use for all LLM-based nodes)

provider={provider}, name={name}, mode={mode_label}

# Node plan (from planner — use these labels and node_types in this order)

{plan_block}

Now emit the complete workflow graph JSON.
"""


def format_plan_block(plan_nodes: list[dict[str, Any]]) -> str:
    """Render the planner output as a numbered list the builder can quote."""
    lines = []
    for idx, node in enumerate(plan_nodes, start=1):
        node_id = f"node-{idx}"
        label = node.get("label", "")
        node_type = node.get("node_type", "")
        purpose = node.get("purpose", "")
        lines.append(f"{idx}. id={node_id}  type={node_type}  label={label!r}\n   purpose: {purpose}")
    return "\n".join(lines)


def get_builder_system_prompt(mode: str) -> str:
    """Pick the system prompt branch for Workflow vs Advanced Chat."""
    if mode == "advanced-chat":
        return BUILDER_SYSTEM_PROMPT_ADVANCED_CHAT
    return BUILDER_SYSTEM_PROMPT_WORKFLOW

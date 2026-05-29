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

# Per-node-type configuration cheatsheet.
#
# Each entry mirrors the production ``defaultValue`` from
# ``web/app/components/workflow/nodes/<type>/default.ts`` so the generated
# graph loads in Studio identically to a manually-created node and survives
# both ``WorkflowService.sync_draft_workflow``'s structural checks and the
# runtime entity validation each node performs when the workflow runs.
#
# The postprocessor in ``runner.py`` fills missing wrapper fields (``type``,
# ``positionAbsolute``, ``width``, ``height``, ``sourcePosition`` /
# ``targetPosition``, edge ``data.sourceType`` / ``data.targetType``), so the
# LLM only needs to emit semantically meaningful fields.
NODE_CONFIG_CHEATSHEET = """\
## Node wrapper (every node, top-level)

    {"id": "node-N",
     "type": "custom",                # ReactFlow renderer key. Iteration/loop
                                      # *start* children use special types
                                      # (see Containers below).
     "position": {"x": <number>, "y": <number>},
     "data": { ... per-type fields ... }}

Children of iteration / loop containers additionally need
``parentId``, ``zIndex: 1002`` and ``extent: "parent"`` — see Containers.

## Shared "data" fields (every node)

    {"type": "<node-type>",          # e.g. "llm", "start", "if-else"
     "title": "<short label>",
     "desc": "<one-liner>",
     "selected": false}

## Per type — additional "data" fields

- start:
    {"variables": []}
    Optional inputs: each is
      {"variable": "query", "label": "Query", "type": "paragraph",
       "required": true, "max_length": 4096, "options": []}
    (types: text-input | paragraph | select | number | file | file-list)

- end (Workflow mode only):
    {"outputs": [
        {"variable": "result", "value_selector": ["<src-node-id>", "<out-var>"]}
    ]}

- answer (Advanced Chat mode only):
    {"variables": [],
     "answer": "<text with {{#<src>.<var>#}} placeholders>"}

- llm:
    {"model": {"provider": "<provider>", "name": "<model>", "mode": "chat",
               "completion_params": {"temperature": 0.7}},
     "prompt_template": [
       {"role": "system", "text": "<system prompt>"},
       {"role": "user",   "text": "<user prompt with {{#<src>.<var>#}}>"}
     ],
     "context": {"enabled": false, "variable_selector": []},
     "vision": {"enabled": false}}

- knowledge-retrieval:
    {"query_variable_selector": ["<src>", "<var>"],
     "query_attachment_selector": [],
     "dataset_ids": [],
     "retrieval_mode": "multiple",
     "multiple_retrieval_config": {"top_k": 4, "score_threshold": null,
                                   "reranking_enable": false}}

- code  (escape hatch — only if no installed tool fits):
    {"code_language": "python3",
     "code": "def main(arg1: str) -> dict:\\n    return {'result': arg1}",
     "variables": [{"variable": "arg1", "value_selector": ["<src>", "<var>"]}],
     "outputs": {"result": {"type": "string", "children": null}}}

- template-transform:
    {"template": "Hello {{ name }}",
     "variables": [{"variable": "name", "value_selector": ["<src>", "<var>"]}]}

- http-request  (escape hatch — only if no installed tool fits):
    {"variables": [], "method": "get", "url": "https://example.com",
     "authorization": {"type": "no-auth", "config": null},
     "headers": "", "params": "",
     "body": {"type": "none", "data": []},
     "ssl_verify": true,
     "timeout": {"max_connect_timeout": 0, "max_read_timeout": 0,
                 "max_write_timeout": 0},
     "retry_config": {"retry_enabled": true, "max_retries": 3,
                      "retry_interval": 100}}

- tool  (PREFERRED for external actions when listed in Available tools):
    {"provider_id": "<provider>",            # provider portion of provider/tool
     "provider_type": "builtin",             # exact value from catalogue
     "provider_name": "<provider>",          # usually same as provider_id
     "tool_name": "<tool>",                  # tool portion of provider/tool
     "tool_label": "<Tool>",
     "tool_node_version": "2",
     "tool_configurations": {},
     "tool_parameters": {"<param>": {"type": "mixed",
                                     "value": "{{#<src>.<var>#}}"}}}
    Parameter ``type`` is one of:
      "mixed"    — string template referencing variables ({{#...#}})
      "variable" — direct reference, value is ["<src>", "<var>"]
      "constant" — literal value

- if-else:
    {"_targetBranches": [{"id": "true", "name": "IF"},
                         {"id": "false", "name": "ELSE"}],
     "logical_operator": "and",
     "cases": [
       {"case_id": "true",
        "logical_operator": "and",
        "conditions": [{"id": "c1",
                        "variable_selector": ["<src>", "<var>"],
                        "comparison_operator": "is",
                        "value": "<value>"}]}
     ]}
    Source handle for downstream edges = the case_id ("true" / "false").

- question-classifier:
    {"query_variable_selector": ["<src>", "<var>"],
     "model": {"provider": "<p>", "name": "<m>", "mode": "chat",
               "completion_params": {"temperature": 0.7}},
     "classes": [{"id": "1", "name": "Topic A", "label": "CLASS 1"},
                 {"id": "2", "name": "Topic B", "label": "CLASS 2"}],
     "_targetBranches": [{"id": "1", "name": ""}, {"id": "2", "name": ""}],
     "vision": {"enabled": false},
     "instruction": ""}
    Source handle for downstream edges = the class_id ("1" / "2" / ...).

- parameter-extractor:
    {"query": [["<src>", "<var>"]],          # array of value_selector arrays
     "model": {"provider": "<p>", "name": "<m>", "mode": "chat",
               "completion_params": {"temperature": 0.7}},
     "parameters": [{"name": "topic", "type": "string",
                     "description": "<purpose>", "required": true}],
     "reasoning_mode": "prompt",
     "vision": {"enabled": false},
     "instruction": ""}

## Containers — iteration / loop

These are SUBGRAPH nodes. To use one you MUST emit, in order:

1. The container node itself, e.g. for iteration:
       id: "node-K"
       type: "custom"
       data: {"type": "iteration",
              "title": "<label>",
              "desc": "",
              "selected": false,
              "start_node_id": "node-Kstart",
              "iterator_selector": ["<src>", "<list-var>"],
              "output_selector": ["<inner-last-node>", "<out-var>"],
              "is_parallel": false,
              "parallel_nums": 10,
              "error_handle_mode": "terminated",
              "flatten_output": true}
       width: 808
       height: 204
       zIndex: 1

   For loop, swap "iteration" → "loop" and use:
       data: {"type": "loop", "title": "...", "desc": "",
              "selected": false, "start_node_id": "node-Kstart",
              "break_conditions": [], "loop_count": 10,
              "logical_operator": "and"}

2. The auto-start child (one per container):
       id: "node-Kstart"
       type: "custom-iteration-start"          # loop → "custom-loop-start"
       parentId: "node-K"
       extent: "parent"
       draggable: false
       selectable: false
       zIndex: 1002
       position: {"x": 60, "y": 78}            # relative to parent
       data: {"type": "iteration-start",       # loop → "loop-start"
              "title": "", "desc": "",
              "isInIteration": true,           # loop → "isInLoop": true
              "selected": false}

3. Each inner-pipeline node (any node type, follows normal data rules) MUST add:
       parentId: "node-K"
       extent: "parent"
       zIndex: 1002
       position: {x, y}                         # relative to parent
       data: {..., "isInIteration": true,       # loop → "isInLoop": true
              "iteration_id": "node-K"}         # loop → "loop_id"

4. Edges INSIDE a container must add to ``data``:
       "isInIteration": true                    # loop → "isInLoop": true
       "iteration_id": "node-K"                 # loop → "loop_id"
   and use ``zIndex: 1002``. Edges OUTSIDE containers use the default
   ``isInIteration: false`` / ``isInLoop: false``.

5. The container's incoming/outgoing edges connect to the container's id
   (``node-K``), NOT to inner nodes. The first inner edge connects from
   ``node-Kstart``.

## Edge handles

- Most nodes:           sourceHandle "source", targetHandle "target".
- if-else cases:        sourceHandle is the case_id ("true" / "false" / ...).
- question-classifier:  sourceHandle is the class_id ("1" / "2" / ...).
- iteration-start /     sourceHandle "source"; the edge from the *start node
  loop-start:           is what kicks off the first inner step.
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
8. NEVER emit "code" or "http-request" nodes if a tool from the "Available tools"
   section below covers the same task — replace them with a "tool" node referencing
   the exact provider/tool identifier from the catalogue. "code" / "http-request"
   are last-resort escape hatches for arbitrary transformations and APIs that no
   installed tool can express.

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

{tool_catalogue_section}\
# Node plan (from planner — use these labels and node_types in this order)

{plan_block}

Now emit the complete workflow graph JSON.
"""


def format_builder_tool_catalogue_section(catalogue_text: str) -> str:
    """
    Builder-facing catalogue block. The builder needs the same identifiers
    the planner saw, plus a stern reminder that ``tool`` nodes MUST set
    ``provider_id`` / ``provider_name`` / ``tool_name`` to entries that
    actually exist in this list — hallucinated tools fail at draft sync.
    """
    if not catalogue_text.strip():
        return ""
    return (
        "# Available tools (use these exact provider/tool identifiers — "
        "for each 'tool' node, set provider_id and provider_name to the "
        "provider portion and tool_name to the tool portion)\n\n"
        f"{catalogue_text}\n\n"
    )


def format_plan_block(plan_nodes: list[dict[str, Any]]) -> str:
    """
    Render the planner output as a numbered list the builder can quote.

    For container children (planner emitted a ``"parent": "<label>"`` key),
    we resolve the parent label to its ``node-N`` id and surface it on the
    same line so the builder knows to set ``parentId`` and the
    ``isInIteration`` / ``isInLoop`` markers on inner nodes.
    """
    # First pass: label → node-id so we can resolve "parent" hints.
    label_to_id: dict[str, str] = {}
    for idx, node in enumerate(plan_nodes, start=1):
        label = str(node.get("label") or "")
        if label and label not in label_to_id:
            label_to_id[label] = f"node-{idx}"

    lines = []
    for idx, node in enumerate(plan_nodes, start=1):
        node_id = f"node-{idx}"
        label = node.get("label", "")
        node_type = node.get("node_type", "")
        purpose = node.get("purpose", "")
        parent_label = str(node.get("parent") or "")
        parent_clause = ""
        if parent_label:
            parent_id = label_to_id.get(parent_label, "")
            if parent_id:
                parent_clause = f"  parent={parent_id}"
            else:
                parent_clause = f"  parent={parent_label!r}"
        lines.append(
            f"{idx}. id={node_id}  type={node_type}  label={label!r}{parent_clause}\n   purpose: {purpose}"
        )
    return "\n".join(lines)


def get_builder_system_prompt(mode: str) -> str:
    """Pick the system prompt branch for Workflow vs Advanced Chat."""
    if mode == "advanced-chat":
        return BUILDER_SYSTEM_PROMPT_ADVANCED_CHAT
    return BUILDER_SYSTEM_PROMPT_WORKFLOW

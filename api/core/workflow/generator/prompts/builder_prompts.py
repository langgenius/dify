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

import json
from collections.abc import Iterable
from typing import Any

# Per-node-type configuration cheatsheet.
#
# Each entry mirrors the production ``defaultValue`` from
# ``web/app/components/workflow/nodes/<type>/default.ts`` so the generated
# graph loads in Studio identically to a manually-created node and survives
# both ``WorkflowService.sync_draft_workflow``'s structural checks and the
# runtime entity validation each node performs when the workflow runs.
#
# The cheatsheet is assembled DYNAMICALLY per request: the planner decides
# which node types the workflow needs, and ``build_node_config_cheatsheet``
# stitches together only the snippets for those types (plus the always-needed
# wrapper / shared-field / edge-handle preamble, and the containers section
# when an iteration / loop is planned). This keeps the builder prompt tight —
# a 3-node summariser no longer carries the schema for 12 unrelated node
# types — and lets each snippet document its FULL schema (e.g. a "file" start
# variable's required ``allowed_file_types``) without bloating every prompt.
#
# The postprocessor in ``runner.py`` fills missing wrapper fields (``type``,
# ``positionAbsolute``, ``width``, ``height``, ``sourcePosition`` /
# ``targetPosition``, edge ``data.sourceType`` / ``data.targetType``), so the
# LLM only needs to emit semantically meaningful fields.

# Always-included preamble: the node/edge wrapper shape and the shared
# ``data`` fields that apply to every node type, plus the "## Per type" header
# the per-type snippets slot under.
_CHEATSHEET_PREAMBLE = """\
## Node wrapper (every node, top-level)

    {"id": "node1" (digits + letters only — see "Node IDs" below),
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

## Per type — additional "data" fields (only the node types in your plan are shown)"""


# node_type → its per-type schema snippet. Keyed by the exact ``node_type``
# string the planner emits so ``build_node_config_cheatsheet`` can look each
# one up directly. Iteration / loop are documented in the Containers section
# (they are subgraphs, not leaf nodes) rather than here.
_NODE_SNIPPETS: dict[str, str] = {
    "start": """\
- start:
    {"variables": [
       {"variable": "url",   "label": "URL",   "type": "text-input",
        "required": true,  "max_length": 256,  "options": []},
       {"variable": "topic", "label": "Topic", "type": "paragraph",
        "required": false, "max_length": 4096, "options": []},
       {"variable": "doc",   "label": "Document", "type": "file",
        "required": true,
        "allowed_file_types": ["document"],
        "allowed_file_upload_methods": ["local_file", "remote_url"],
        "allowed_file_extensions": []}
    ]}
    EVERY user-supplied value referenced by a downstream node
    (``{{#node-id.var#}}`` in a prompt / answer / template, or
    ``["node-id", "var"]`` in a value_selector / iterator_selector /
    tool_parameters) MUST be declared here as an entry of ``variables``.
    If the planner's ``start_inputs`` list is non-empty, use it verbatim
    (the user prompt section "Start inputs" surfaces it). Types:
    text-input | paragraph | select | number | file | file-list.
    For a "file" or "file-list" variable you MUST also set
    ``allowed_file_types`` to a NON-EMPTY subset of
    ["document", "image", "audio", "video", "custom"] — it is a REQUIRED
    field and the draft fails to load (showing "supported file types is
    required") without it. Choose by purpose: ["document"] for text
    extraction (PDF / Word / PPT / Markdown / …), ["image"] for vision,
    etc. Always set ``allowed_file_upload_methods`` to
    ["local_file", "remote_url"]. Only when you include "custom" must you
    also set ``allowed_file_extensions`` to a non-empty list like
    [".epub", ".rtf"]; otherwise leave it [].
    In Advanced-Chat mode ``sys.query`` and ``sys.files`` are automatic
    system variables — downstream nodes may reference them; do NOT add
    them to ``variables``.""",
    "end": """\
- end (Workflow mode only):
    {"outputs": [
        {"variable": "result", "value_selector": ["<src-node-id>", "<out-var>"]}
    ]}""",
    "answer": """\
- answer (Advanced Chat mode only):
    {"variables": [],
     "answer": "<text with {{#<src>.<var>#}} placeholders>"}""",
    "llm": """\
- llm:
    {"model": {"provider": "<provider>", "name": "<model>", "mode": "chat",
               "completion_params": {"temperature": 0.7}},
     "prompt_template": [
       {"role": "system", "text": "<system prompt>"},
       {"role": "user",   "text": "<user prompt with {{#<src>.<var>#}}>"}
     ],
     "context": {"enabled": false, "variable_selector": []},
     "vision": {"enabled": false}}

    Prompt-writing rules for the user-message text:
      * ``{{#node.var#}}`` placeholders are interpolated by Dify BEFORE the
        LLM sees them — at run time the model only sees the resolved value.
        So an instruction like "Translate this: {{#node1.text#}}" is read
        by the LLM as "Translate this: <the actual text>".
      * NEVER include placeholder syntax inside an "example output" block
        in your prompt — the LLM will treat the example as the literal
        answer template and echo placeholders back as output. Wrong:
            Output JSON: {"en": "{{#node1.text#}}", "es": "{{#node1.text#}}"}
        Right:
            Translate the input into English, Spanish, French, German.
            Output a JSON object with keys "en", "es", "fr", "de" whose
            values are the translations.
            Input: {{#node1.text#}}
      * Each placeholder only resolves the variable from its source node —
        it cannot be a Jinja template or call a function.""",
    "knowledge-retrieval": """\
- knowledge-retrieval:
    {"query_variable_selector": ["<src>", "<var>"],
     "query_attachment_selector": [],
     "dataset_ids": [],
     "retrieval_mode": "multiple",
     "multiple_retrieval_config": {"top_k": 4, "score_threshold": null,
                                   "reranking_enable": false}}""",
    "code": """\
- code  (escape hatch — only if no installed tool fits):
    {"code_language": "python3",
     "code": "def main(arg1: str) -> dict:\\n    return {'result': arg1}",
     "variables": [{"variable": "arg1", "value_selector": ["<src>", "<var>"]}],
     "outputs": {"result": {"type": "string", "children": null}}}""",
    "template-transform": """\
- template-transform:
    {"template": "Hello {{ name }}",
     "variables": [{"variable": "name", "value_selector": ["<src>", "<var>"]}]}""",
    "http-request": """\
- http-request  (escape hatch — only if no installed tool fits):
    {"variables": [], "method": "get", "url": "https://example.com",
     "authorization": {"type": "no-auth", "config": null},
     "headers": "", "params": "",
     "body": {"type": "none", "data": []},
     "ssl_verify": true,
     "timeout": {"max_connect_timeout": 0, "max_read_timeout": 0,
                 "max_write_timeout": 0},
     "retry_config": {"retry_enabled": true, "max_retries": 3,
                      "retry_interval": 100}}""",
    "tool": """\
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
      "constant" — literal value""",
    "if-else": """\
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
    Source handle for downstream edges = the case_id ("true" / "false").""",
    "question-classifier": """\
- question-classifier:
    {"query_variable_selector": ["<src>", "<var>"],
     "model": {"provider": "<p>", "name": "<m>", "mode": "chat",
               "completion_params": {"temperature": 0.7}},
     "classes": [{"id": "1", "name": "Topic A", "label": "CLASS 1"},
                 {"id": "2", "name": "Topic B", "label": "CLASS 2"}],
     "_targetBranches": [{"id": "1", "name": ""}, {"id": "2", "name": ""}],
     "vision": {"enabled": false},
     "instruction": ""}
    Source handle for downstream edges = the class_id ("1" / "2" / ...).""",
    "parameter-extractor": """\
- parameter-extractor:
    {"query": [["<src>", "<var>"]],          # array of value_selector arrays
     "model": {"provider": "<p>", "name": "<m>", "mode": "chat",
               "completion_params": {"temperature": 0.7}},
     "parameters": [{"name": "topic", "type": "string",
                     "description": "<purpose>", "required": true}],
     "reasoning_mode": "prompt",
     "vision": {"enabled": false},
     "instruction": ""}""",
    "document-extractor": """\
- document-extractor:
    {"variable_selector": ["<src>", "<file-var>"],   # a file / file-list input
     "is_array_file": false}                          # true when the input is a
                                                      # file-list (array of files)
    Single output variable ``text``: a string when ``is_array_file`` is false,
    an array of strings (one per file) when it is true. ``variable_selector``
    MUST point at a ``start`` variable declared with type "file" / "file-list"
    (or ``sys.files`` in Advanced-Chat mode). That start variable MUST set a
    non-empty ``allowed_file_types`` (use ["document"] for document text).""",
    "variable-aggregator": """\
- variable-aggregator  (merge mutually-exclusive branches into one output):
    {"output_type": "string",        # VarType of the merged value — one of
                                     # string | number | object | array[string] |
                                     # array[number] | array[object] | file |
                                     # array[file] | any. Match the branch vars.
     "variables": [["<branchA-node>", "<var>"],
                   ["<branchB-node>", "<var>"]]}
    Output variable: ``output`` (the first branch that actually ran). Place it
    after an ``if-else`` / ``question-classifier`` to rejoin paths before the
    ``end`` / ``answer`` node. Each entry of ``variables`` is a value_selector
    array, NOT a placeholder string.""",
    "list-operator": """\
- list-operator  (filter / sort / slice an array variable):
    {"variable": ["<src>", "<array-var>"],
     "filter_by": {"enabled": false, "conditions": []},
     "extract_by": {"enabled": false, "serial": "1"},
     "order_by": {"enabled": false, "key": "", "value": "asc"},
     "limit": {"enabled": false, "size": 10}}
    Enable only the sub-features you need; ``conditions`` reuse the if-else
    condition shape (key / comparison_operator / value). Outputs: ``result``
    (the processed array), ``first_record``, ``last_record``.""",
}


# Pulled into the cheatsheet only when an iteration / loop appears in the plan.
_CONTAINERS_SECTION = """\
## Containers — iteration / loop

These are SUBGRAPH nodes. To use one you MUST emit, in order:

1. The container node itself, e.g. for iteration:
       id: "nodeK"
       type: "custom"
       data: {"type": "iteration",
              "title": "<label>",
              "desc": "",
              "selected": false,
              "start_node_id": "nodeKstart",
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
              "selected": false, "start_node_id": "nodeKstart",
              "break_conditions": [], "loop_count": 10,
              "logical_operator": "and"}

2. The auto-start child (one per container):
       id: "nodeKstart"
       type: "custom-iteration-start"          # loop → "custom-loop-start"
       parentId: "nodeK"
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
       parentId: "nodeK"
       extent: "parent"
       zIndex: 1002
       position: {x, y}                         # relative to parent
       data: {..., "isInIteration": true,       # loop → "isInLoop": true
              "iteration_id": "nodeK"}         # loop → "loop_id"

4. Edges INSIDE a container must add to ``data``:
       "isInIteration": true                    # loop → "isInLoop": true
       "iteration_id": "nodeK"                 # loop → "loop_id"
   and use ``zIndex: 1002``. Edges OUTSIDE containers use the default
   ``isInIteration: false`` / ``isInLoop: false``.

5. The container's incoming/outgoing edges connect to the container's id
   (``nodeK``), NOT to inner nodes. The first inner edge connects from
   ``nodeKstart``."""


# Always-included trailer: edge handle conventions for every graph.
_EDGE_HANDLES_SECTION = """\
## Edge handles

- Most nodes:           sourceHandle "source", targetHandle "target".
- if-else cases:        sourceHandle is the case_id ("true" / "false" / ...).
- question-classifier:  sourceHandle is the class_id ("1" / "2" / ...).
- iteration-start /     sourceHandle "source"; the edge from the *start node
  loop-start:           is what kicks off the first inner step."""


# Container node types are described in ``_CONTAINERS_SECTION`` rather than as
# leaf snippets; their presence in a plan pulls that section in.
_CONTAINER_NODE_TYPES = frozenset({"iteration", "loop"})


def build_node_config_cheatsheet(node_types: Iterable[str] | None = None) -> str:
    """
    Assemble the builder cheatsheet for exactly the node types in the plan.

    ``node_types`` is the set of ``node_type`` strings the planner chose. We
    emit the always-on preamble (wrapper / shared fields), then only the
    per-type snippets for the requested types (``start`` is always included —
    every graph has one), the Containers section when an iteration / loop is
    planned, and the edge-handles trailer. Unknown / unrecognised type strings
    are ignored (the runtime / structural validator catches genuinely bogus
    types).

    ``None`` returns the FULL cheatsheet (every snippet + containers) — used to
    build the static back-compat constants below and as a safe fallback.
    """
    if node_types is None:
        requested: set[str] = set(_NODE_SNIPPETS) | set(_CONTAINER_NODE_TYPES)
    else:
        requested = {str(t).strip() for t in node_types if str(t).strip()}
        requested.add("start")  # every workflow has exactly one start node

    parts: list[str] = [_CHEATSHEET_PREAMBLE]
    # Iterate _NODE_SNIPPETS (not ``requested``) to keep a stable, readable order.
    parts.extend(snippet for node_type, snippet in _NODE_SNIPPETS.items() if node_type in requested)
    if requested & _CONTAINER_NODE_TYPES:
        parts.append(_CONTAINERS_SECTION)
    parts.append(_EDGE_HANDLES_SECTION)
    return "\n\n".join(parts) + "\n"


# Full cheatsheet (all node types) — retained as a module constant so callers
# and tests that want the complete reference can import it directly. The
# dynamic per-request prompt is built by ``get_builder_system_prompt``.
NODE_CONFIG_CHEATSHEET = build_node_config_cheatsheet()


_BASE_SYSTEM_PROMPT_HEAD = """You are a Dify workflow builder.

You are given:
  1. A user instruction (what the workflow should do).
  2. A node plan from the planner (which nodes to use, in execution order).

Your job: emit a complete Dify workflow graph as JSON. The graph will be written
directly into a Studio draft, so it must be syntactically valid and structurally
correct.

# Hard rules

1. The output is a single JSON object — no prose, no Markdown, no code fences.
2. NODE IDs MUST USE ONLY ALPHANUMERICS + UNDERSCORES — never hyphens.
   Dify's run-time placeholder regex (see ``variable_pool.VARIABLE_PATTERN``)
   is ``\\{\\{#([a-zA-Z0-9_]{1,50}(?:\\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10})#\\}\\}``,
   so any placeholder pointing at a hyphenated id (e.g. ``{{#node-1.text#}}``)
   silently fails to match at run time and the literal string survives into
   the prompt — the user then sees ``{{#node-1.text#}}`` in their output.
   Use the EXACT ids from the plan, formatted as ``node1``, ``node2``, ... in
   plan order. Edge ``source`` / ``target`` must reference these ids.
3. Every node has top-level fields: id, type, position, data.
   - "type" is always "custom" (ReactFlow node renderer).
   - "data.type" is the actual node type ("llm", "start", etc.).
4. Every edge has top-level fields: id, source, target, type, sourceHandle, targetHandle.
   - "type" is always "custom".
   - "sourceHandle"/"targetHandle" follow the cheatsheet (default: "source"/"target").
   - Edge id format: "<source>-<sourceHandle>-<target>-<targetHandle>".
5. Use the model from the planner context for ALL "llm" / "question-classifier" /
   "parameter-extractor" nodes (provider, name, mode, completion_params).
6. Reference upstream outputs with the literal placeholder syntax
   ``{{#<node-id>.<output-var>#}}`` — that's DOUBLE curly braces with ``#``
   markers inside (matching Dify's runtime placeholder regex
   ``\\{\\{#[^#]+#\\}\\}``). NEVER emit single-brace ``{#…#}`` — Dify will
   not interpolate it, so the LLM at run time would see the literal
   placeholder string in its prompt and echo it back as output. Use
   ``["<node-id>", "<output-var>"]`` for ``value_selector`` /
   ``query_variable_selector`` / etc.
7. The "start" node owns input variables; downstream nodes reference them as
   ``["<start-node-id>", "<var-name>"]`` for selectors or
   ``{{#<start-node-id>.<var-name>#}}`` inside prompt strings.
8. NEVER emit "code" or "http-request" nodes if a tool from the "Available tools"
   section below covers the same task — replace them with a "tool" node referencing
   the exact provider/tool identifier from the catalogue. "code" / "http-request"
   are last-resort escape hatches for arbitrary transformations and APIs that no
   installed tool can express.
9. EVERY variable reference MUST resolve to a real, declared variable on the
   source node — never invent a variable name. Specifically:
   - ``{{#<node-id>.<var>#}}`` inside a prompt / ``answer`` / ``template-transform``
     template (DOUBLE braces — single ``{#…#}`` is NOT a Dify placeholder
     and will NOT be substituted), AND ``["<node-id>", "<var>"]`` inside a
     ``value_selector`` /
     ``query_variable_selector`` / ``iterator_selector`` / ``output_selector`` /
     ``tool_parameters[*].value`` (when ``type: "variable"``), MUST point at a
     value that the source node actually exposes:
       * ``start``  → one of the ``data.variables[*].variable`` entries you
         declared on the start node. Add an entry if you need a new input.
       * ``llm``    → ``text`` (the default LLM output) or, when structured
         output is enabled, a key from its schema.
       * ``code``   → a key in ``data.outputs``.
       * ``knowledge-retrieval`` → ``result`` (the standard array output).
       * ``parameter-extractor`` → one of the ``data.parameters[*].name``.
       * ``document-extractor`` → ``text`` (extracted file text; an array of
         strings when ``is_array_file`` is true).
       * ``variable-aggregator`` → ``output``.
       * ``list-operator`` → ``result`` (array), ``first_record``,
         ``last_record``.
       * ``tool``   → any parameter declared by the tool — the run time
         validates these, so you can name them freely, but pick from the
         documented provider/tool.
     If the planner's "Start inputs" list (see user prompt) is non-empty,
     copy each entry verbatim into ``start.data.variables`` so the
     downstream references resolve.
   - In Advanced-Chat mode you may also reference ``sys.query`` and
     ``sys.files`` without declaring them. In selector fields, spell these as
     exactly ``["sys", "query"]`` and ``["sys", "files"]`` — never as a
     one-item array such as ``["sys,query"]`` or ``["sys.query"]``.
10. MULTIPLE KNOWLEDGE-RETRIEVAL INPUTS TO ONE LLM require a template fan-in.
    ``context.variable_selector accepts only one selector`` and therefore
    cannot carry two retrieval outputs. When an LLM must synthesize two or
    more retrieval results:
    - Run the retrieval nodes as parallel siblings from the same query input.
    - Add one ``template-transform`` node after them. Give it one variable per
      retrieval, such as ``value_selector: ["node2", "result"]`` and
      ``value_selector: ["node3", "result"]``, and render every source's
      content into one labelled text output.
    - Add an edge from EACH retrieval node to the template, then one edge from
      the template to the LLM. The LLM must NOT receive direct retrieval edges.
    - Enable the LLM's context, set ``context.variable_selector`` to the
      template's ``["<template-node-id>", "output"]``, and put
      ``{{#context#}}`` in its prompt.
    - Do not use ``variable-aggregator`` for this: it selects the first value
      produced by mutually exclusive branches; it does not concatenate two
      retrieval results that both ran.

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


def _assemble_builder_system_prompt(mode: str, node_types: Iterable[str] | None) -> str:
    """Stitch the builder system prompt for ``mode`` around a cheatsheet built
    for ``node_types`` (``None`` → full cheatsheet)."""
    mode_rules = _ADVANCED_CHAT_MODE_RULES if mode == "advanced-chat" else _WORKFLOW_MODE_RULES
    return (
        _BASE_SYSTEM_PROMPT_HEAD
        + mode_rules
        + _BASE_SYSTEM_PROMPT_TAIL
        + build_node_config_cheatsheet(node_types)
        + _BASE_SYSTEM_PROMPT_FOOTER
    )


# Static full-cheatsheet prompts — the back-compat default returned by
# ``get_builder_system_prompt`` when the caller doesn't pin a node-type set.
BUILDER_SYSTEM_PROMPT_WORKFLOW = _assemble_builder_system_prompt("workflow", None)

BUILDER_SYSTEM_PROMPT_ADVANCED_CHAT = _assemble_builder_system_prompt("advanced-chat", None)


BUILDER_USER_PROMPT = """# User instruction

{instruction}

{ideal_output_section}\
{existing_graph_section}\
# Selected model (use for all LLM-based nodes)

provider={provider}, name={name}, mode={mode_label}

{tool_catalogue_section}\
{start_inputs_section}\
# Node plan (from planner — use these labels and node_types in this order)

{plan_block}

Now emit the complete workflow graph JSON.
"""


# Node wrapper fields that carry no meaning the builder needs: pure canvas /
# selection state, plus geometry the runner's postprocess recomputes anyway.
# Stripping them out of the refine prompt cuts its size roughly in half on
# hand-edited graphs — fewer tokens in, and (because the builder echoes
# untouched nodes verbatim) far fewer tokens out, which is where the latency
# lives.
_PRUNED_NODE_KEYS = frozenset(
    {
        "positionAbsolute",
        "sourcePosition",
        "targetPosition",
        "selected",
        "dragging",
        "measured",
    }
)

# Additionally pruned from TOP-LEVEL nodes only: the layered auto-layout
# recomputes their position and size defaults, so the builder never needs to
# reproduce them. Container children keep ``position`` (relative to the
# parent, which we cannot recompute) and containers keep ``width`` /
# ``height`` (their canvas size is real config, not a default).
_PRUNED_TOP_LEVEL_NODE_KEYS = _PRUNED_NODE_KEYS | {"position", "width", "height"}

_CONTAINER_DATA_TYPES = frozenset({"iteration", "loop"})

# Edge fields the builder must echo; everything else (ids, zIndex,
# sourceType / targetType, isInIteration / isInLoop markers) is recomputed
# by the runner's postprocess from the node topology.
_KEPT_EDGE_KEYS = ("source", "target", "sourceHandle", "targetHandle")


def compact_graph_for_builder(current_graph: dict) -> dict:
    """
    Strip canvas noise out of a draft graph before prompt injection.

    Keeps everything semantically meaningful — ids, wrapper ``type``,
    ``parentId``, the full ``data`` config, child positions, container
    sizes — and drops geometry / selection state the postprocess pass
    recomputes. The builder echoes untouched nodes verbatim, so every byte
    removed here is removed twice (prompt AND completion).
    """
    nodes_out: list[dict] = []
    for node in current_graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        is_child = bool(node.get("parentId"))
        is_container = isinstance(node.get("data"), dict) and node["data"].get("type") in _CONTAINER_DATA_TYPES
        pruned = _PRUNED_NODE_KEYS if (is_child or is_container) else _PRUNED_TOP_LEVEL_NODE_KEYS
        compact = {k: v for k, v in node.items() if k not in pruned}
        if is_container:
            # Container position is still recomputed by the layout pass.
            compact.pop("position", None)
        nodes_out.append(compact)
    edges_out = [
        {k: edge[k] for k in _KEPT_EDGE_KEYS if k in edge}
        for edge in (current_graph.get("edges") or [])
        if isinstance(edge, dict)
    ]
    return {"nodes": nodes_out, "edges": edges_out}


def format_builder_existing_graph_section(current_graph: dict | None) -> str:
    """
    Refine mode: give the builder the existing graph JSON so it can keep
    every node and edge the user's change does not touch byte-for-byte — same
    ids, same config, same prompt templates. Without the full config the
    builder would regenerate untouched nodes from scratch and silently drop
    the user's hand-tuned settings. Canvas-only fields are stripped first
    (see ``compact_graph_for_builder``) — they're recomputed in postprocess,
    so carrying them only slows the call down.

    Returns an empty string in create mode (no ``current_graph``); the builder
    then behaves exactly as before, constructing the graph purely from the
    planner's node plan.
    """
    if not current_graph:
        return ""
    graph_json = json.dumps(compact_graph_for_builder(current_graph), ensure_ascii=False, separators=(",", ":"))
    return (
        "# Existing graph to refine (JSON)\n\n"
        "You are REFINING this existing graph, NOT building from scratch. Apply "
        "ONLY the change the user instruction describes. Every node and edge the "
        "change does not affect MUST be preserved verbatim — keep the same node "
        "ids, the same `data` config, and the same prompt templates. The node "
        "plan below is the target node set after your change; use the existing "
        "graph as the source of truth for the config of nodes that carry over.\n\n"
        f"```json\n{graph_json}\n```\n\n"
    )


def format_start_inputs_section(start_inputs: list[dict[str, Any]]) -> str:
    """
    Surface the planner's ``start_inputs`` list to the builder so it can
    populate ``start.data.variables`` with the exact set of inputs every
    downstream variable reference will need. Empty list → empty section,
    because the builder may then declare no input variables (e.g. an
    Advanced-Chat workflow that only consumes ``sys.query``).
    """
    if not start_inputs:
        return ""
    lines = ["# Start inputs (copy each entry verbatim into start.data.variables)"]
    lines.append("")
    for inp in start_inputs:
        variable = str(inp.get("variable") or "").strip()
        label = str(inp.get("label") or "").strip()
        type_ = str(inp.get("type") or "paragraph").strip()
        if not variable:
            continue
        lines.append(f"- variable={variable!r}  label={label!r}  type={type_!r}")
    lines.append("")
    return "\n".join(lines) + "\n"


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

    Node IDs use no separator (``node1``, ``node2``, ...) because Dify's
    run-time placeholder regex requires ``[a-zA-Z0-9_]`` in the node-id
    slot — a hyphenated id like ``node-1`` would silently fail to match
    at run time and the literal ``{{#node-1.var#}}`` survives into the
    LLM prompt.

    For container children (planner emitted a ``"parent": "<label>"`` key),
    we resolve the parent label to its ``nodeN`` id and surface it on the
    same line so the builder knows to set ``parentId`` and the
    ``isInIteration`` / ``isInLoop`` markers on inner nodes.
    """
    # First pass: label → node-id so we can resolve "parent" hints.
    label_to_id: dict[str, str] = {}
    for idx, node in enumerate(plan_nodes, start=1):
        label = str(node.get("label") or "")
        if label and label not in label_to_id:
            label_to_id[label] = f"node{idx}"

    lines = []
    for idx, node in enumerate(plan_nodes, start=1):
        node_id = f"node{idx}"
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
        lines.append(f"{idx}. id={node_id}  type={node_type}  label={label!r}{parent_clause}\n   purpose: {purpose}")
    return "\n".join(lines)


def get_builder_system_prompt(mode: str, node_types: Iterable[str] | None = None) -> str:
    """
    Build the builder system prompt for ``mode``, with a cheatsheet scoped to
    ``node_types`` (the planner's chosen node types).

    When ``node_types`` is ``None`` we return the cached full-cheatsheet
    constant (back-compat default). When the runner passes the plan's node-type
    set we assemble a fresh prompt carrying only the relevant per-type schemas,
    so the builder isn't handed config for node types the workflow never uses.
    """
    if node_types is None:
        return BUILDER_SYSTEM_PROMPT_ADVANCED_CHAT if mode == "advanced-chat" else BUILDER_SYSTEM_PROMPT_WORKFLOW
    return _assemble_builder_system_prompt(mode, node_types)

"""Compact semantic configuration references for workflow node builders."""

# Per-node-type configuration cheatsheet.
#
# Each entry mirrors the production ``defaultValue`` from
# ``web/app/components/workflow/nodes/<type>/default.ts`` so the generated
# graph loads in Studio identically to a manually-created node and survives
# both ``WorkflowService.sync_draft_workflow``'s structural checks and the
# runtime entity validation each node performs when the workflow runs.
#
# Each snippet mirrors the production node default closely enough for one
# model call to emit only meaningful ``data`` fields. The runner owns wrappers,
# topology, container metadata, layout, and validation.
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
    "assigner": """\
- assigner  (write to an existing conversation / loop variable):
    {"version": "2",
     "items": [{"variable_selector": ["<target-node>", "<target-var>"],
                "input_type": "variable",
                "operation": "over-write",
                "value": ["<source-node>", "<source-var>"]}]}
    ``input_type`` is "variable" (value is a selector) or "constant".
    Operations: over-write | clear | append | extend | set | += | -= | *= |
    /= | remove-first | remove-last.""",
    "human-input": """\
- human-input  (pause for a person; use webapp delivery by default):
    {"delivery_methods": [{"id": "webapp", "type": "webapp", "enabled": true}],
     "form_content": "<short review / approval instructions>",
     "inputs": [{"type": "paragraph", "output_variable_name": "comment",
                 "default": {"type": "constant", "selector": [], "value": ""}}],
     "user_actions": [{"id": "approve", "title": "Approve",
                       "button_style": "primary"}],
     "timeout": 3, "timeout_unit": "day"}
    Each ``inputs[].output_variable_name`` is an output variable. Outgoing
    edges use the matching user-action id as ``sourceHandle``.""",
}


def get_node_config_snippet(node_type: str) -> str:
    """Return the semantic config reference for one leaf node type."""
    return _NODE_SNIPPETS.get(node_type, "")

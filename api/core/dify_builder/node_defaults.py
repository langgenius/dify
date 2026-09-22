"""Per-node-type default ``data`` configs for every node the Builder's agents
may create.

There is no importable Python source for Dify's per-node-type default config --
the canonical values live in the frontend's
``web/app/components/workflow/nodes/<type>/default.ts`` (mirrored, for LLM
prompt-authoring, by ``core.workflow.generator.prompts.builder_prompts
._NODE_SNIPPETS``). This module hand-maintains a literal Python copy of those
defaults; each entry cites its ``default.ts`` lines and the engine fields it
covers. Keep it pure: it is imported by ``services.dify_builder.graph_ops`` and
must not reach back into ``services``, ``configs``, Flask or the model runtime.

Why it matters beyond the placeholder agent: graphon requires a handful of
fields per node type with NO default (``TemplateTransformNodeData.variables``,
``CodeNodeData.outputs``, ``VariableAggregatorNodeData.output_type``, ...). An
Edit/Fix LLM that emits ``create_node{template-transform, {title, template}}``
produces a node the draft preflight refuses -- and the refusal kills the WHOLE
batch, parking the session at ``edit.plan_approval`` (triage
``edit-branch-failure-2026-09-22`` cause (b)). ``graph_ops._build_node`` merges
these defaults UNDER the caller's config so a missing required field is filled
and a caller-supplied one always wins.

Scope: defaults fill MISSING required fields. Fields that are present but WRONG
are the deterministic heal set's job
(``core.workflow.graph_normalizers.heal_nodes_for_preflight``) -- do not
duplicate its work here.

``default_config``/``default_config_or_empty`` return a deep copy every call:
callers merge canned values (a real provider/model name, a real dataset id, ...)
into the returned dict, and mutating a return value must never leak into a later
call.
"""

import copy
from typing import Any

from graphon.enums import BuiltinNodeTypes

# Editor-only keys deliberately NOT copied from ``default.ts``:
#
# ``_targetBranches`` (if-else, question-classifier) is frontend editor state
# that the canvas regenerates from ``cases`` / ``classes``
# (``nodes/question-classifier/use-config.ts:139,173``,
# ``nodes/if-else/use-config.helpers.ts:53-75``); the backend reads branch
# handles from ``cases``/``classes`` too
# (``core.workflow.graph_normalizers.declared_branch_handles:579-585``). Since
# the caller's ``cases``/``classes`` win the merge while a default
# ``_targetBranches`` would not, shipping it would attach a STALE branch list to
# every Builder-created branch node. Omitting an optional editor key is strictly
# better than writing a wrong one.
_DEFAULTS: dict[str, dict[str, Any]] = {
    # web/app/components/workflow/nodes/start/default.ts:17-19
    # graphon nodes/start/entities.py:14 -- ``variables`` has a default_factory.
    BuiltinNodeTypes.START: {
        "variables": [],
    },
    # web/app/components/workflow/nodes/end/default.ts:15-17
    # graphon nodes/end/entities.py:11 -- ``outputs`` is required, no default.
    BuiltinNodeTypes.END: {
        "outputs": [],
    },
    # web/app/components/workflow/nodes/answer/default.ts:14-17
    # graphon nodes/answer/entities.py:12 -- ``answer`` is ``Field(...)``.
    BuiltinNodeTypes.ANSWER: {
        "variables": [],
        "answer": "",
    },
    # web/app/components/workflow/nodes/llm/default.ts:44-66
    # graphon nodes/llm/entities.py:18-22 -- ``ModelConfig`` requires
    # ``provider``/``name``/``mode``.
    BuiltinNodeTypes.LLM: {
        "model": {
            "provider": "",
            "name": "",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
        "prompt_template": [{"role": "system", "text": ""}],
        "context": {"enabled": False, "variable_selector": []},
        "vision": {"enabled": False},
    },
    # web/app/components/workflow/nodes/knowledge-retrieval/default.ts:18-28
    BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: {
        "query_variable_selector": [],
        "query_attachment_selector": [],
        "dataset_ids": [],
        "retrieval_mode": "multiple",
        "multiple_retrieval_config": {
            "top_k": 4,
            "score_threshold": None,
            "reranking_enable": False,
        },
    },
    # web/app/components/workflow/nodes/if-else/default.ts:21-39, minus the
    # editor-only ``_targetBranches`` (see the note above).
    # graphon nodes/if_else/entities.py:22-24 -- every field is optional, and
    # ``iter_cases()`` synthesizes exactly this one empty "true" case when
    # ``cases is None``, so the default is behaviour-neutral at run time.
    BuiltinNodeTypes.IF_ELSE: {
        "cases": [
            {
                "case_id": "true",
                "logical_operator": "and",
                "conditions": [],
            },
        ],
    },
    # web/app/components/workflow/nodes/code/default.ts:18-23
    # graphon nodes/code/entities.py:57-60 -- ``variables``, ``code_language``,
    # ``code`` and ``outputs`` are all required with no default.
    BuiltinNodeTypes.CODE: {
        "code": "",
        "code_language": "python3",
        "variables": [],
        "outputs": {},
    },
    # web/app/components/workflow/nodes/template-transform/default.ts:18-21
    # graphon nodes/template_transform/entities.py:10-11 -- ``variables`` and
    # ``template`` are both required with no default. This is the exact node the
    # Edit LLM created without ``variables`` in the F4 failure.
    BuiltinNodeTypes.TEMPLATE_TRANSFORM: {
        "template": "",
        "variables": [],
    },
    # web/app/components/workflow/nodes/question-classifier/default.ts:18-53,
    # minus the editor-only ``_targetBranches`` (see the note above).
    # graphon nodes/question_classifier/entities.py:33-35 --
    # ``query_variable_selector``, ``model`` and ``classes`` are required.
    BuiltinNodeTypes.QUESTION_CLASSIFIER: {
        "query_variable_selector": [],
        "model": {
            "provider": "",
            "name": "",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
        "classes": [
            {"id": "1", "name": "", "label": "CLASS 1"},
            {"id": "2", "name": "", "label": "CLASS 2"},
        ],
        "vision": {"enabled": False},
    },
    # web/app/components/workflow/nodes/http/default.ts:16-41 (there is no
    # ``nodes/http-request/`` directory).
    # graphon nodes/http_request/entities.py:117-130 -- ``method``, ``url``,
    # ``authorization``, ``headers`` and ``params`` are required with no
    # default. The frontend's ``timeout`` uses the ``max_*`` keys the editor
    # reads; graphon's ``HttpRequestNodeTimeout`` ignores them and
    # ``HttpRequestNode._get_request_timeout:247-255`` falls back to the
    # configured defaults, which is what the block config itself ships
    # (``nodes/http_request/node.py:166-170`` carries both shapes).
    BuiltinNodeTypes.HTTP_REQUEST: {
        "variables": [],
        "method": "get",
        "url": "",
        "authorization": {
            "type": "no-auth",
            "config": None,
        },
        "headers": "",
        "params": "",
        "body": {
            "type": "none",
            "data": [],
        },
        "ssl_verify": True,
        "timeout": {
            "max_connect_timeout": 0,
            "max_read_timeout": 0,
            "max_write_timeout": 0,
        },
        "retry_config": {
            "retry_enabled": True,
            "max_retries": 3,
            "retry_interval": 100,
        },
    },
    # web/app/components/workflow/nodes/variable-assigner/default.ts:23-26 (the
    # variable-AGGREGATOR node's frontend directory is ``variable-assigner``).
    # graphon nodes/variable_aggregator/entities.py:27-28 -- BOTH
    # ``output_type`` and ``variables`` are required with no default.
    BuiltinNodeTypes.VARIABLE_AGGREGATOR: {
        "output_type": "any",
        "variables": [],
    },
    # web/app/components/workflow/nodes/tool/default.ts:22-26
    # graphon nodes/tool/entities.py:48-53,133 -- ``tool_configurations`` and
    # ``tool_parameters`` are required. The provider/tool identity fields
    # (``provider_id``, ``provider_type``, ``provider_name``, ``tool_name``,
    # ``tool_label``) are also required but are not knowable as a default; only
    # the caller can supply them.
    BuiltinNodeTypes.TOOL: {
        "tool_parameters": {},
        "tool_configurations": {},
        "tool_node_version": "2",
    },
}


def default_config(node_type: str) -> dict[str, Any]:
    """Return a fresh deep copy of ``node_type``'s default ``data`` config.

    Raises ``ValueError`` for a node type with no entry. Use this where an
    unregistered type is a programming error the caller wants to hear about
    (the placeholder agent builds its whole graph from these). Node-building on
    behalf of an LLM must use ``default_config_or_empty`` instead.
    """
    template = _DEFAULTS.get(node_type)
    if template is None:
        raise ValueError(f"no default config registered for node type: {node_type!r}")
    return copy.deepcopy(template)


def default_config_or_empty(node_type: str) -> dict[str, Any]:
    """Return a fresh deep copy of ``node_type``'s default ``data`` config, or
    ``{}`` when the type has no entry.

    This is the lookup on the node-creation chokepoint. A node type this module
    does not cover yet must contribute no defaults -- never abort the edit that
    is creating it.
    """
    template = _DEFAULTS.get(node_type)
    if template is None:
        return {}
    return copy.deepcopy(template)

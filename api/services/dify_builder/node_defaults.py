"""Canned default ``data`` configs for Build's node types (Slice 1 spec Sec
9 / resolved decision: "create_node configs lift from Dify's node
registry").

There is no importable Python source for Dify's per-node-type default
config -- the canonical values live in the frontend's
``web/app/components/workflow/nodes/<type>/default.ts`` (mirrored, for LLM
prompt-authoring, by ``core.workflow.generator.prompts.builder_prompts
._NODE_SNIPPETS``). This module hand-maintains a literal Python copy of
those defaults for the node types the canned Build agent needs (Slice 2):
``start``, ``knowledge-retrieval``, ``llm``, ``end``. Extend ``_DEFAULTS``
when a later slice (Edit) needs more types -- keep each entry byte-faithful
to the matching ``default.ts`` ``defaultValue``.

``default_config`` returns a deep copy every call: callers merge canned
values (a real provider/model name, a real dataset id, ...) into the
returned dict before using it as a ``create_node`` intent's ``config`` --
mutating the return value must never leak into a later call.
"""

import copy
from typing import Any

from graphon.enums import BuiltinNodeTypes

_DEFAULTS: dict[str, dict[str, Any]] = {
    # web/app/components/workflow/nodes/start/default.ts:17-19
    BuiltinNodeTypes.START: {
        "variables": [],
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
    # web/app/components/workflow/nodes/llm/default.ts:44-66
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
    # web/app/components/workflow/nodes/end/default.ts:15-17
    BuiltinNodeTypes.END: {
        "outputs": [],
    },
}


def default_config(node_type: str) -> dict[str, Any]:
    """Return a fresh deep copy of ``node_type``'s canned default ``data``
    config. Raises ``ValueError`` for a node type Slice 1 doesn't cover yet.
    """
    template = _DEFAULTS.get(node_type)
    if template is None:
        raise ValueError(f"no default config registered for node type: {node_type!r}")
    return copy.deepcopy(template)

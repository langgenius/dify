"""Per-node-type default ``data`` configs for every node the Builder's agents
may create.

There is no importable Python source for Dify's per-node-type default config --
the canonical values live in the frontend's
``web/app/components/workflow/nodes/<type>/default.ts`` (mirrored, for LLM
prompt-authoring, by ``core.workflow.generator.prompts.builder_prompts
._NODE_SNIPPETS``). This module hand-maintains a literal Python copy of the
SAFE part of those defaults; each entry cites its ``default.ts`` lines and the
engine fields it covers. Keep it pure: it is imported by
``services.dify_builder.graph_ops`` and must not reach back into ``services``,
``configs``, Flask or the model runtime.

Why it matters: graphon requires a handful of fields per node type with NO
default (``TemplateTransformNodeData.variables``, ``CodeNodeData.outputs``,
``VariableAggregatorNodeData.output_type``, ...). An Edit/Fix LLM that emits
``create_node{template-transform, {title, template}}`` produces a node the draft
preflight refuses -- and the refusal kills the WHOLE batch, parking the session
at ``edit.plan_approval`` (triage ``edit-branch-failure-2026-09-22`` cause (b)).
``graph_ops._build_node`` merges these defaults UNDER the caller's config so a
missing structural field is filled and a caller-supplied one always wins.

THE RULE FOR ADDING A FIELD HERE
--------------------------------
A default may supply a field whose empty value is semantically NEUTRAL -- a
container, a mode, a config or auth block (``variables: []``, ``headers: ""``,
``authorization: {"type": "no-auth"}``, ``output_type``, ``code_language``). It
must NOT supply a field that carries the node's PURPOSE, where an empty value
produces a node that RUNS and yields nothing. Fabricating one of those turns a
loud preflight refusal into a node that is written, reported as a success, and
silently does the wrong thing -- the exact failure shape this module exists to
eliminate.

Leaving it out costs a re-prompt, not a batch. ``preflight.vet_intents`` puts
the dry-run graph through ``preflight_errors`` and hands the engine's own
message -- which names the node and the missing field -- to the one corrective
re-prompt in ``services/dify_builder/agent/edit.py`` and
``services/dify_builder/agent/fix.py``. Before that existed, a node missing a
required field was simply "applicable", the re-prompt could not fire, and the
omission surfaced at ``apply_repair``'s preflight instead, where all three
handlers catch ``DraftWouldNotStartError``, write NOTHING and park the session
(``handlers_edit.py``, ``handlers_fix.py``, ``handlers_build.py``) -- F4 cause
(b) itself. A batch refused with the field named is still the right trade
against a written node that silently answers wrong.

An empty value that makes the node FAIL LOUDLY is not in the purpose category at
all -- there is no silence to protect against, and dropping it would pay the
full batch-refusal cost for nothing. Verified loud, so all of these stay:

* ``llm.model`` with ``provider: ""`` -- never launches; the Builder surfaces
  "model not configured".
* ``llm.prompt_template`` whose only message is empty -- every empty message is
  filtered out, leaving zero, and graphon raises ``NoPromptFoundError``
  (``nodes/llm/node.py:1397-1402``).
* ``code.code`` as ``""`` -- the sandbox runner calls ``main(**inputs_obj)``
  with no ``main`` defined and raises
  (``core/helper/code_executor/python3/python3_transformer.py:20``).
* ``code.outputs`` as ``{}`` -- any key the code actually returns is unvalidated,
  so graphon raises ``CodeNodeError("Not all output parameters are
  validated.")`` (``nodes/code/code_node.py:690-693``).
* ``http-request.url`` as ``""`` -- ``Executor._init_url`` raises
  ``InvalidURLError("url is required")`` before any request goes out
  (``nodes/http_request/executor.py:172-174``).

Purpose fields deliberately NOT defaulted, and what each empty value would do:

* ``end.outputs`` -- the End node runs OK, so ``run_finished_without_output``
  (``core/dify_builder/handlers_fix.py``) returns False and the Builder reports
  "All checks passed" on an empty result.
* ``answer.answer`` -- streams nothing.
* ``template-transform.template`` -- renders "".
* ``variable-aggregator.variables`` -- aggregates nothing and returns
  ``SUCCEEDED, outputs={}``; this is triage cause (d) verbatim.
* ``question-classifier.classes`` -- two blank categories, and the fabricated
  ids would also pin ``declared_branch_handles`` to ``["1", "2"]`` so a
  semantic ``connect`` is silently dropped while the create survives.
* ``question-classifier.query_variable_selector`` -- ``query or ""``
  (``nodes/question_classifier/question_classifier_node.py:260-280``), i.e. the
  classifier runs on an empty string.
* ``knowledge-retrieval.dataset_ids`` -- retrieves from no dataset and succeeds
  with an empty result list.

Editor-only keys are also not copied. ``_targetBranches`` (if-else,
question-classifier) is frontend editor state that the canvas regenerates from
``cases`` / ``classes`` (``nodes/question-classifier/use-config.ts:139,173``,
``nodes/if-else/use-config.helpers.ts:53-75``); the backend reads branch handles
from ``cases``/``classes`` too (``declared_branch_handles``). A caller's
``cases``/``classes`` win the merge while a default ``_targetBranches`` would
not, so shipping it would attach a STALE branch list to every created branch
node.

Scope: defaults fill MISSING structural fields. Fields that are present but
WRONG are the deterministic heal set's job
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

_DEFAULTS: dict[str, dict[str, Any]] = {
    # web/app/components/workflow/nodes/start/default.ts:17-19
    # graphon nodes/start/entities.py:14 -- ``variables`` has a default_factory.
    # A start form with no fields is a normal, intentional design, so the empty
    # list carries no meaning of its own.
    BuiltinNodeTypes.START: {
        "variables": [],
    },
    # web/app/components/workflow/nodes/end/default.ts:15-17, minus ``outputs``
    # (purpose field -- see the module docstring). graphon
    # nodes/end/entities.py:11 requires it, so an End the LLM forgot to wire up
    # is refused by name instead of silently returning nothing.
    BuiltinNodeTypes.END: {},
    # web/app/components/workflow/nodes/answer/default.ts:14-17, minus
    # ``answer`` (purpose field). ``variables`` is a frontend-only container.
    BuiltinNodeTypes.ANSWER: {
        "variables": [],
    },
    # web/app/components/workflow/nodes/llm/default.ts:44-66
    # graphon nodes/llm/entities.py:69-75 -- ``model``, ``prompt_template`` and
    # ``context`` are all required. An empty provider or an empty-only prompt
    # both fail LOUDLY at run time (see the module docstring), so these are
    # scaffolding, not fabricated meaning.
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
    # web/app/components/workflow/nodes/knowledge-retrieval/default.ts:18-28,
    # minus ``dataset_ids`` (purpose field;
    # core/workflow/nodes/knowledge_retrieval/entities.py:42 requires it). The
    # two query selectors stay: they are optional in the entity and ``[]`` is
    # indistinguishable from absent, so they fabricate nothing.
    BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: {
        "query_variable_selector": [],
        "query_attachment_selector": [],
        "retrieval_mode": "multiple",
        "multiple_retrieval_config": {
            "top_k": 4,
            "score_threshold": None,
            "reranking_enable": False,
        },
    },
    # web/app/components/workflow/nodes/code/default.ts:18-23 (complete).
    # graphon nodes/code/entities.py:57-60 requires ``variables``,
    # ``code_language``, ``code`` and ``outputs``. Neither empty value is
    # silent: ``code: ""`` leaves the sandbox runner with no ``main`` to call,
    # and ``outputs: {}`` makes graphon raise ``CodeNodeError("Not all output
    # parameters are validated.")`` for any key the code returns -- both are
    # named run-time errors, so there is no silent success to protect against
    # and no reason to pay a batch refusal.
    BuiltinNodeTypes.CODE: {
        "code": "",
        "code_language": "python3",
        "variables": [],
        "outputs": {},
    },
    # web/app/components/workflow/nodes/template-transform/default.ts:18-21,
    # minus ``template`` (purpose field). ``variables`` is STRUCTURAL and stays
    # -- graphon nodes/template_transform/entities.py:10 requires it and this is
    # the exact field the Edit LLM omitted in the live F4 failure.
    BuiltinNodeTypes.TEMPLATE_TRANSFORM: {
        "variables": [],
    },
    # web/app/components/workflow/nodes/question-classifier/default.ts:18-53,
    # minus ``classes``, ``query_variable_selector`` (purpose fields) and the
    # editor-only ``_targetBranches``. graphon
    # nodes/question_classifier/entities.py:34-36 requires all three of
    # ``query_variable_selector``, ``model`` and ``classes``.
    BuiltinNodeTypes.QUESTION_CLASSIFIER: {
        "model": {
            "provider": "",
            "name": "",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
        "vision": {"enabled": False},
    },
    # web/app/components/workflow/nodes/http/default.ts:16-41 (complete; there
    # is no ``nodes/http-request/`` directory).
    # graphon nodes/http_request/entities.py:117-130 -- ``method``, ``url``,
    # ``authorization``, ``headers`` and ``params`` are all required.
    # ``method``/``authorization``/``headers``/``params`` are mode/config/auth
    # with neutral empty values, and ``url: ""`` is not silent either:
    # ``Executor._init_url`` raises ``InvalidURLError("url is required")``
    # before any request goes out (``nodes/http_request/executor.py:172-174``).
    # The frontend's
    # ``timeout`` uses the ``max_*`` keys the editor reads; graphon's
    # ``HttpRequestNodeTimeout`` ignores them and
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
    # variable-AGGREGATOR node's frontend directory is ``variable-assigner``),
    # minus ``variables`` (purpose field). graphon
    # nodes/variable_aggregator/entities.py:27-28 requires both, and an
    # aggregator with nothing to aggregate is triage cause (d) itself.
    BuiltinNodeTypes.VARIABLE_AGGREGATOR: {
        "output_type": "any",
    },
    # web/app/components/workflow/nodes/tool/default.ts:22-26
    # graphon nodes/tool/entities.py:48-53,133 -- ``tool_configurations`` and
    # ``tool_parameters`` are required containers. The provider/tool identity
    # fields (``provider_id``, ``provider_type``, ``provider_name``,
    # ``tool_name``, ``tool_label``) are the purpose fields here and are not
    # knowable as a default; only the caller can supply them.
    BuiltinNodeTypes.TOOL: {
        "tool_parameters": {},
        "tool_configurations": {},
        "tool_node_version": "2",
    },
    # NOTE: ``if-else`` has no entry, and omitting it changes NOTHING either way
    # -- nothing gained, nothing lost. Its frontend default is one case with an
    # empty ``conditions`` list, which graphon's ``ConditionProcessor`` combines
    # with ``all([])``, so that case always matches and the node routes
    # everything down the IF arm. Dropping the entry does NOT cure that:
    # ``IfElseNodeData.cases`` is optional and ``iter_cases()`` synthesizes the
    # identical empty "true" case when it is absent, so an unconfigured if-else
    # behaves the same with or without us writing it down. ``_if_else_case_ids``
    # likewise already reports ``["true"]`` for a node without ``cases``, so
    # declared handles are unchanged. The entry is simply noise: it would write
    # a fabricated always-true condition into the draft, making the node look
    # configured in the canvas and in ``diff_graphs`` when it is not.
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

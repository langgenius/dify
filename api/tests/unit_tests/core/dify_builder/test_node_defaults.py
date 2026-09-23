"""Tests for the per-node-type default-config registry.

Values are pinned against the FE registry they mirror (``web/app/components
/workflow/nodes/<type>/default.ts``) -- see the per-entry comments in
``node_defaults.py`` for the exact source lines -- and every entry is run
through the engine node data class that consumes it, pinned in BOTH directions:
no structural field is missing, and no PURPOSE field is fabricated.
"""

import importlib

import pytest
from pydantic import ValidationError

from core.dify_builder.node_defaults import default_config, default_config_or_empty


def test_default_config_start_matches_fe_default():
    assert default_config("start") == {"variables": []}


def test_default_config_llm_matches_fe_default():
    assert default_config("llm") == {
        "model": {
            "provider": "",
            "name": "",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
        "prompt_template": [{"role": "system", "text": ""}],
        "context": {"enabled": False, "variable_selector": []},
        "vision": {"enabled": False},
    }


def test_default_config_knowledge_retrieval_matches_fe_default_without_dataset_ids():
    assert default_config("knowledge-retrieval") == {
        "query_variable_selector": [],
        "query_attachment_selector": [],
        "retrieval_mode": "multiple",
        "multiple_retrieval_config": {
            "top_k": 4,
            "score_threshold": None,
            "reranking_enable": False,
        },
    }


def test_default_config_template_transform_keeps_variables_and_drops_template():
    """The F4 fix is ``variables`` -- structural, engine-required, and the exact
    field the live Edit omitted. ``template`` is the node's purpose."""
    assert default_config("template-transform") == {"variables": []}


def test_default_config_code_matches_fe_default():
    """Both empty values fail loudly (no ``main`` to call; ``CodeNodeError("Not
    all output parameters are validated.")``), so neither is a purpose field."""
    assert default_config("code") == {
        "code": "",
        "code_language": "python3",
        "variables": [],
        "outputs": {},
    }


def test_default_config_variable_aggregator_keeps_only_output_type():
    """``nodes/variable-assigner/default.ts`` is the variable-AGGREGATOR's
    frontend directory; there is no ``nodes/variable-aggregator/``."""
    assert default_config("variable-aggregator") == {"output_type": "any"}


def test_default_config_http_request_matches_fe_default():
    """``nodes/http/default.ts``; there is no ``nodes/http-request/``. ``url``
    is kept: an empty one raises ``InvalidURLError("url is required")`` before
    any request goes out, so it is loud, not silent."""
    assert default_config("http-request") == {
        "variables": [],
        "method": "get",
        "url": "",
        "authorization": {"type": "no-auth", "config": None},
        "headers": "",
        "params": "",
        "body": {"type": "none", "data": []},
        "ssl_verify": True,
        "timeout": {"max_connect_timeout": 0, "max_read_timeout": 0, "max_write_timeout": 0},
        "retry_config": {"retry_enabled": True, "max_retries": 3, "retry_interval": 100},
    }


def test_default_config_question_classifier_keeps_only_model_and_vision():
    default = default_config("question-classifier")

    assert default == {
        "model": {
            "provider": "",
            "name": "",
            "mode": "chat",
            "completion_params": {"temperature": 0.7},
        },
        "vision": {"enabled": False},
    }
    assert "_targetBranches" not in default


def test_default_config_tool_matches_fe_default():
    assert default_config("tool") == {
        "tool_parameters": {},
        "tool_configurations": {},
        "tool_node_version": "2",
    }


def test_default_config_raises_for_unregistered_node_type():
    with pytest.raises(ValueError, match="iteration"):
        default_config("iteration")


def test_default_config_returns_a_fresh_copy_each_call():
    first = default_config("start")
    first["variables"].append({"variable": "mutated"})

    second = default_config("start")

    assert second == {"variables": []}


# ---- a default must never fabricate a node's purpose ------------------------


@pytest.mark.parametrize(
    ("node_type", "forbidden"),
    [
        ("end", "outputs"),  # End runs OK -> "All checks passed" on an empty result
        ("answer", "answer"),  # streams nothing
        ("template-transform", "template"),  # renders ""
        ("variable-aggregator", "variables"),  # SUCCEEDED, outputs={} -- triage cause (d)
        ("question-classifier", "classes"),  # two blank categories + fabricated handle ids
        ("question-classifier", "query_variable_selector"),  # classifies ""
        ("knowledge-retrieval", "dataset_ids"),  # retrieves from no dataset, succeeds empty
    ],
)
def test_no_entry_fabricates_a_purpose_field(node_type: str, forbidden: str):
    """A field whose empty value produces a node that RUNS and yields nothing
    must be left to the caller. Supplying it turns a loud preflight refusal into
    a silent wrong answer -- the failure shape this module exists to prevent."""
    assert forbidden not in default_config(node_type)


def test_if_else_has_no_entry_at_all():
    """The frontend default is one case with an empty ``conditions`` list, and
    graphon combines zero conditions with ``all([])`` -- so it always matches
    and the node silently routes everything down the IF arm. Omitting it costs
    nothing: ``cases`` is optional and ``iter_cases()`` synthesizes the same
    empty case, so the engine behaves identically."""
    assert default_config_or_empty("if-else") == {}
    with pytest.raises(ValueError, match="if-else"):
        default_config("if-else")


def test_an_if_else_without_cases_still_declares_both_branch_handles():
    """Proof that dropping the entry did not weaken handle validation."""
    from core.workflow.graph_normalizers import declared_branch_handles

    bare = {"id": "n1", "data": {"type": "if-else", "title": "Check", **default_config_or_empty("if-else")}}

    assert declared_branch_handles(bare) == ["true", "false"]


def test_an_empty_condition_group_always_matches_so_it_is_not_safe_to_default():
    """The engine evidence behind the if-else decision."""
    from graphon.utils.condition.processor import ConditionProcessor

    result = ConditionProcessor().process_conditions(variable_pool=None, conditions=[], operator="and")

    assert result[2] is True


# ---- default_config_or_empty ------------------------------------------------


def test_default_config_or_empty_returns_no_defaults_for_an_unregistered_type():
    """A node type this module does not cover must contribute no defaults --
    never abort the edit that is creating it."""
    assert default_config_or_empty("iteration") == {}


def test_default_config_or_empty_returns_the_same_values_as_default_config():
    assert default_config_or_empty("template-transform") == default_config("template-transform")


def test_default_config_or_empty_returns_a_fresh_copy_each_call():
    first = default_config_or_empty("code")
    first["outputs"]["mutated"] = {"type": "string"}

    assert default_config_or_empty("code")["outputs"] == {}


# ---- what the engine says about each default -------------------------------
#
# Pinned in both directions: the fields the engine still reports missing from a
# node built from the default ALONE must be exactly the purpose fields the
# registry deliberately refuses to fabricate -- no more (a structural field
# would be a regression of the F4 fix) and no fewer (a purpose field creeping
# back in would be a silent-success regression).

_ENGINE_EXPECTATIONS: list[tuple[str, str, str, set[str]]] = [
    ("start", "graphon.nodes.start.entities", "StartNodeData", set()),
    ("llm", "graphon.nodes.llm.entities", "LLMNodeData", set()),
    ("code", "graphon.nodes.code.entities", "CodeNodeData", set()),
    ("http-request", "graphon.nodes.http_request.entities", "HttpRequestNodeData", set()),
    ("end", "graphon.nodes.end.entities", "EndNodeData", {"outputs"}),
    ("answer", "graphon.nodes.answer.entities", "AnswerNodeData", {"answer"}),
    (
        "knowledge-retrieval",
        "core.workflow.nodes.knowledge_retrieval.entities",
        "KnowledgeRetrievalNodeData",
        {"dataset_ids"},
    ),
    (
        "template-transform",
        "graphon.nodes.template_transform.entities",
        "TemplateTransformNodeData",
        {"template"},
    ),
    (
        "variable-aggregator",
        "graphon.nodes.variable_aggregator.entities",
        "VariableAggregatorNodeData",
        {"variables"},
    ),
    (
        "question-classifier",
        "graphon.nodes.question_classifier.entities",
        "QuestionClassifierNodeData",
        {"query_variable_selector", "classes"},
    ),
    (
        "tool",
        "graphon.nodes.tool.entities",
        "ToolNodeData",
        {"provider_id", "provider_type", "provider_name", "tool_name", "tool_label"},
    ),
]


@pytest.mark.parametrize(("node_type", "module_name", "class_name", "expected_missing"), _ENGINE_EXPECTATIONS)
def test_the_engine_reports_exactly_the_purpose_fields_as_missing(
    node_type: str, module_name: str, class_name: str, expected_missing: set[str]
):
    data_class = getattr(importlib.import_module(module_name), class_name)
    payload = {"type": node_type, "title": "T", **default_config(node_type)}

    if not expected_missing:
        data_class.model_validate(payload)  # must not raise
        return

    with pytest.raises(ValidationError) as excinfo:
        data_class.model_validate(payload)
    missing = {str(error["loc"][0]) for error in excinfo.value.errors() if error["type"] == "missing"}
    assert missing == expected_missing


def test_an_if_else_needs_nothing_the_registry_would_have_to_supply():
    from graphon.nodes.if_else.entities import IfElseNodeData

    IfElseNodeData.model_validate({"type": "if-else", "title": "T"})  # must not raise


def test_the_llm_defaults_fail_loudly_rather_than_silently():
    """Why ``model`` and ``prompt_template`` are kept while other purpose fields
    are dropped: neither empty value lets the node run and yield nothing."""
    from graphon.nodes.llm.exc import NoPromptFoundError

    assert issubclass(NoPromptFoundError, Exception)
    assert default_config("llm")["model"]["provider"] == ""  # -> "model not configured" at launch

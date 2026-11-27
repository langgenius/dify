"""Generated nodes share editor scaffolding and require their own output, tool, and branch choices."""

import pytest
from pydantic import ValidationError

from core.workflow.nodes.knowledge_retrieval.entities import KnowledgeRetrievalNodeData
from graphon.nodes.answer.entities import AnswerNodeData
from graphon.nodes.code.entities import CodeNodeData
from graphon.nodes.end.entities import EndNodeData
from graphon.nodes.http_request.entities import HttpRequestNodeData
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.question_classifier.entities import QuestionClassifierNodeData
from graphon.nodes.start.entities import StartNodeData
from graphon.nodes.template_transform.entities import TemplateTransformNodeData
from graphon.nodes.tool.entities import ToolNodeData
from graphon.nodes.variable_aggregator.entities import VariableAggregatorNodeData
from services.workflow.node_defaults import generated_node_defaults


def test_default_config_returns_a_fresh_copy_each_call() -> None:
    first = generated_node_defaults("start")
    first["variables"].append({"variable": "mutated"})

    second = generated_node_defaults("start")

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
def test_no_entry_fabricates_a_purpose_field(node_type: str, forbidden: str) -> None:
    """A field whose empty value produces a node that RUNS and yields nothing
    must be left to the caller. Supplying it turns a loud preflight refusal into
    a silent wrong answer -- the failure shape this module exists to prevent."""
    assert forbidden not in generated_node_defaults(node_type)


def test_an_empty_condition_group_always_matches_so_it_is_not_safe_to_default() -> None:
    """The engine evidence behind the if-else decision."""
    from graphon.runtime import VariablePool
    from graphon.utils.condition.processor import ConditionProcessor

    result = ConditionProcessor().process_conditions(variable_pool=VariablePool(), conditions=[], operator="and")

    assert result[2] is True


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
) -> None:
    data_class = {
        ("graphon.nodes.start.entities", "StartNodeData"): StartNodeData,
        ("graphon.nodes.llm.entities", "LLMNodeData"): LLMNodeData,
        ("graphon.nodes.code.entities", "CodeNodeData"): CodeNodeData,
        ("graphon.nodes.http_request.entities", "HttpRequestNodeData"): HttpRequestNodeData,
        ("graphon.nodes.end.entities", "EndNodeData"): EndNodeData,
        ("graphon.nodes.answer.entities", "AnswerNodeData"): AnswerNodeData,
        ("core.workflow.nodes.knowledge_retrieval.entities", "KnowledgeRetrievalNodeData"): KnowledgeRetrievalNodeData,
        ("graphon.nodes.template_transform.entities", "TemplateTransformNodeData"): TemplateTransformNodeData,
        ("graphon.nodes.variable_aggregator.entities", "VariableAggregatorNodeData"): VariableAggregatorNodeData,
        ("graphon.nodes.question_classifier.entities", "QuestionClassifierNodeData"): QuestionClassifierNodeData,
        ("graphon.nodes.tool.entities", "ToolNodeData"): ToolNodeData,
    }[(module_name, class_name)]
    payload = {"type": node_type, "title": "T", **generated_node_defaults(node_type)}

    if not expected_missing:
        data_class.model_validate(payload)  # must not raise
        return

    with pytest.raises(ValidationError) as excinfo:
        data_class.model_validate(payload)
    missing = {str(error["loc"][0]) for error in excinfo.value.errors() if error["type"] == "missing"}
    assert missing == expected_missing

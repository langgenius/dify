import pytest

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance, resolve_variable_selector
from graphon.node_events import NodeRunResult


def test_resolve_variable_selector_rejects_missing_runtime_output() -> None:
    node_results = {"node_1": NodeRunResult(outputs={"text": "answer"})}

    with pytest.raises(ValueError, match="missing.*not found"):
        resolve_variable_selector("#node_1.missing#", node_results)


def test_workflow_input_resolution_preserves_types_and_interpolates_text() -> None:
    node_results = {"node": NodeRunResult(outputs={"answer": {"score": 0.8}, "text": "hello"})}

    inputs = BaseEvaluationInstance._build_workflow_inputs(
        {
            "score": "{{#node.answer.score#}}",
            "summary": "Result: {{#node.text#}}",
            "constant": "plain text",
            "threshold": 0.5,
        },
        node_results,
    )

    assert inputs == {"score": 0.8, "summary": "Result: hello", "constant": "plain text", "threshold": 0.5}


def test_workflow_metric_extraction_ignores_unconfigured_outputs() -> None:
    assert BaseEvaluationInstance._extract_workflow_metrics({}, "evaluator", {"score"}) == []
    assert (
        BaseEvaluationInstance._extract_workflow_metrics({"data": {"outputs": "invalid"}}, "evaluator", {"score"}) == []
    )

    metrics = BaseEvaluationInstance._extract_workflow_metrics(
        {"data": {"outputs": {"score": 0.8, "ignored": 0.1, 1: 0.2}}},
        "evaluator",
        {"score"},
    )

    assert len(metrics) == 1
    assert metrics[0].name == "score"
    assert metrics[0].value == 0.8
    assert metrics[0].node_info is not None
    assert metrics[0].node_info.node_id == "evaluator"


def test_variable_selector_rejects_invalid_paths_and_missing_nodes() -> None:
    node_results = {"node": NodeRunResult(outputs={"answer": "text"})}

    with pytest.raises(ValueError, match="at least node_id.output_key"):
        resolve_variable_selector("node", node_results)
    with pytest.raises(ValueError, match="not found or has no outputs"):
        resolve_variable_selector("missing.answer", node_results)
    with pytest.raises(ValueError, match="cannot traverse into non-dict"):
        resolve_variable_selector("node.answer.score", node_results)

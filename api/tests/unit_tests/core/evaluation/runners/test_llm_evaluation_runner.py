from core.evaluation.entities.evaluation_entity import (
    DefaultMetric,
    EvaluationDatasetInput,
    EvaluationItemInput,
    EvaluationItemResult,
    NodeInfo,
)
from core.evaluation.runners.llm_evaluation_runner import LLMEvaluationRunner, _extract_llm_output
from graphon.node_events import NodeRunResult
from tests.helpers.unit.core.evaluation.capturing_evaluation_instance import CapturingEvaluationInstance


def test_llm_runner_uses_explicit_retrieval_context_for_faithfulness() -> None:
    evaluation_instance = CapturingEvaluationInstance()
    runner = LLMEvaluationRunner(evaluation_instance)

    runner.evaluate_metrics(
        node_run_result_list=[
            NodeRunResult(
                process_data={"prompts": [{"role": "user", "text": "What is Dify?"}]},
                outputs={"text": "An LLM application platform."},
            )
        ],
        default_metric=DefaultMetric(
            metric="faithfulness",
            node_info_list=[NodeInfo(node_id="llm-1", type="llm", title="Answer")],
        ),
        model_provider="provider",
        model_name="model",
        tenant_id="tenant-1",
        dataset_items=[
            EvaluationDatasetInput(
                index=1,
                inputs={"query": "What is Dify?"},
                expected_outputs={"Answer": "Dify is a platform."},
            )
        ],
        node_info=NodeInfo(node_id="llm-1", type="llm", title="Answer"),
        context_list=[["Dify is an LLM application development platform."]],
    )

    items = evaluation_instance.llm_items
    assert items[0].context == ["Dify is an LLM application development platform."]
    assert items[0].expected_output == "Dify is a platform."


def test_llm_runner_strips_inline_reasoning_from_evaluation_output() -> None:
    def evaluate_llm(items: list[EvaluationItemInput], *_args: object) -> list[EvaluationItemResult]:
        return [EvaluationItemResult(index=item.index, actual_output=item.output) for item in items]

    evaluation_instance = CapturingEvaluationInstance(llm_result_factory=evaluate_llm)
    runner = LLMEvaluationRunner(evaluation_instance)

    results = runner.evaluate_metrics(
        node_run_result_list=[
            NodeRunResult(
                process_data={"prompts": [{"role": "user", "text": "What is Dify?"}]},
                outputs={
                    "text": (
                        "<think>\n<!--dify-deepseek-reasoning-->Private reasoning.\n</think>\n"
                        "Dify is an LLM application platform."
                    )
                },
            )
        ],
        default_metric=DefaultMetric(
            metric="answer_correctness",
            node_info_list=[NodeInfo(node_id="llm-1", type="llm", title="Answer")],
        ),
        model_provider="provider",
        model_name="model",
        tenant_id="tenant-1",
    )

    items = evaluation_instance.llm_items
    assert items[0].output == "Dify is an LLM application platform."
    assert results[0].actual_output == "Dify is an LLM application platform."


def test_llm_runner_serializes_multimodal_prompts_and_structured_output() -> None:
    evaluation_instance = CapturingEvaluationInstance()
    runner = LLMEvaluationRunner(evaluation_instance)
    metric = DefaultMetric(metric="answer_correctness", node_info_list=[])

    assert runner.evaluate_metrics([], metric, "provider", "model", "tenant") == []
    runner.evaluate_metrics(
        node_run_result_list=[
            NodeRunResult(
                process_data={
                    "prompts": [
                        {
                            "role": "system",
                            "text": ["Follow the context:", {"text": "<context>ground truth</context>"}],
                        },
                        {"text": [{"image": "asset-id"}, {"text": "What is the answer?"}]},
                    ]
                },
                outputs={"structured_output": {"answer": "你好"}},
            )
        ],
        default_metric=metric,
        model_provider="provider",
        model_name="model",
        tenant_id="tenant",
    )

    item = evaluation_instance.llm_items[0]
    assert item.context == ["ground truth"]
    assert "system: Follow the context:\n<context>ground truth</context>" in item.inputs["prompt"]
    assert 'unknown: {"image": "asset-id"}' in item.inputs["prompt"]
    assert item.output == '{"answer": "你好"}'


def test_llm_runner_handles_answer_fallback_and_absent_output() -> None:
    assert _extract_llm_output({"answer": "fallback"}) == "fallback"
    assert _extract_llm_output({}) == ""

from unittest.mock import MagicMock

from core.evaluation.entities.evaluation_entity import DefaultMetric, EvaluationDatasetInput, NodeInfo
from core.evaluation.runners.llm_evaluation_runner import LLMEvaluationRunner
from graphon.node_events import NodeRunResult


def test_llm_runner_uses_explicit_retrieval_context_for_faithfulness() -> None:
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_llm.return_value = []
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
        dataset_items=[EvaluationDatasetInput(index=1, inputs={"query": "What is Dify?"})],
        node_info=NodeInfo(node_id="llm-1", type="llm", title="Answer"),
        context_list=[["Dify is an LLM application development platform."]],
    )

    items = evaluation_instance.evaluate_llm.call_args.args[0]
    assert items[0].context == ["Dify is an LLM application development platform."]

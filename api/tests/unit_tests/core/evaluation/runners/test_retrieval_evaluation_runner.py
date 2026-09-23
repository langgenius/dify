from unittest.mock import MagicMock

from core.evaluation.entities.evaluation_entity import DefaultMetric, EvaluationDatasetInput, NodeInfo
from core.evaluation.runners.retrieval_evaluation_runner import RetrievalEvaluationRunner
from graphon.node_events import NodeRunResult


def test_retrieval_runner_resolves_expected_output_by_node_id() -> None:
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_retrieval.return_value = []
    runner = RetrievalEvaluationRunner(evaluation_instance)
    node_info = NodeInfo(node_id="retrieval-1", type="knowledge-retrieval", title="Search")

    runner.evaluate_metrics(
        node_run_result_list=[
            NodeRunResult(
                inputs={"query": "What is Dify?"},
                outputs={"result": [{"content": "Dify is an LLM application platform."}]},
            )
        ],
        default_metric=DefaultMetric(metric="context_recall", node_info_list=[node_info]),
        model_provider="provider",
        model_name="model",
        tenant_id="tenant-1",
        dataset_items=[
            EvaluationDatasetInput(
                index=1,
                inputs={"query": "What is Dify?"},
                expected_outputs={"retrieval-1": "Dify is a platform."},
            )
        ],
        node_info=node_info,
    )

    items = evaluation_instance.evaluate_retrieval.call_args.args[0]
    assert items[0].expected_output == "Dify is a platform."

from unittest.mock import MagicMock

from core.evaluation.entities.evaluation_entity import DefaultMetric, EvaluationDatasetInput, NodeInfo
from core.evaluation.runners.retrieval_evaluation_runner import RetrievalEvaluationRunner
from graphon.node_events import NodeRunResult


def test_retrieval_runner_resolves_expected_output_by_node_title() -> None:
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
                expected_outputs={"Search": "Dify is a platform."},
            )
        ],
        node_info=node_info,
    )

    items = evaluation_instance.evaluate_retrieval.call_args.args[0]
    assert items[0].expected_output == "Dify is a platform."


def test_retrieval_runner_accepts_knowledge_retrieval_v2_output_contract() -> None:
    evaluation_instance = MagicMock()
    evaluation_instance.evaluate_retrieval.return_value = []
    runner = RetrievalEvaluationRunner(evaluation_instance)
    node_info = NodeInfo(node_id="retrieval-v2", type="knowledge-retrieval-v2", title="Knowledge Retrieval V2")

    runner.evaluate_metrics(
        node_run_result_list=[
            NodeRunResult(
                inputs={"query": "What is Dify?"},
                outputs={
                    "result": [
                        {
                            "content": "Dify is an LLM application platform.",
                            "title": "Introduction",
                            "metadata": {"source": "knowledge-fs"},
                        }
                    ],
                    "metrics": {"latency_ms": 12},
                },
            )
        ],
        default_metric=DefaultMetric(metric="context_precision", node_info_list=[node_info]),
        model_provider="provider",
        model_name="model",
        tenant_id="tenant-1",
        dataset_items=[EvaluationDatasetInput(index=1, inputs={"query": "What is Dify?"})],
        node_info=node_info,
    )

    items = evaluation_instance.evaluate_retrieval.call_args.args[0]
    assert items[0].inputs == {"query": "What is Dify?"}
    assert items[0].context == ["Dify is an LLM application platform."]
    assert items[0].output == "Dify is an LLM application platform."

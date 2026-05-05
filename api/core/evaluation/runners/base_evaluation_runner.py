"""Base evaluation runner.

Provides the abstract interface for metric computation. Each concrete runner
(LLM, Retrieval, Agent, Workflow, Snippet) implements ``evaluate_metrics``
to compute scores for a specific node type.

Orchestration (merging results from multiple runners, applying judgment, and
persisting to the database) is handled by the evaluation task, not the runner.
"""

import logging
from abc import ABC, abstractmethod

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    DefaultMetric,
    EvaluationDatasetInput,
    NodeInfo,
    EvaluationItemResult,
)
from graphon.node_events import NodeRunResult

logger = logging.getLogger(__name__)


class BaseEvaluationRunner(ABC):
    """Abstract base class for evaluation runners.

    Runners are stateless metric calculators: they receive node execution
    results and a metric specification, then return scored results.  They
    do **not** touch the database or apply judgment logic.
    """

    def __init__(self, evaluation_instance: BaseEvaluationInstance):
        self.evaluation_instance = evaluation_instance

    @abstractmethod
    def evaluate_metrics(
        self,
        node_run_result_list: list[NodeRunResult],
        default_metric: DefaultMetric,
        model_provider: str,
        model_name: str,
        tenant_id: str,
        dataset_items: list[EvaluationDatasetInput] | None = None,
        node_info: NodeInfo | None = None,
    ) -> list[EvaluationItemResult]:
        """Compute evaluation metrics on the collected results.

        The returned ``EvaluationItemResult.index`` values are positional
        (0-based) and correspond to the order of *node_run_result_list*.
        The caller is responsible for mapping them back to the original
        dataset indices.
        """
        ...

import logging
from typing import Any

from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    EvaluationItemInput,
    EvaluationItemResult,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner

logger = logging.getLogger(__name__)


class RetrievalEvaluationRunner(BaseEvaluationRunner):
    """Runner for retrieval evaluation: performs knowledge base retrieval, then evaluates."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        super().__init__(evaluation_instance, session)

    def execute_target(
        self,
        tenant_id: str,
        target_id: str,
        target_type: str,
        item: EvaluationItemInput,
    ) -> EvaluationItemResult:
        """Execute retrieval using DatasetRetrieval and collect context documents."""
        from core.rag.retrieval.dataset_retrieval import DatasetRetrieval

        query = self._extract_query(item.inputs)

        dataset_retrieval = DatasetRetrieval()

        # Use knowledge_retrieval for structured results
        try:
            from core.rag.retrieval.dataset_retrieval import KnowledgeRetrievalRequest

            request = KnowledgeRetrievalRequest(
                query=query,
                app_id=target_id,
                tenant_id=tenant_id,
            )
            sources = dataset_retrieval.knowledge_retrieval(request)
            retrieved_contexts = [source.content for source in sources if source.content]
        except (ImportError, AttributeError):
            logger.warning("KnowledgeRetrievalRequest not available, using simple retrieval")
            retrieved_contexts = []

        return EvaluationItemResult(
            index=item.index,
            actual_output="\n\n".join(retrieved_contexts) if retrieved_contexts else "",
            metadata={"retrieved_contexts": retrieved_contexts},
        )

    def evaluate_metrics(
        self,
        items: list[EvaluationItemInput],
        results: list[EvaluationItemResult],
        default_metrics: list[dict[str, Any]],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Compute retrieval evaluation metrics."""
        # Merge retrieved contexts into items
        result_by_index = {r.index: r for r in results}
        merged_items = []
        for item in items:
            result = result_by_index.get(item.index)
            contexts = result.metadata.get("retrieved_contexts", []) if result else []
            merged_items.append(
                EvaluationItemInput(
                    index=item.index,
                    inputs=item.inputs,
                    expected_output=item.expected_output,
                    context=contexts,
                )
            )

        evaluated = self.evaluation_instance.evaluate_retrieval(
            merged_items, default_metrics, model_provider, model_name, tenant_id
        )

        # Merge metrics back into original results (preserve actual_output and metadata)
        eval_by_index = {r.index: r for r in evaluated}
        final_results = []
        for result in results:
            if result.index in eval_by_index:
                eval_result = eval_by_index[result.index]
                final_results.append(
                    EvaluationItemResult(
                        index=result.index,
                        actual_output=result.actual_output,
                        metrics=eval_result.metrics,
                        metadata=result.metadata,
                        error=result.error,
                    )
                )
            else:
                final_results.append(result)
        return final_results

    @staticmethod
    def _extract_query(inputs: dict[str, Any]) -> str:
        for key in ("query", "question", "input", "text"):
            if key in inputs:
                return str(inputs[key])
        values = list(inputs.values())
        return str(values[0]) if values else ""

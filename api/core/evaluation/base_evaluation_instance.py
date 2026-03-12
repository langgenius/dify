import json
import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

from core.evaluation.entities.evaluation_entity import (
    CustomizedMetrics,
    DefaultMetric,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
)
from core.workflow.node_events import NodeRunResult

logger = logging.getLogger(__name__)


class BaseEvaluationInstance(ABC):
    """Abstract base class for evaluation framework adapters. """

    @abstractmethod
    def evaluate_llm(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate LLM outputs using the configured framework."""
        ...

    @abstractmethod
    def evaluate_retrieval(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate retrieval quality using the configured framework."""
        ...

    @abstractmethod
    def evaluate_agent(
        self,
        items: list[EvaluationItemInput],
        metric_name: str,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate agent outputs using the configured framework."""
        ...

    @abstractmethod
    def get_supported_metrics(self, category: EvaluationCategory) -> list[str]:
        """Return the list of supported metric names for a given evaluation category."""
        ...

    def evaluate_with_customized_workflow(
        self,
        node_run_result_mapping_list: list[dict[str, NodeRunResult]],
        customized_metrics: CustomizedMetrics,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate using a published workflow as the evaluator.

        The evaluator workflow's output variables are treated as metrics:
        each output variable name becomes a metric name, and its value
        becomes the score.

        Args:
            items: Evaluation items with inputs, expected_output, context.
            results: Results from Phase 1 (with actual_output populated).
            customized_metrics: Must contain ``evaluation_workflow_id``
                pointing to a published WORKFLOW-type App.
            tenant_id: Tenant scope.

        Returns:
            A list of ``EvaluationItemResult`` with metrics extracted from
            the workflow outputs.
        """
        from sqlalchemy.orm import Session

        from core.app.apps.workflow.app_generator import WorkflowAppGenerator
        from core.app.entities.app_invoke_entities import InvokeFrom
        from core.evaluation.runners import get_service_account_for_app
        from models.engine import db
        from models.model import App
        from services.workflow_service import WorkflowService

        workflow_id = customized_metrics.get("evaluation_workflow_id")
        if not workflow_id:
            raise ValueError(
                "customized_metrics must contain 'evaluation_workflow_id' for customized evaluator"
            )

        # Load the evaluator workflow resources using a dedicated session
        with Session(db.engine, expire_on_commit=False) as session, session.begin():
            app = session.query(App).filter_by(
                id=workflow_id, tenant_id=tenant_id
            ).first()
            if not app:
                raise ValueError(
                    f"Evaluation workflow app {workflow_id} not found in tenant {tenant_id}"
                )
            service_account = get_service_account_for_app(session, workflow_id)

        workflow_service = WorkflowService()
        published_workflow = workflow_service.get_published_workflow(app_model=app)
        if not published_workflow:
            raise ValueError(
                f"No published workflow found for evaluation app {workflow_id}"
            )

        eval_results: list[EvaluationItemResult] = []
        for node_run_result_mapping in node_run_result_mapping_list:
            try:
                workflow_inputs = self._build_workflow_inputs(customized_metrics.input_fields, node_run_result_mapping)

                generator = WorkflowAppGenerator()
                response: Mapping[str, Any] = generator.generate(
                    app_model=app,
                    workflow=published_workflow,
                    user=service_account,
                    args={"inputs": workflow_inputs},
                    invoke_from=InvokeFrom.SERVICE_API,
                    streaming=False,
                )

                metrics = self._extract_workflow_metrics(response)
                eval_results.append(
                    EvaluationItemResult(
                        index=item.index,
                        metrics=metrics,
                        metadata={
                            "workflow_response": _safe_serialize(response),
                        },
                    )
                )
            except Exception:
                logger.exception(
                    "Customized evaluator failed for item %d with workflow %s",
                    item.index,
                    workflow_id,
                )
                eval_results.append(EvaluationItemResult(index=item.index))

        return eval_results

    @staticmethod
    def _build_workflow_inputs(
        input_fields: dict[str, Any],
        node_run_result_mapping: dict[str, NodeRunResult],
    ) -> dict[str, Any]:
        """Build workflow input dict from evaluation data.

        Maps evaluation data to conventional workflow input variable names:
          - ``actual_output``: The target's actual output (from ``result``).
          - ``expected_output``: The expected/reference output.
          - ``inputs``: The original evaluation inputs as a JSON string.
          - ``context``: All context strings joined by newlines.
        """
        workflow_inputs: dict[str, Any] = {}

        if result and result.actual_output:
            workflow_inputs["actual_output"] = result.actual_output

        if item.expected_output:
            workflow_inputs["expected_output"] = item.expected_output

        if item.inputs:
            workflow_inputs["inputs"] = json.dumps(item.inputs, ensure_ascii=False)

        if item.context:
            workflow_inputs["context"] = "\n\n".join(item.context)

        return workflow_inputs

    @staticmethod
    def _extract_workflow_metrics(
        response: Mapping[str, Any],
    ) -> list[EvaluationMetric]:
        """Extract evaluation metrics from workflow output variables.

        Each output variable is treated as a metric. The variable name
        becomes the metric name, and its value becomes the score.
        Non-numeric values are recorded with ``score=0.0`` and the raw
        value stored in ``details``.
        """
        metrics: list[EvaluationMetric] = []

        data = response.get("data", {})
        if not isinstance(data, Mapping):
            logger.warning("Unexpected workflow response format: missing 'data' dict")
            return metrics

        outputs = data.get("outputs", {})
        if not isinstance(outputs, Mapping):
            logger.warning(
                "Unexpected workflow response format: 'outputs' is not a dict"
            )
            return metrics

        for key, value in outputs.items():
            try:
                score = float(value)
                metrics.append(EvaluationMetric(name=key, score=score))
            except (TypeError, ValueError):
                metrics.append(
                    EvaluationMetric(
                        name=key, score=0.0, details={"raw_value": value}
                    )
                )

        return metrics


def _safe_serialize(response: Mapping[str, Any]) -> dict[str, Any]:
    """Safely serialize workflow response for metadata storage."""
    try:
        return dict(response)
    except Exception:
        return {"raw": str(response)}

"""Customized workflow-based evaluator.

Uses a published workflow as the evaluation strategy. The target's actual output,
expected output, original inputs, and context are passed as workflow inputs.
The workflow's output variables are treated as evaluation metrics.

The evaluation workflow_id is provided per evaluation run via
metrics_config["workflow_id"].

"""

import json
import logging
from collections.abc import Mapping
from typing import Any

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.config_entity import CustomizedEvaluatorConfig
from core.evaluation.entities.evaluation_entity import (
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
)

logger = logging.getLogger(__name__)


class CustomizedEvaluator(BaseEvaluationInstance):
    """Evaluate using a published workflow."""

    def __init__(self, config: CustomizedEvaluatorConfig):
        self.config = config

    def evaluate_llm(
        self,
        items: list[EvaluationItemInput],
        metrics_config: dict,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate_with_workflow(items, metrics_config, tenant_id)

    def evaluate_retrieval(
        self,
        items: list[EvaluationItemInput],
        metrics_config: dict,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate_with_workflow(items, metrics_config, tenant_id)

    def evaluate_agent(
        self,
        items: list[EvaluationItemInput],
        metrics_config: dict,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate_with_workflow(items, metrics_config, tenant_id)

    def evaluate_workflow(
        self,
        items: list[EvaluationItemInput],
        metrics_config: dict,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        return self._evaluate_with_workflow(items, metrics_config, tenant_id)

    def get_supported_metrics(self, category: EvaluationCategory) -> list[str]:
        """Metrics are dynamic and defined by the evaluation workflow outputs.

        Return an empty list since available metrics depend on the specific
        workflow chosen at runtime.
        """
        return []

    def _evaluate_with_workflow(
        self,
        items: list[EvaluationItemInput],
        metrics_config: dict,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Run the evaluation workflow for each item and extract metric scores.

        Args:
            items: Evaluation items with inputs, expected_output, and context
                (context typically contains the target's actual_output, merged
                by the Runner's evaluate_metrics method).
            metrics_config: Must contain "workflow_id" pointing to a published
                WORKFLOW-type App.
            tenant_id: Tenant scope for database and workflow execution.

        Returns:
            List of EvaluationItemResult with metrics extracted from workflow outputs.

        Raises:
            ValueError: If workflow_id is missing from metrics_config or the
                workflow/app cannot be found.
        """
        workflow_id = metrics_config.get("workflow_id")
        if not workflow_id:
            raise ValueError(
                "metrics_config must contain 'workflow_id' for customized evaluator"
            )

        app, workflow, service_account = self._load_workflow_resources(workflow_id, tenant_id)

        results: list[EvaluationItemResult] = []
        for item in items:
            try:
                result = self._evaluate_single_item(app, workflow, service_account, item)
                results.append(result)
            except Exception:
                logger.exception(
                    "Customized evaluator failed for item %d with workflow %s",
                    item.index,
                    workflow_id,
                )
                results.append(EvaluationItemResult(index=item.index))
        return results

    def _evaluate_single_item(
        self,
        app: Any,
        workflow: Any,
        service_account: Any,
        item: EvaluationItemInput,
    ) -> EvaluationItemResult:
        """Run the evaluation workflow for a single item.

        Builds workflow inputs from the item data and executes the workflow
        in non-streaming mode. Extracts metrics from the workflow's output
        variables.
        """
        from core.app.apps.workflow.app_generator import WorkflowAppGenerator
        from core.app.entities.app_invoke_entities import InvokeFrom

        workflow_inputs = self._build_workflow_inputs(item)

        generator = WorkflowAppGenerator()
        response: Mapping[str, Any] = generator.generate(
            app_model=app,
            workflow=workflow,
            user=service_account,
            args={"inputs": workflow_inputs},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
        )

        metrics = self._extract_metrics(response)
        return EvaluationItemResult(
            index=item.index,
            metrics=metrics,
            metadata={"workflow_response": self._safe_serialize(response)},
        )

    def _load_workflow_resources(
        self, workflow_id: str, tenant_id: str
    ) -> tuple[Any, Any, Any]:
        """Load the evaluation workflow App, its published workflow, and a service account.

        Args:
            workflow_id: The App ID of the evaluation workflow.
            tenant_id: Tenant scope.

        Returns:
            Tuple of (app, workflow, service_account).

        Raises:
            ValueError: If the app or published workflow cannot be found.
        """
        from sqlalchemy.orm import Session

        from core.evaluation.runners import get_service_account_for_app
        from models.engine import db
        from models.model import App
        from services.workflow_service import WorkflowService

        with Session(db.engine, expire_on_commit=False) as session, session.begin():
            app = session.query(App).filter_by(id=workflow_id, tenant_id=tenant_id).first()
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

        return app, published_workflow, service_account

    @staticmethod
    def _build_workflow_inputs(item: EvaluationItemInput) -> dict[str, Any]:
        """Build workflow input dict from an evaluation item.

        Maps evaluation data to conventional workflow input variable names:
        - actual_output: The target's actual output (from context[0] if available)
        - expected_output: The expected/reference output
        - inputs: The original evaluation inputs as JSON string
        - context: All context strings joined by newlines

        """
        workflow_inputs: dict[str, Any] = {}

        # The actual_output is typically the first element in context
        # (merged by the Runner's evaluate_metrics method)
        if item.context:
            workflow_inputs["actual_output"] = item.context[0] if len(item.context) == 1 else "\n\n".join(item.context)

        if item.expected_output:
            workflow_inputs["expected_output"] = item.expected_output

        if item.inputs:
            workflow_inputs["inputs"] = json.dumps(item.inputs, ensure_ascii=False)

        if item.context and len(item.context) > 1:
            workflow_inputs["context"] = "\n\n".join(item.context)

        return workflow_inputs

    @staticmethod
    def _extract_metrics(response: Mapping[str, Any]) -> list[EvaluationMetric]:
        """Extract evaluation metrics from workflow output variables.

        Each output variable is treated as a metric. 
        """
        metrics: list[EvaluationMetric] = []

        data = response.get("data", {})
        if not isinstance(data, Mapping):
            logger.warning("Unexpected workflow response format: missing 'data' dict")
            return metrics

        outputs = data.get("outputs", {})
        if not isinstance(outputs, Mapping):
            logger.warning("Unexpected workflow response format: 'outputs' is not a dict")
            return metrics

        for key, value in outputs.items():
            try:
                score = float(value)
                metrics.append(EvaluationMetric(name=key, score=score))
            except (TypeError, ValueError):
                metrics.append(
                    EvaluationMetric(name=key, score=0.0, details={"raw_value": value})
                )

        return metrics

    @staticmethod
    def _safe_serialize(response: Mapping[str, Any]) -> dict[str, Any]:
        """Safely serialize workflow response for metadata storage."""
        try:
            return dict(response)
        except Exception:
            return {"raw": str(response)}

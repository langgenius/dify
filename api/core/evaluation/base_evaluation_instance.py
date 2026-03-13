import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

from core.evaluation.entities.evaluation_entity import (
    CustomizedMetrics,
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
            node_run_result_mapping_list: One mapping per test-data item,
                where each mapping is ``{node_id: NodeRunResult}`` from the
                target execution.
            customized_metrics: Contains ``evaluation_workflow_id`` (the
                published evaluator workflow) and ``input_fields`` (value
                sources for the evaluator's input variables).
            tenant_id: Tenant scope.

        Returns:
            A list of ``EvaluationItemResult`` with metrics extracted from
            the evaluator workflow's output variables.
        """
        from sqlalchemy.orm import Session

        from core.app.apps.workflow.app_generator import WorkflowAppGenerator
        from core.app.entities.app_invoke_entities import InvokeFrom
        from core.evaluation.runners import get_service_account_for_app
        from models.engine import db
        from models.model import App
        from services.workflow_service import WorkflowService

        workflow_id = customized_metrics.evaluation_workflow_id
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
        for idx, node_run_result_mapping in enumerate(node_run_result_mapping_list):
            try:
                workflow_inputs = self._build_workflow_inputs(
                    customized_metrics.input_fields, node_run_result_mapping,
                )

                generator = WorkflowAppGenerator()
                response: Mapping[str, Any] = generator.generate(
                    app_model=app,
                    workflow=published_workflow,
                    user=service_account,
                    args={"inputs": workflow_inputs},
                    invoke_from=InvokeFrom.SERVICE_API,
                    streaming=False,
                    call_depth=0,
                )

                metrics = self._extract_workflow_metrics(response)
                eval_results.append(
                    EvaluationItemResult(
                        index=idx,
                        metrics=metrics,
                    )
                )
            except Exception:
                logger.exception(
                    "Customized evaluator failed for item %d with workflow %s",
                    idx,
                    workflow_id,
                )
                eval_results.append(EvaluationItemResult(index=idx))

        return eval_results

    @staticmethod
    def _build_workflow_inputs(
        input_fields: dict[str, Any],
        node_run_result_mapping: dict[str, NodeRunResult],
    ) -> dict[str, Any]:
        """Build customized workflow inputs by resolving value sources.

        Each entry in ``input_fields`` maps a workflow input variable name
        to its value source, which can be:

          - **Constant**: a plain string without ``{{#…#}}`` used as-is.
          - **Expression**: a string containing one or more
            ``{{#node_id.output_key#}}`` selectors (same format as
            ``VariableTemplateParser``) resolved from
            ``node_run_result_mapping``.

        """
        from core.workflow.nodes.base.variable_template_parser import REGEX as VARIABLE_REGEX

        workflow_inputs: dict[str, Any] = {}

        for field_name, value_source in input_fields.items():
            if not isinstance(value_source, str):
                # Non-string values (numbers, bools, dicts) are used directly.
                workflow_inputs[field_name] = value_source
                continue

            # Check if the entire value is a single expression.
            full_match = VARIABLE_REGEX.fullmatch(value_source)
            if full_match:
                workflow_inputs[field_name] = _resolve_variable_selector(
                    full_match.group(1), node_run_result_mapping,
                )
            elif VARIABLE_REGEX.search(value_source):
                # Mixed template: interpolate all expressions as strings.
                workflow_inputs[field_name] = VARIABLE_REGEX.sub(
                    lambda m: str(
                        _resolve_variable_selector(m.group(1), node_run_result_mapping)
                    ),
                    value_source,
                )
            else:
                # Plain constant — no expression markers.
                workflow_inputs[field_name] = value_source

        return workflow_inputs

    @staticmethod
    def _extract_workflow_metrics(
        response: Mapping[str, object],
    ) -> list[EvaluationMetric]:
        """Extract evaluation metrics from workflow output variables.

        Each output variable is treated as a metric. The variable name
        becomes the metric name, and its value is stored as-is regardless
        of type (numeric, string, dict, etc.).
        """
        metrics: list[EvaluationMetric] = []

        data = response.get("data")
        if not isinstance(data, Mapping):
            logger.warning("Unexpected workflow response format: missing 'data' dict")
            return metrics

        outputs = data.get("outputs")
        if not isinstance(outputs, dict):
            logger.warning(
                "Unexpected workflow response format: 'outputs' is not a dict"
            )
            return metrics

        for key, raw_value in outputs.items():
            if not isinstance(key, str):
                continue
            metrics.append(EvaluationMetric(name=key, value=raw_value))

        return metrics


def _resolve_variable_selector(
    selector_raw: str,
    node_run_result_mapping: dict[str, NodeRunResult],
) -> object:
    """Resolve a ``#node_id.output_key#`` selector against node run results.
    Returns the resolved value in its original type, or an empty string
    if the node or any key along the path is not found.
    """
    # "#node_id.output_key#" → "node_id.output_key"
    cleaned = selector_raw.strip("#")
    parts = cleaned.split(".")

    if len(parts) < 2:
        logger.warning(
            "Selector '%s' must have at least node_id.output_key", selector_raw,
        )
        return ""

    node_id = parts[0]
    output_path = parts[1:]

    node_result = node_run_result_mapping.get(node_id)
    if not node_result or not node_result.outputs:
        logger.warning(
            "Selector '%s': node '%s' not found or has no outputs",
            selector_raw, node_id,
        )
        return ""

    # Traverse the output path to support nested keys.
    current: object = node_result.outputs
    for key in output_path:
        if isinstance(current, Mapping):
            next_val = current.get(key)
            if next_val is None:
                logger.warning(
                    "Selector '%s': key '%s' not found in node '%s' outputs",
                    selector_raw, key, node_id,
                )
                return ""
            current = next_val
        else:
            logger.warning(
                "Selector '%s': cannot traverse into non-dict value at key '%s'",
                selector_raw, key,
            )
            return ""

    return current if current is not None else ""

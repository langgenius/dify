import logging
from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping
from typing import Any

from core.evaluation.entities.evaluation_entity import (
    CustomizedMetrics,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
    EvaluationMetric,
    NodeInfo,
)
from graphon.node_events.base import NodeRunResult

logger = logging.getLogger(__name__)


class BaseEvaluationInstance(ABC):
    """Abstract base class for evaluation framework adapters."""

    @abstractmethod
    def evaluate_llm(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
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
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate retrieval quality using the configured framework."""
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
        cancellation_check: Callable[[], None] | None = None,
        task_id_factory: Callable[[int], str] | None = None,
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
        from core.app.apps.workflow.app_generator import WorkflowAppGenerator
        from core.app.entities.app_invoke_entities import InvokeFrom
        from core.db.session_factory import session_factory
        from core.evaluation.runners import get_service_account_for_app
        from models.model import App
        from services.workflow_service import WorkflowService

        workflow_id = customized_metrics.evaluation_workflow_id
        if not workflow_id:
            raise ValueError("customized_metrics must contain 'evaluation_workflow_id' for customized evaluator")

        with session_factory.create_session() as session:
            app = session.query(App).filter_by(id=workflow_id, tenant_id=tenant_id).first()
            if not app:
                raise ValueError(f"Evaluation workflow app {workflow_id} not found in tenant {tenant_id}")
            service_account = get_service_account_for_app(session, workflow_id, tenant_id)
            workflow_service = WorkflowService()
            if customized_metrics.evaluation_workflow_version_id:
                published_workflow = workflow_service.get_published_workflow_by_id(
                    app_model=app,
                    workflow_id=customized_metrics.evaluation_workflow_version_id,
                    session=session,
                )
            else:
                published_workflow = workflow_service.get_published_workflow(app_model=app, session=session)
        if not published_workflow:
            raise ValueError(f"No published workflow found for evaluation app {workflow_id}")

        eval_results: list[EvaluationItemResult] = []
        for idx, node_run_result_mapping in enumerate(node_run_result_mapping_list):
            if cancellation_check is not None:
                cancellation_check()
            try:
                workflow_inputs = self._build_workflow_inputs(
                    customized_metrics.input_fields,
                    node_run_result_mapping,
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
                    task_id=task_id_factory(idx) if task_id_factory is not None else None,
                )

                metrics = self._extract_workflow_metrics(
                    response,
                    workflow_id,
                    {field.variable for field in customized_metrics.output_fields},
                )
                if not metrics:
                    raise ValueError("Evaluation workflow returned none of the configured metric outputs")
                eval_results.append(
                    EvaluationItemResult(
                        index=idx,
                        metrics=metrics,
                    )
                )
            except Exception as exc:
                logger.exception(
                    "Customized evaluator failed for item %d with workflow %s",
                    idx,
                    workflow_id,
                )
                eval_results.append(
                    EvaluationItemResult(
                        index=idx,
                        error=f"Customized evaluation failed: {exc}",
                    )
                )
            if cancellation_check is not None:
                cancellation_check()

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
        from graphon.nodes.base.variable_template_parser import REGEX as VARIABLE_REGEX

        workflow_inputs: dict[str, Any] = {}

        for field_name, value_source in input_fields.items():
            if not isinstance(value_source, str):
                # Non-string values (numbers, bools, dicts) are used directly.
                workflow_inputs[field_name] = value_source
                continue

            # Check if the entire value is a single expression.
            full_match = VARIABLE_REGEX.fullmatch(value_source)
            if full_match:
                workflow_inputs[field_name] = resolve_variable_selector(
                    full_match.group(1),
                    node_run_result_mapping,
                )
            elif VARIABLE_REGEX.search(value_source):
                # Mixed template: interpolate all expressions as strings.
                workflow_inputs[field_name] = VARIABLE_REGEX.sub(
                    lambda m: str(resolve_variable_selector(m.group(1), node_run_result_mapping)),
                    value_source,
                )
            else:
                # Plain constant — no expression markers.
                workflow_inputs[field_name] = value_source

        return workflow_inputs

    @staticmethod
    def _extract_workflow_metrics(
        response: Mapping[str, object],
        evaluation_workflow_id: str,
        output_variables: set[str],
    ) -> list[EvaluationMetric]:
        """Extract evaluation metrics from workflow output variables.

        Each metric's ``node_info`` is set with *evaluation_workflow_id* as
        the ``node_id``, so that judgment conditions can reference customized
        metrics via ``variable_selector: [evaluation_workflow_id, metric_name]``.
        """
        metrics: list[EvaluationMetric] = []
        node_info = NodeInfo(node_id=evaluation_workflow_id, type="customized", title="customized")

        data = response.get("data")
        if not isinstance(data, Mapping):
            logger.warning("Unexpected workflow response format: missing 'data' dict")
            return metrics

        outputs = data.get("outputs")
        if not isinstance(outputs, dict):
            logger.warning("Unexpected workflow response format: 'outputs' is not a dict")
            return metrics

        for key, raw_value in outputs.items():
            if not isinstance(key, str) or key not in output_variables:
                continue
            metrics.append(EvaluationMetric(name=key, value=raw_value, node_info=node_info))

        return metrics


def resolve_variable_selector(
    selector_raw: str,
    node_run_result_mapping: dict[str, NodeRunResult],
) -> object:
    """
    Resolve a ``#node_id.output_key#`` selector against node run results.
    """
    #
    cleaned = selector_raw.strip("#")
    parts = cleaned.split(".")

    if len(parts) < 2:
        raise ValueError(f"Selector '{selector_raw}' must have at least node_id.output_key")

    node_id = parts[0]
    output_path = parts[1:]

    node_result = node_run_result_mapping.get(node_id)
    if not node_result or not node_result.outputs:
        raise ValueError(f"Selector '{selector_raw}': node '{node_id}' not found or has no outputs")

    # Traverse the output path to support nested keys.
    current: object = node_result.outputs
    for key in output_path:
        if isinstance(current, Mapping):
            next_val = current.get(key)
            if next_val is None:
                raise ValueError(f"Selector '{selector_raw}': key '{key}' not found in node '{node_id}' outputs")
            current = next_val
        else:
            raise ValueError(f"Selector '{selector_raw}': cannot traverse into non-dict value at key '{key}'")

    return current if current is not None else ""

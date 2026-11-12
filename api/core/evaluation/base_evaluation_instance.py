import logging
from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any

from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
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
    def evaluate_agent(
        self,
        items: list[AgentEvaluationItem],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Evaluate legacy Agent tool-use behavior using the configured framework."""
        ...

    @abstractmethod
    def get_supported_metrics(self, category: EvaluationCategory) -> list[str]:
        """Return the list of supported metric names for a given evaluation category."""
        ...

    def metric_requires_embeddings(self, metric_name: str) -> bool:
        """Return whether a metric needs the tenant's default embedding model."""
        return False

    def metric_requires_expected_output(self, metric_name: str) -> bool:
        """Return whether a metric requires a reference answer in the dataset."""
        return False

    def metric_requires_expected_tool_calls(self, metric_name: str) -> bool:
        """Return whether a metric requires reference tool calls in the dataset."""
        return False

    def metric_accepts_success_criteria(self, metric_name: str) -> bool:
        """Return whether a metric accepts optional Agent success requirements."""
        return False

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

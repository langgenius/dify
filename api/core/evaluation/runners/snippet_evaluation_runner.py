"""Runner for Snippet evaluation.

Executes a published Snippet workflow in non-streaming mode, collects the
actual outputs and per-node execution records, then delegates to the
evaluation instance for metric computation.

"""

import json
import logging
from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import asc, select
from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    CustomizedMetrics,
    DefaultMetric,
    EvaluationItemInput,
    EvaluationItemResult,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from core.workflow.node_events import NodeRunResult
from models.snippet import CustomizedSnippet
from models.workflow import WorkflowNodeExecutionModel

logger = logging.getLogger(__name__)


class SnippetEvaluationRunner(BaseEvaluationRunner):
    """Runner for snippet evaluation: executes a published Snippet workflow."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        super().__init__(evaluation_instance, session)

    def execute_target(
        self,
        tenant_id: str,
        target_id: str,
        target_type: str,
        item: EvaluationItemInput,
    ) -> EvaluationItemResult:
        """Execute a published Snippet workflow and collect outputs.

        Steps:
          1. Delegate execution to ``SnippetGenerateService.run_published``.
          2. Extract ``workflow_run_id`` from the blocking response.
          3. Query ``workflow_node_executions`` by ``workflow_run_id`` to get
             each node's inputs, outputs, status, elapsed_time, etc.
          4. Return result with actual_output and node_executions metadata.
        """
        from core.app.entities.app_invoke_entities import InvokeFrom
        from core.evaluation.runners import get_service_account_for_snippet
        from services.snippet_generate_service import SnippetGenerateService

        snippet = self.session.query(CustomizedSnippet).filter_by(id=target_id).first()
        if not snippet:
            raise ValueError(f"Snippet {target_id} not found")

        if not snippet.is_published:
            raise ValueError(f"Snippet {target_id} is not published")

        service_account = get_service_account_for_snippet(self.session, target_id)

        response = SnippetGenerateService.run_published(
            snippet=snippet,
            user=service_account,
            args={"inputs": item.inputs},
            invoke_from=InvokeFrom.SERVICE_API,
        )

        actual_output = self._extract_output(response)

        # Retrieve per-node execution records from DB
        workflow_run_id = self._extract_workflow_run_id(response)
        node_executions = self._query_node_executions(
            tenant_id=tenant_id,
            app_id=target_id,
            workflow_run_id=workflow_run_id,
        ) if workflow_run_id else []

        return EvaluationItemResult(
            index=item.index,
            actual_output=actual_output,
            metadata={
                "workflow_run_id": workflow_run_id or "",
                "node_executions": node_executions,
            },
        )

    def evaluate_metrics(
        self,
        node_run_result_mapping: dict[str, NodeRunResult] | None,
        node_run_result: NodeRunResult | None,
        default_metric: DefaultMetric | None,
        customized_metrics: CustomizedMetrics | None,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Compute evaluation metrics for snippet outputs.

        Snippets are essentially workflows, so we reuse evaluate_workflow from
        the evaluation instance.
        """
        result_by_index = {r.index: r for r in results}
        merged_items = []
        for item in items:
            result = result_by_index.get(item.index)
            context = []
            if result and result.actual_output:
                context.append(result.actual_output)
            merged_items.append(
                EvaluationItemInput(
                    index=item.index,
                    inputs=item.inputs,
                    expected_output=item.expected_output,
                    context=context + (item.context or []),
                )
            )

        evaluated = self.evaluation_instance.evaluate_workflow(
            merged_items, default_metrics, model_provider, model_name, tenant_id
        )

        # Merge metrics back preserving metadata from Phase 1
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
    def _extract_output(response: Mapping[str, Any]) -> str:
        """Extract text output from the blocking workflow response.

        The blocking response ``data.outputs`` is a dict of output variables.
        We take the first value as the primary output text.
        """
        if "data" in response and isinstance(response["data"], Mapping):
            outputs = response["data"].get("outputs", {})
            if isinstance(outputs, Mapping):
                values = list(outputs.values())
                return str(values[0]) if values else ""
            return str(outputs)
        return str(response)

    @staticmethod
    def _extract_workflow_run_id(response: Mapping[str, Any]) -> str | None:
        """Extract workflow_run_id from the blocking response.

        The blocking response has ``workflow_run_id`` at the top level and
        also ``data.id`` (same value).
        """
        wf_run_id = response.get("workflow_run_id")
        if wf_run_id:
            return str(wf_run_id)
        # Fallback to data.id
        data = response.get("data")
        if isinstance(data, Mapping) and data.get("id"):
            return str(data["id"])
        return None

    def _query_node_executions(
        self,
        tenant_id: str,
        app_id: str,
        workflow_run_id: str,
    ) -> list[dict[str, Any]]:
        """Query per-node execution records from the DB after workflow completes.

        Node executions are persisted during workflow execution. We read them
        back via the ``workflow_run_id`` to get each node's inputs, outputs,
        status, elapsed_time, etc.

        Returns a list of serialisable dicts for storage in ``metadata``.
        """
        stmt = WorkflowNodeExecutionModel.preload_offload_data(
            select(WorkflowNodeExecutionModel)
        ).where(
            WorkflowNodeExecutionModel.tenant_id == tenant_id,
            WorkflowNodeExecutionModel.app_id == app_id,
            WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
        ).order_by(asc(WorkflowNodeExecutionModel.created_at))

        node_models: Sequence[WorkflowNodeExecutionModel] = (
            self.session.execute(stmt).scalars().all()
        )

        return [self._serialize_node_execution(node) for node in node_models]

    @staticmethod
    def _serialize_node_execution(node: WorkflowNodeExecutionModel) -> dict[str, Any]:
        """Convert a WorkflowNodeExecutionModel to a serialisable dict.

        Includes the node's id, type, title, inputs/outputs (parsed from JSON),
        status, error, and elapsed_time.  The virtual Start node injected by
        SnippetGenerateService is filtered out by the caller if needed.
        """
        def _safe_parse_json(value: str | None) -> Any:
            if not value:
                return None
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return value

        return {
            "id": node.id,
            "node_id": node.node_id,
            "node_type": node.node_type,
            "title": node.title,
            "inputs": _safe_parse_json(node.inputs),
            "outputs": _safe_parse_json(node.outputs),
            "status": node.status,
            "error": node.error,
            "elapsed_time": node.elapsed_time,
        }

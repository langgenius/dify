import logging
from collections.abc import Mapping
from typing import Any, Union

from sqlalchemy.orm import Session

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    EvaluationItemInput,
    EvaluationItemResult,
)
from core.evaluation.runners.base_evaluation_runner import BaseEvaluationRunner
from models.model import App, AppMode

logger = logging.getLogger(__name__)


class LLMEvaluationRunner(BaseEvaluationRunner):
    """Runner for LLM evaluation: executes App to get responses, then evaluates."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        super().__init__(evaluation_instance, session)

    def execute_target(
        self,
        tenant_id: str,
        target_id: str,
        target_type: str,
        item: EvaluationItemInput,
    ) -> EvaluationItemResult:
        """Execute the App/Snippet with the given inputs and collect the response."""
        from core.app.apps.completion.app_generator import CompletionAppGenerator
        from core.app.apps.workflow.app_generator import WorkflowAppGenerator
        from core.app.entities.app_invoke_entities import InvokeFrom
        from core.evaluation.runners import get_service_account_for_app
        from services.workflow_service import WorkflowService

        app = self.session.query(App).filter_by(id=target_id).first()
        if not app:
            raise ValueError(f"App {target_id} not found")

        # Get a service account for invocation
        service_account = get_service_account_for_app(self.session, target_id)

        app_mode = AppMode.value_of(app.mode)

        # Build args from evaluation item inputs
        args: dict[str, Any] = {
            "inputs": item.inputs,
        }
        # For completion/chat modes, first text input becomes query
        if app_mode in (AppMode.COMPLETION, AppMode.CHAT):
            query = self._extract_query(item.inputs)
            args["query"] = query

        if app_mode in (AppMode.WORKFLOW, AppMode.ADVANCED_CHAT):
            workflow_service = WorkflowService()
            workflow = workflow_service.get_published_workflow(app_model=app)
            if not workflow:
                raise ValueError(f"No published workflow found for app {target_id}")

            generator = WorkflowAppGenerator()
            response: Mapping[str, Any] = generator.generate(
                app_model=app,
                workflow=workflow,
                user=service_account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )
        elif app_mode == AppMode.COMPLETION:
            generator = CompletionAppGenerator()
            response = generator.generate(
                app_model=app,
                user=service_account,
                args=args,
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )
        else:
            raise ValueError(f"Unsupported app mode for LLM evaluation: {app_mode}")

        actual_output = self._extract_output(response)
        return EvaluationItemResult(
            index=item.index,
            actual_output=actual_output,
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
        """Use the evaluation instance to compute LLM metrics."""
        # Merge actual_output into items for evaluation
        merged_items = self._merge_results_into_items(items, results)
        return self.evaluation_instance.evaluate_llm(
            merged_items, default_metrics, model_provider, model_name, tenant_id
        )

    @staticmethod
    def _extract_query(inputs: dict[str, Any]) -> str:
        """Extract query from inputs."""
        for key in ("query", "question", "input", "text"):
            if key in inputs:
                return str(inputs[key])
        values = list(inputs.values())
        return str(values[0]) if values else ""

    @staticmethod
    def _extract_output(response: Union[Mapping[str, Any], Any]) -> str:
        """Extract text output from app response."""
        if isinstance(response, Mapping):
            # Workflow response
            if "data" in response and isinstance(response["data"], Mapping):
                outputs = response["data"].get("outputs", {})
                if isinstance(outputs, Mapping):
                    values = list(outputs.values())
                    return str(values[0]) if values else ""
                return str(outputs)
            # Completion response
            if "answer" in response:
                return str(response["answer"])
            if "text" in response:
                return str(response["text"])
        return str(response)

    @staticmethod
    def _merge_results_into_items(
        items: list[EvaluationItemInput],
        results: list[EvaluationItemResult],
    ) -> list[EvaluationItemInput]:
        """Create new items with actual_output set as expected_output context for metrics."""
        result_by_index = {r.index: r for r in results}
        merged = []
        for item in items:
            result = result_by_index.get(item.index)
            if result and result.actual_output:
                merged.append(
                    EvaluationItemInput(
                        index=item.index,
                        inputs=item.inputs,
                        expected_output=item.expected_output,
                        context=[result.actual_output] + (item.context or []),
                    )
                )
            else:
                merged.append(item)
        return merged

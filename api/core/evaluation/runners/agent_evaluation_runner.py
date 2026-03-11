import logging
from collections.abc import Mapping
from typing import Any

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
from models.model import App

logger = logging.getLogger(__name__)


class AgentEvaluationRunner(BaseEvaluationRunner):
    """Runner for agent evaluation: executes agent-type App, collects tool calls and final output."""

    def __init__(self, evaluation_instance: BaseEvaluationInstance, session: Session):
        super().__init__(evaluation_instance, session)

    def execute_target(
        self,
        tenant_id: str,
        target_id: str,
        target_type: str,
        item: EvaluationItemInput,
    ) -> EvaluationItemResult:
        """Execute agent app and collect response with tool call information."""
        from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
        from core.app.entities.app_invoke_entities import InvokeFrom
        from core.evaluation.runners import get_service_account_for_app

        app = self.session.query(App).filter_by(id=target_id).first()
        if not app:
            raise ValueError(f"App {target_id} not found")

        service_account = get_service_account_for_app(self.session, target_id)

        query = self._extract_query(item.inputs)
        args: dict[str, Any] = {
            "inputs": item.inputs,
            "query": query,
        }

        generator = AgentChatAppGenerator()
        # Agent chat requires streaming - collect full response
        response_generator = generator.generate(
            app_model=app,
            user=service_account,
            args=args,
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=True,
        )

        # Consume the stream to get the full response
        actual_output, tool_calls = self._consume_agent_stream(response_generator)

        return EvaluationItemResult(
            index=item.index,
            actual_output=actual_output,
            metadata={"tool_calls": tool_calls},
        )

    def evaluate_metrics(
        self,
        node_run_result_mapping_list: list[dict[str, NodeRunResult]] | None,
        node_run_result_list: list[NodeRunResult] | None,
        default_metric: DefaultMetric | None,
        customized_metrics: CustomizedMetrics | None,
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Compute agent evaluation metrics."""
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

        evaluated = self.evaluation_instance.evaluate_agent(
            merged_items, default_metrics, model_provider, model_name, tenant_id
        )

        # Merge metrics back preserving metadata
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

    @staticmethod
    def _consume_agent_stream(response_generator: Any) -> tuple[str, list[dict]]:
        """Consume agent streaming response and extract final answer + tool calls."""
        answer_parts: list[str] = []
        tool_calls: list[dict] = []

        try:
            for chunk in response_generator:
                if isinstance(chunk, Mapping):
                    event = chunk.get("event")
                    if event == "agent_thought":
                        thought = chunk.get("thought", "")
                        if thought:
                            answer_parts.append(thought)
                        tool = chunk.get("tool")
                        if tool:
                            tool_calls.append({
                                "tool": tool,
                                "tool_input": chunk.get("tool_input", ""),
                            })
                    elif event == "message":
                        answer = chunk.get("answer", "")
                        if answer:
                            answer_parts.append(answer)
                elif isinstance(chunk, str):
                    answer_parts.append(chunk)
        except Exception:
            logger.exception("Error consuming agent stream")

        return "".join(answer_parts), tool_calls

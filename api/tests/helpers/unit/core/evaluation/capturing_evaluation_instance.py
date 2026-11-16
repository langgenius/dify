"""A framework adapter that records the real inputs assembled by evaluation runners."""

from collections.abc import Callable

from core.evaluation.base_evaluation_instance import BaseEvaluationInstance
from core.evaluation.entities.evaluation_entity import (
    AgentEvaluationItem,
    EvaluationCategory,
    EvaluationItemInput,
    EvaluationItemResult,
)


class CapturingEvaluationInstance(BaseEvaluationInstance):
    """Return configured results while retaining the items passed to each framework method."""

    def __init__(
        self,
        *,
        llm_result_factory: Callable[[list[EvaluationItemInput]], list[EvaluationItemResult]] | None = None,
        agent_result_factory: Callable[[list[AgentEvaluationItem]], list[EvaluationItemResult]] | None = None,
    ) -> None:
        """Accept optional result calculations and start with no recorded calls."""
        self.llm_result_factory = llm_result_factory
        self.agent_result_factory = agent_result_factory
        self.llm_items: list[EvaluationItemInput] = []
        self.retrieval_items: list[EvaluationItemInput] = []
        self.agent_items: list[AgentEvaluationItem] = []
        self.agent_calls: list[tuple[list[AgentEvaluationItem], list[str], str, str, str]] = []

    def evaluate_llm(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Record valid runner inputs and return results derived from those inputs if configured."""
        self.llm_items = items
        return self.llm_result_factory(items) if self.llm_result_factory else []

    def evaluate_retrieval(
        self,
        items: list[EvaluationItemInput],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Record valid retrieval inputs and return no metric results."""
        self.retrieval_items = items
        return []

    def evaluate_agent(
        self,
        items: list[AgentEvaluationItem],
        metric_names: list[str],
        model_provider: str,
        model_name: str,
        tenant_id: str,
    ) -> list[EvaluationItemResult]:
        """Record valid Agent inputs and return configured metric results."""
        self.agent_items = items
        self.agent_calls.append((items, metric_names, model_provider, model_name, tenant_id))
        return self.agent_result_factory(items) if self.agent_result_factory else []

    def get_supported_metrics(self, category: EvaluationCategory) -> list[str]:
        """Expose no metrics because runner tests supply their requested metric explicitly."""
        return []

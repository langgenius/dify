from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.runtime import GraphRuntimeState


class LLMUsageTrackingMixin:
    """Provides shared helpers for merging and recording LLM usage within workflow nodes."""

    graph_runtime_state: GraphRuntimeState

    @staticmethod
    def _merge_usage(current: LLMUsage, new_usage: LLMUsage | None) -> LLMUsage:
        """Return a combined usage snapshot, preserving zero-value inputs."""
        if new_usage is None or new_usage.total_tokens <= 0:
            return current
        if current.total_tokens == 0:
            return new_usage
        return current.plus(new_usage)

    def _accumulate_usage(self, usage: LLMUsage) -> None:
        """Push usage into the graph runtime accumulator for downstream reporting."""
        if usage.total_tokens <= 0:
            return

        current_usage = self.graph_runtime_state.llm_usage
        if current_usage.total_tokens == 0:
            self.graph_runtime_state.llm_usage = usage.model_copy()
        else:
            self.graph_runtime_state.llm_usage = current_usage.plus(usage)

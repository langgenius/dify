from decimal import Decimal

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.nodes.base.usage_tracking_mixin import LLMUsageTrackingMixin
from core.workflow.runtime import GraphRuntimeState, VariablePool


def _usage(total_tokens: int, total_price: str = "0.0") -> LLMUsage:
    usage = LLMUsage.empty_usage()
    usage.total_tokens = total_tokens
    usage.total_price = Decimal(total_price)
    usage.prompt_tokens = total_tokens
    usage.completion_tokens = 0
    return usage


class _DummyTracker(LLMUsageTrackingMixin):
    def __init__(self, runtime_state: GraphRuntimeState) -> None:
        self.graph_runtime_state = runtime_state


def test_merge_usage_ignores_none_or_zero_usage():
    current = _usage(10, "1.0")

    assert LLMUsageTrackingMixin._merge_usage(current, None) is current
    assert LLMUsageTrackingMixin._merge_usage(current, _usage(0)) is current


def test_merge_usage_returns_new_usage_when_current_is_empty():
    current = _usage(0)
    new_usage = _usage(5, "0.5")

    merged = LLMUsageTrackingMixin._merge_usage(current, new_usage)

    assert merged is new_usage


def test_merge_usage_adds_when_both_have_tokens():
    current = _usage(3, "0.3")
    new_usage = _usage(7, "0.7")

    merged = LLMUsageTrackingMixin._merge_usage(current, new_usage)

    assert merged.total_tokens == 10
    assert merged.total_price == Decimal("1.0")


def test_accumulate_usage_skips_zero_tokens():
    runtime_state = GraphRuntimeState(variable_pool=VariablePool.empty(), start_at=0.0)
    tracker = _DummyTracker(runtime_state)

    tracker._accumulate_usage(_usage(0))

    assert tracker.graph_runtime_state.llm_usage.total_tokens == 0


def test_accumulate_usage_sets_usage_when_state_is_empty():
    runtime_state = GraphRuntimeState(variable_pool=VariablePool.empty(), start_at=0.0)
    tracker = _DummyTracker(runtime_state)
    usage = _usage(8, "0.8")

    tracker._accumulate_usage(usage)

    stored = tracker.graph_runtime_state.llm_usage
    assert stored.total_tokens == 8
    assert stored.total_price == Decimal("0.8")
    assert stored is not usage


def test_accumulate_usage_merges_with_existing_usage():
    runtime_state = GraphRuntimeState(variable_pool=VariablePool.empty(), start_at=0.0, llm_usage=_usage(2, "0.2"))
    tracker = _DummyTracker(runtime_state)

    tracker._accumulate_usage(_usage(4, "0.4"))

    stored = tracker.graph_runtime_state.llm_usage
    assert stored.total_tokens == 6
    assert stored.total_price == Decimal("0.6")

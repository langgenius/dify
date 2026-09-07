"""Build the standard Dify Agent context-compaction capability.

``TieredCompaction`` owns the target-budget check and invokes child compactors
without evaluating their individual triggers. Each child constructor requires
at least one configured trigger (``max_messages``, ``max_tokens``, or
``max_fraction``) and validates the selected trigger. Dify uses the otherwise
unused ``max_tokens=1`` values below solely to satisfy that validation; they are
not one-token Dify policy thresholds.
"""

from pydantic_ai.settings import ModelSettings
from pydantic_ai_harness.compaction import ClearToolResults, SummarizingCompaction, TieredCompaction


def build_compaction_capability(
    *,
    context_window_tokens: int | None,
    model_settings: ModelSettings | None,
) -> TieredCompaction[None] | None:
    """Build compaction for the effective model window, or disable it when unknown."""
    if context_window_tokens is None:
        return None

    input_budget = context_window_tokens * 4 // 5
    max_tokens = model_settings.get("max_tokens") if model_settings is not None else None
    if max_tokens is not None and max_tokens > 0:
        input_budget = min(input_budget, context_window_tokens - max_tokens)
    if input_budget <= 0:
        raise ValueError("Model max_tokens must leave a positive input context budget.")

    return TieredCompaction(
        tiers=[
            ClearToolResults(max_tokens=1, keep_pairs=3, clear_tool_inputs=False),
            SummarizingCompaction(
                max_tokens=1,
                keep_messages=20,
                preserve_first_user_message=True,
                incremental=True,
            ),
        ],
        target_tokens=input_budget,
    )


__all__ = ["build_compaction_capability"]

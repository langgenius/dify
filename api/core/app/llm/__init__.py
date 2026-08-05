"""LLM-related application services."""

from .quota import (
    deduct_llm_quota,
    deduct_llm_quota_for_model,
    ensure_llm_quota_available,
    ensure_llm_quota_available_for_model,
)

__all__ = [
    "deduct_llm_quota",
    "deduct_llm_quota_for_model",
    "ensure_llm_quota_available",
    "ensure_llm_quota_available_for_model",
]

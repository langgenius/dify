"""LLM-related application services."""

from .quota import (
    deduct_llm_quota,
    deduct_llm_quota_for_model,
    deduct_model_quota,
    ensure_llm_quota_available,
    ensure_llm_quota_available_for_model,
    ensure_model_quota_available,
)

__all__ = [
    "deduct_llm_quota",
    "deduct_llm_quota_for_model",
    "deduct_model_quota",
    "ensure_llm_quota_available",
    "ensure_llm_quota_available_for_model",
    "ensure_model_quota_available",
]

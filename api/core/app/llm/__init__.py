"""LLM-related application services."""

from .quota import deduct_llm_quota, ensure_llm_quota_available

__all__ = ["deduct_llm_quota", "ensure_llm_quota_available"]

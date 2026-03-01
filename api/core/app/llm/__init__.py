"""LLM-related application services."""

from .quota import deduct_llm_quota

__all__ = ["deduct_llm_quota"]

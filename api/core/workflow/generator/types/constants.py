"""
Constants for workflow generation.

This module provides:
- Placeholder values for workflow generation
- Retry and timeout configurations
- Temperature and token limits for LLM calls
- Intent classification model settings
"""

# ============================================================
# Placeholder and Default Values
# ============================================================

PLACEHOLDER_VALUE = "__PLACEHOLDER__"
"""Placeholder value used during workflow generation."""

# ============================================================
# Retry Configuration
# ============================================================

MAX_RETRIES = 3
"""Maximum number of retries for failed operations."""

# ============================================================
# LLM Temperature Settings
# ============================================================

TEMPERATURE_MIN = 0.0
"""Minimum temperature value for LLM calls."""

TEMPERATURE_MAX = 2.0
"""Maximum temperature value for LLM calls."""

TEMPERATURE_DEFAULT = 0.7
"""Default temperature value for LLM calls."""

# ============================================================
# Intent Classification Settings
# ============================================================

INTENT_CLASSIFICATION_MODEL_PROVIDER = "openai"
"""Default model provider for intent classification."""

INTENT_CLASSIFICATION_MODEL_NAME = "gpt-4o-mini"
"""Default model name for intent classification."""

INTENT_CLASSIFICATION_TEMPERATURE = 0.0
"""Temperature for intent classification (deterministic)."""

INTENT_CLASSIFICATION_MAX_TOKENS = 100
"""Maximum tokens for intent classification output."""

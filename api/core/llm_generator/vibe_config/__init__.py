"""
Vibe Workflow Generator Configuration Module.

This module centralizes configuration for the Vibe workflow generation feature,
including node schemas, fallback rules, and response templates.
"""

from core.llm_generator.vibe_config.fallback_rules import (
    FALLBACK_RULES,
    FIELD_NAME_CORRECTIONS,
    NODE_TYPE_ALIASES,
    get_corrected_field_name,
)
from core.llm_generator.vibe_config.node_schemas import BUILTIN_NODE_SCHEMAS
from core.llm_generator.vibe_config.responses import DEFAULT_SUGGESTIONS, OFF_TOPIC_RESPONSES

__all__ = [
    "BUILTIN_NODE_SCHEMAS",
    "DEFAULT_SUGGESTIONS",
    "FALLBACK_RULES",
    "FIELD_NAME_CORRECTIONS",
    "NODE_TYPE_ALIASES",
    "OFF_TOPIC_RESPONSES",
    "get_corrected_field_name",
]


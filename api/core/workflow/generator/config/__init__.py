"""
Vibe Workflow Generator Configuration Module.

This module centralizes configuration for the Vibe workflow generation feature,
including node schemas, fallback rules, and response templates.
"""

from core.workflow.generator.config.fallback_rules import (
    FALLBACK_RULES,
    FIELD_NAME_CORRECTIONS,
    NODE_TYPE_ALIASES,
    get_corrected_field_name,
)
from core.workflow.generator.config.node_schemas import BUILTIN_NODE_SCHEMAS
from core.workflow.generator.config.responses import DEFAULT_SUGGESTIONS, OFF_TOPIC_RESPONSES

__all__ = [
    "BUILTIN_NODE_SCHEMAS",
    "DEFAULT_SUGGESTIONS",
    "FALLBACK_RULES",
    "FIELD_NAME_CORRECTIONS",
    "NODE_TYPE_ALIASES",
    "OFF_TOPIC_RESPONSES",
    "get_corrected_field_name",
]


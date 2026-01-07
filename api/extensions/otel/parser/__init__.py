"""
OpenTelemetry node parsers for workflow nodes.

This module provides parsers that extract node-specific metadata and set
OpenTelemetry span attributes according to semantic conventions.
"""

from extensions.otel.parser.base import DefaultNodeOTelParser, NodeOTelParser
from extensions.otel.parser.llm import LLMNodeOTelParser
from extensions.otel.parser.retrieval import RetrievalNodeOTelParser
from extensions.otel.parser.tool import ToolNodeOTelParser

__all__ = [
    "DefaultNodeOTelParser",
    "LLMNodeOTelParser",
    "NodeOTelParser",
    "RetrievalNodeOTelParser",
    "ToolNodeOTelParser",
]

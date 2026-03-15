from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from dify_graph.nodes.llm.runtime_protocols import PreparedLLMProtocol


class CredentialsProvider(Protocol):
    """Port for loading runtime credentials for a provider/model pair."""

    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        """Return credentials for the target provider/model or raise a domain error."""
        ...


class ModelFactory(Protocol):
    """Port for creating prepared graph-facing LLM runtimes for execution."""

    def init_model_instance(self, provider_name: str, model_name: str) -> PreparedLLMProtocol:
        """Create a prepared LLM runtime that is ready for graph execution."""
        ...


class TemplateRenderer(Protocol):
    """Port for rendering prompt templates used by LLM-compatible nodes."""

    def render_jinja2(self, *, template: str, inputs: Mapping[str, Any]) -> str:
        """Render the given Jinja2 template into plain text."""
        ...

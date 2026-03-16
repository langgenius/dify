from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from core.model_manager import ModelInstance


class CredentialsProvider(Protocol):
    """Port for loading runtime credentials for a provider/model pair."""

    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        """Return credentials for the target provider/model or raise a domain error."""
        ...


class ModelFactory(Protocol):
    """Port for creating initialized LLM model instances for execution."""

    def init_model_instance(self, provider_name: str, model_name: str) -> ModelInstance:
        """Create a model instance that is ready for schema lookup and invocation."""
        ...


class TemplateRenderer(Protocol):
    """Port for rendering prompt templates used by LLM-compatible nodes."""

    def render_jinja2(self, *, template: str, inputs: Mapping[str, Any]) -> str:
        """Render the given Jinja2 template into plain text."""
        ...

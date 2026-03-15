from __future__ import annotations

from typing import Any, Protocol

from core.model_manager import ModelInstance


class CredentialsProvider(Protocol):
    """Workflow-layer port for loading runtime credentials for a provider/model pair."""

    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        """Return credentials for the target provider/model or raise a domain error."""
        ...


class ModelFactory(Protocol):
    """Workflow-layer port for creating mutable ModelInstance objects."""

    def init_model_instance(self, provider_name: str, model_name: str) -> ModelInstance:
        """Create a model instance that is ready for workflow-side hydration."""
        ...

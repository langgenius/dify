from __future__ import annotations

from abc import abstractmethod
from typing import Any, Protocol

from graphon.nodes.llm.runtime_protocols import LLMProtocol


class CredentialsProvider(Protocol):
    """Port for loading runtime credentials for a provider/model pair."""

    @abstractmethod
    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        """Return credentials for the target provider/model or raise a domain error."""
        ...


class ModelFactory(Protocol):
    """Port for creating prepared graph-facing LLM runtimes for execution."""

    @abstractmethod
    def init_model_instance(
        self,
        provider_name: str,
        model_name: str,
    ) -> LLMProtocol:
        """Create a prepared LLM runtime that is ready for graph execution."""
        ...

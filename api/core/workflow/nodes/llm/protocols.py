from __future__ import annotations

from typing import Any, Protocol

from core.model_manager import ModelInstance


class CredentialsProvider(Protocol):
    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]: ...


class ModelFactory(Protocol):
    def init_model_instance(self, provider_name: str, model_name: str) -> ModelInstance: ...

from __future__ import annotations

from abc import abstractmethod
from collections.abc import Mapping
from typing import Any, Protocol, runtime_checkable

from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime


@runtime_checkable
class ModerationModelRuntime(ModelProviderRuntime, Protocol):
    """Runtime surface required by moderation model wrappers."""

    @abstractmethod
    def invoke_moderation(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        text: str,
        request_metadata: Mapping[str, object] | None = None,
    ) -> bool: ...

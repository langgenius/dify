from __future__ import annotations

from abc import abstractmethod
from collections.abc import Mapping
from typing import IO, Any, Protocol, runtime_checkable

from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime


@runtime_checkable
class SpeechToTextModelRuntime(ModelProviderRuntime, Protocol):
    """Runtime surface required by speech-to-text model wrappers."""

    @abstractmethod
    def invoke_speech_to_text(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        file: IO[bytes],
        request_metadata: Mapping[str, object] | None = None,
    ) -> str: ...

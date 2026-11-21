from __future__ import annotations

from abc import abstractmethod
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, TypedDict, runtime_checkable

from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime


@dataclass(frozen=True, slots=True)
class TTSChunk:
    """Audio chunk returned by TTS model runtimes."""

    data: bytes
    mime_type: str | None


class TTSModelVoice(TypedDict):
    """Voice option returned by TTS model runtimes."""

    name: str
    value: str


@runtime_checkable
class TTSModelRuntime(ModelProviderRuntime, Protocol):
    """Runtime surface required by text-to-speech model wrappers."""

    @abstractmethod
    def invoke_tts(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        content_text: str,
        voice: str,
        request_metadata: Mapping[str, object] | None = None,
    ) -> Iterable[TTSChunk]: ...

    @abstractmethod
    def get_tts_model_voices(
        self,
        *,
        provider: str,
        model: str,
        credentials: dict[str, Any],
        language: str | None,
    ) -> list[TTSModelVoice]: ...

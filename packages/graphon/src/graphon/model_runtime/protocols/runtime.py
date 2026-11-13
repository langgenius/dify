from __future__ import annotations

from typing import Protocol, runtime_checkable

from graphon.model_runtime.protocols.llm_runtime import LLMModelRuntime
from graphon.model_runtime.protocols.moderation_runtime import (
    ModerationModelRuntime,
)
from graphon.model_runtime.protocols.rerank_runtime import RerankModelRuntime
from graphon.model_runtime.protocols.speech_to_text_runtime import (
    SpeechToTextModelRuntime,
)
from graphon.model_runtime.protocols.text_embedding_runtime import (
    TextEmbeddingModelRuntime,
)
from graphon.model_runtime.protocols.tts_runtime import TTSModelRuntime


@runtime_checkable
class ModelRuntime(
    LLMModelRuntime,
    TextEmbeddingModelRuntime,
    RerankModelRuntime,
    SpeechToTextModelRuntime,
    ModerationModelRuntime,
    TTSModelRuntime,
    Protocol,
):
    """Aggregate runtime for adapters that implement every model capability."""

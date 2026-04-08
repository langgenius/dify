"""Backfill Graphon `ModelType` alias parsing for request validation.

Graphon 0.1.2 exposes `ModelType.value_of()` for origin API names like
`text-generation` and `embeddings`, but Pydantic validates enum fields through
`ModelType(value)`. That path only consults `_missing_`, so console request
parsers reject legacy aliases unless the enum itself knows how to resolve them.

This module patches `_missing_` once at import time and defers to Graphon's
implementation for unknown values. Import it early in API bootstrap so every
controller sees the same enum behaviour.
"""

from __future__ import annotations

from graphon.model_runtime.entities.model_entities import ModelType

_ORIGINAL_MODEL_TYPE_MISSING = ModelType._missing_
_MODEL_TYPE_ALIASES: dict[str, ModelType] = {
    "text-generation": ModelType.LLM,
    "embeddings": ModelType.TEXT_EMBEDDING,
    "reranking": ModelType.RERANK,
    "speech2text": ModelType.SPEECH2TEXT,
    "tts": ModelType.TTS,
}
_patch_installed = False


def _model_type_missing(cls: type[ModelType], value: object) -> ModelType | None:
    """Resolve legacy origin model type names before deferring to Graphon."""

    if isinstance(value, str):
        resolved = _MODEL_TYPE_ALIASES.get(value)
        if resolved is not None:
            return resolved

    return _ORIGINAL_MODEL_TYPE_MISSING(value)


def patch_model_type_missing() -> None:
    """Install the compatibility patch only when Graphon still needs it."""

    global _patch_installed

    try:
        ModelType("embeddings")
    except ValueError:
        if _patch_installed:
            return

        ModelType._missing_ = classmethod(_model_type_missing)  # type: ignore[method-assign,assignment]
        _patch_installed = True


patch_model_type_missing()

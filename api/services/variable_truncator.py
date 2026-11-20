"""Configured variable truncation policy for service-layer callers."""

from __future__ import annotations

from configs import dify_config
from libs.variable_truncator import (
    BaseTruncator,
    DummyVariableTruncator,
    MaxDepthExceededError,
    TruncationResult,
    UnknownTypeError,
    _PartResult,
)
from libs.variable_truncator import (
    VariableTruncator as _VariableTruncator,
)


class VariableTruncator(_VariableTruncator):
    """Variable truncator using the application's configured defaults."""

    @classmethod
    def default(cls) -> VariableTruncator:
        return cls(
            max_size_bytes=dify_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE,
            array_element_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH,
            string_length_limit=dify_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH,
        )


__all__ = [
    "BaseTruncator",
    "DummyVariableTruncator",
    "MaxDepthExceededError",
    "TruncationResult",
    "UnknownTypeError",
    "VariableTruncator",
    "_PartResult",
]

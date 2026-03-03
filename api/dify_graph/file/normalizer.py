from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from pydantic import ValidationError

from .constants import maybe_file_object
from .models import File


def rebuild_runtime_file_value(value: Any) -> Any:
    """
    Rebuild runtime ``File`` objects from JSON-like payloads.

    Workflow snapshots and tracing payloads are JSON encoded. During replay or
    event rehydration, file values can therefore appear as plain mappings with
    ``dify_model_identity`` markers instead of concrete ``File`` objects. This
    helper restores valid file payloads back to ``File`` so variable typing keeps
    using ``FileSegment``/``ArrayFileSegment`` downstream.

    Backward compatibility:
        Invalid or partial legacy file mappings are left as normal mappings to
        avoid raising during replay hydration.
    """
    if isinstance(value, File):
        return value

    if isinstance(value, Mapping):
        if maybe_file_object(value):
            try:
                return File.model_validate(dict(value))
            except (ValidationError, TypeError, ValueError):
                # Keep malformed legacy payloads as-is to preserve old behavior.
                return {key: rebuild_runtime_file_value(item) for key, item in value.items()}
        return {key: rebuild_runtime_file_value(item) for key, item in value.items()}

    if isinstance(value, list):
        return [rebuild_runtime_file_value(item) for item in value]

    return value

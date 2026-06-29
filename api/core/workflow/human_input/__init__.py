"""Dify-owned Human Input package.

Keep enums and session binding eagerly importable so persistence models can
depend on them without pulling in the heavier entity module and its file/model
dependencies. Entity exports stay available through lazy attribute loading.
"""

from __future__ import annotations

from .enums import (
    ButtonStyle,
    FormInputType,
    HumanInputFormKind,
    HumanInputFormStatus,
    TimeoutUnit,
    ValueSourceType,
)
from .session_binding import SessionBinding, session_binding

_ENTITY_EXPORTS = frozenset(
    {
        "FileInputConfig",
        "FileListInputConfig",
        "FormDefinition",
        "FormInputConfig",
        "HumanInputNodeData",
        "HumanInputSubmissionValidationError",
        "ParagraphInputConfig",
        "SelectInputConfig",
        "StringListSource",
        "StringSource",
        "UserActionConfig",
        "extract_output_field_names",
        "render_form_content_before_submission",
        "render_form_content_with_outputs",
        "restore_submitted_data",
        "restore_submitted_value",
        "validate_human_input_submission",
    }
)

__all__ = [
    "ButtonStyle",
    "FileInputConfig",
    "FileListInputConfig",
    "FormDefinition",
    "FormInputConfig",
    "FormInputType",
    "HumanInputFormKind",
    "HumanInputFormStatus",
    "HumanInputNodeData",
    "HumanInputSubmissionValidationError",
    "ParagraphInputConfig",
    "SelectInputConfig",
    "SessionBinding",
    "StringListSource",
    "StringSource",
    "TimeoutUnit",
    "UserActionConfig",
    "ValueSourceType",
    "extract_output_field_names",
    "render_form_content_before_submission",
    "render_form_content_with_outputs",
    "restore_submitted_data",
    "restore_submitted_value",
    "session_binding",
    "validate_human_input_submission",
]


def __getattr__(name: str):
    if name not in _ENTITY_EXPORTS:
        raise AttributeError(name)

    from . import entities as _entities

    return getattr(_entities, name)

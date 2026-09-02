"""Channel-neutral resolved presentation values for Human Input v2 forms."""

from __future__ import annotations

from dataclasses import dataclass

from core.human_input import ButtonStyle
from graphon.file.enums import FileTransferMethod, FileType


def _require_output_variable_name(output_variable_name: str) -> None:
    if not output_variable_name:
        raise ValueError("resolved input output variable name must not be blank")


def _require_immutable_tuple(value: object, *, field_name: str) -> None:
    if not isinstance(value, tuple):
        raise TypeError(f"{field_name} must be an immutable tuple")


@dataclass(frozen=True, slots=True)
class MarkdownText:
    """One source-ordered Markdown fragment in a resolved form."""

    text: str


@dataclass(frozen=True, slots=True)
class ParagraphInput:
    """Resolved multiline text input."""

    output_variable_name: str
    # Populated only when a default value is configured; otherwise None.
    default_value: str | None

    def __post_init__(self) -> None:
        _require_output_variable_name(self.output_variable_name)
        if self.default_value is not None and not isinstance(self.default_value, str):
            raise TypeError("paragraph input default must be a string or None")


@dataclass(frozen=True, slots=True)
class SelectInput:
    """Resolved single-choice input with immutable concrete options."""

    output_variable_name: str
    options: tuple[str, ...]
    # Populated only when a default value is configured; otherwise None.
    default_value: str | None

    def __post_init__(self) -> None:
        _require_output_variable_name(self.output_variable_name)
        _require_immutable_tuple(self.options, field_name="select input options")
        if any(not isinstance(option, str) for option in self.options):
            raise TypeError("select input options must contain strings")
        if self.default_value is not None and self.default_value not in self.options:
            raise ValueError("select input default must match one resolved option")


@dataclass(frozen=True, slots=True)
class FileInput:
    """Resolved single-file input constraints."""

    output_variable_name: str
    allowed_file_types: tuple[FileType, ...]
    allowed_file_extensions: tuple[str, ...]
    allowed_file_upload_methods: tuple[FileTransferMethod, ...]

    def __post_init__(self) -> None:
        _validate_file_constraints(
            output_variable_name=self.output_variable_name,
            allowed_file_types=self.allowed_file_types,
            allowed_file_extensions=self.allowed_file_extensions,
            allowed_file_upload_methods=self.allowed_file_upload_methods,
        )


@dataclass(frozen=True, slots=True)
class FileListInput:
    """Resolved multi-file input constraints and effective number limit."""

    output_variable_name: str
    allowed_file_types: tuple[FileType, ...]
    allowed_file_extensions: tuple[str, ...]
    allowed_file_upload_methods: tuple[FileTransferMethod, ...]
    number_limits: int

    def __post_init__(self) -> None:
        _validate_file_constraints(
            output_variable_name=self.output_variable_name,
            allowed_file_types=self.allowed_file_types,
            allowed_file_extensions=self.allowed_file_extensions,
            allowed_file_upload_methods=self.allowed_file_upload_methods,
        )
        if self.number_limits <= 0:
            raise ValueError("file-list input number limits must be positive")


def _validate_file_constraints(
    *,
    output_variable_name: str,
    allowed_file_types: tuple[FileType, ...],
    allowed_file_extensions: tuple[str, ...],
    allowed_file_upload_methods: tuple[FileTransferMethod, ...],
) -> None:
    _require_output_variable_name(output_variable_name)
    _require_immutable_tuple(allowed_file_types, field_name="allowed file types")
    _require_immutable_tuple(allowed_file_extensions, field_name="allowed file extensions")
    _require_immutable_tuple(allowed_file_upload_methods, field_name="allowed file upload methods")
    if any(not isinstance(file_type, FileType) for file_type in allowed_file_types):
        raise TypeError("allowed file types must contain FileType values")
    if any(not isinstance(extension, str) for extension in allowed_file_extensions):
        raise TypeError("allowed file extensions must contain strings")
    if any(not isinstance(method, FileTransferMethod) for method in allowed_file_upload_methods):
        raise TypeError("allowed file upload methods must contain FileTransferMethod values")


@dataclass(frozen=True, slots=True)
class ResolvedFormAction:
    """Resolved action values required for presentation and submission validation."""

    id: str
    title: str
    button_style: ButtonStyle

    def __post_init__(self) -> None:
        if not self.id or not self.title:
            raise ValueError("resolved form action values must not be blank")
        if not isinstance(self.button_style, ButtonStyle):
            raise TypeError("resolved form action button style must be a ButtonStyle value")


type Input = ParagraphInput | SelectInput | FileInput | FileListInput
type ResolvedFormContent = MarkdownText | Input


@dataclass(frozen=True, slots=True)
class ResolvedForm:
    """Immutable authoritative presentation snapshot for one v2 form."""

    title: str | None
    blocks: tuple[ResolvedFormContent, ...]
    user_actions: tuple[ResolvedFormAction, ...]
    # All non-output variables are resolved; {{#$output.<name>#}} slots remain.
    legacy_form_content: str

    def __post_init__(self) -> None:
        _require_immutable_tuple(self.blocks, field_name="resolved form blocks")
        _require_immutable_tuple(self.user_actions, field_name="resolved form user actions")
        action_ids = [action.id for action in self.user_actions]
        if len(action_ids) != len(set(action_ids)):
            raise ValueError("resolved form action identifiers must be unique")


__all__ = [
    "FileInput",
    "FileListInput",
    "Input",
    "MarkdownText",
    "ParagraphInput",
    "ResolvedForm",
    "ResolvedFormAction",
    "ResolvedFormContent",
    "SelectInput",
]

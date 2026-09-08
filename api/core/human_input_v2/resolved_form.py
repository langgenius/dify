"""Channel-neutral resolved presentation values for Human Input v2 forms."""

from __future__ import annotations

import abc
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from core.human_input import ButtonStyle
from graphon.file.enums import FileTransferMethod, FileType


class FormPartType(StrEnum):
    MARKDOWN_FRAGMENT = "markdown_fragment"
    PARAGRAPH_INPUT = "paragraph_input"
    SELECT_INPUT = "select_input"
    FILE_INPUT = "file_input"
    FILE_LIST_INPUT = "file_list_input"


class MarkdownFragment(BaseModel):
    """One source-ordered Markdown fragment in a resolved form."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    type: Literal[FormPartType.MARKDOWN_FRAGMENT] = FormPartType.MARKDOWN_FRAGMENT
    text: str


class _BasicInput(BaseModel, abc.ABC):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    output_variable_name: str


class ParagraphInput(_BasicInput):
    """Resolved multiline text input."""

    type: Literal[FormPartType.PARAGRAPH_INPUT] = FormPartType.PARAGRAPH_INPUT
    # Populated only when a default value is configured; otherwise None.
    default_value: str | None


class SelectInput(_BasicInput):
    """Resolved single-choice input with immutable concrete options."""

    type: Literal[FormPartType.SELECT_INPUT] = FormPartType.SELECT_INPUT
    options: tuple[str, ...]
    # Populated only when a default value is configured; otherwise None.
    default_value: str | None


class FileInput(_BasicInput):
    """Resolved single-file input constraints."""

    type: Literal[FormPartType.FILE_INPUT] = FormPartType.FILE_INPUT
    allowed_file_types: tuple[FileType, ...]
    allowed_file_extensions: tuple[str, ...]
    allowed_file_upload_methods: tuple[FileTransferMethod, ...]


class FileListInput(_BasicInput):
    """Resolved multi-file input constraints and effective number limit."""

    type: Literal[FormPartType.FILE_LIST_INPUT] = FormPartType.FILE_LIST_INPUT
    allowed_file_types: tuple[FileType, ...]
    allowed_file_extensions: tuple[str, ...]
    allowed_file_upload_methods: tuple[FileTransferMethod, ...]
    number_limits: int


class UserAction(BaseModel):
    """Resolved action values required for presentation and submission validation."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    id: str
    title: str
    button_style: ButtonStyle


type FormPart = Annotated[
    MarkdownFragment | ParagraphInput | SelectInput | FileInput | FileListInput,
    Field(discriminator="type"),
]


class ResolvedForm(BaseModel):
    """Immutable authoritative presentation snapshot for one v2 form."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True, validate_default=True)

    # An empty string represents a form without a title.
    title: str
    parts: tuple[FormPart, ...]
    actions: tuple[UserAction, ...]
    # All non-output variables are resolved; {{#$output.<name>#}} slots remain.
    legacy_form_content: str

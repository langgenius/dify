"""Transport projections independent of Human Input v2's stored snapshot."""

from typing import Annotated, Literal, assert_never

from pydantic import Field

from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import (
    DateInput,
    DateTimeInput,
    FileInput,
    FileListInput,
    FormPart,
    MarkdownFragment,
    ParagraphInput,
    SelectInput,
)
from core.human_input_v2.resolved_form import (
    ResolvedForm as FormSnapshot,
)
from core.workflow.nodes.human_input.enums import ValueSourceType
from fields.base import ResponseModel
from graphon.file.enums import FileTransferMethod, FileType


class HumanInputStringSourceResponse(ResponseModel):
    type: ValueSourceType
    selector: list[str] = Field(
        deprecated=True,
        description="Deprecated. Retained for compatibility; use the server-resolved default value instead.",
    )
    value: str


class HumanInputStringListSourceResponse(ResponseModel):
    type: ValueSourceType
    selector: list[str] = Field(
        deprecated=True,
        description="Deprecated. Retained for compatibility; use the resolved options in value instead.",
    )
    value: list[str]


class HumanInputParagraphResponse(ResponseModel):
    output_variable_name: str
    type: Literal["paragraph"]
    default: HumanInputStringSourceResponse | None


class HumanInputSelectResponse(ResponseModel):
    output_variable_name: str
    type: Literal["select"]
    option_source: HumanInputStringListSourceResponse


class _FileConstraintsResponse(ResponseModel):
    output_variable_name: str
    allowed_file_types: list[FileType]
    allowed_file_extensions: list[str]
    allowed_file_upload_methods: list[FileTransferMethod]


class HumanInputFileResponse(_FileConstraintsResponse):
    type: Literal["file"]


class HumanInputFileListResponse(_FileConstraintsResponse):
    type: Literal["file-list"]
    number_limits: int


class HumanInputDateResponse(ResponseModel):
    output_variable_name: str
    type: Literal["date"]
    default: HumanInputStringSourceResponse | None


class HumanInputDateTimeResponse(ResponseModel):
    output_variable_name: str
    type: Literal["datetime"]
    default: HumanInputStringSourceResponse | None


type HumanInputResponse = Annotated[
    HumanInputParagraphResponse
    | HumanInputSelectResponse
    | HumanInputFileResponse
    | HumanInputFileListResponse
    | HumanInputDateResponse
    | HumanInputDateTimeResponse,
    Field(discriminator="type"),
]


class HumanInputActionResponse(ResponseModel):
    id: str
    title: str
    button_style: ButtonStyle


class ResolvedMarkdownResponse(ResponseModel):
    type: Literal["markdown_fragment"]
    text: str


class ResolvedParagraphResponse(ResponseModel):
    type: Literal["paragraph_input"]
    output_variable_name: str
    default_value: str | None


class ResolvedSelectResponse(ResponseModel):
    type: Literal["select_input"]
    output_variable_name: str
    options: list[str]
    default_value: str | None


class ResolvedFileResponse(_FileConstraintsResponse):
    type: Literal["file_input"]


class ResolvedFileListResponse(_FileConstraintsResponse):
    type: Literal["file_list_input"]
    number_limits: int


class ResolvedDateResponse(ResponseModel):
    type: Literal["date_input"]
    output_variable_name: str
    default_value: str | None


class ResolvedDateTimeResponse(ResponseModel):
    type: Literal["datetime_input"]
    output_variable_name: str
    default_value: str | None


type ResolvedPartResponse = Annotated[
    ResolvedMarkdownResponse
    | ResolvedParagraphResponse
    | ResolvedSelectResponse
    | ResolvedFileResponse
    | ResolvedFileListResponse
    | ResolvedDateResponse
    | ResolvedDateTimeResponse,
    Field(discriminator="type"),
]


class ResolvedForm(ResponseModel):
    """Keep the existing resolved-form wire shape without exposing storage metadata."""

    title: str
    parts: list[ResolvedPartResponse]
    actions: list[HumanInputActionResponse]
    legacy_form_content: str


def build_resolved_form_response(form: FormSnapshot) -> ResolvedForm:
    """Copy a trusted snapshot into the public shape without changing its state."""
    return ResolvedForm(
        title=form.title,
        parts=[_resolved_part_response(part) for part in form.parts],
        actions=[
            HumanInputActionResponse(id=action.id, title=action.title, button_style=action.button_style)
            for action in form.actions
        ],
        legacy_form_content=form.legacy_form_content,
    )


def _resolved_part_response(part: FormPart) -> ResolvedPartResponse:
    """Map one frozen block while retaining its public field names and values."""
    match part:
        case MarkdownFragment():
            return ResolvedMarkdownResponse(type="markdown_fragment", text=part.text)
        case ParagraphInput():
            return ResolvedParagraphResponse(
                type="paragraph_input",
                output_variable_name=part.output_variable_name,
                default_value=part.resolved_default_value,
            )
        case SelectInput():
            return ResolvedSelectResponse(
                type="select_input",
                output_variable_name=part.output_variable_name,
                options=list(part.options),
                default_value=part.resolved_default_value,
            )
        case FileInput():
            return ResolvedFileResponse(
                type="file_input",
                output_variable_name=part.output_variable_name,
                allowed_file_types=list(part.allowed_file_types),
                allowed_file_extensions=list(part.allowed_file_extensions),
                allowed_file_upload_methods=list(part.allowed_file_upload_methods),
            )
        case FileListInput():
            return ResolvedFileListResponse(
                type="file_list_input",
                output_variable_name=part.output_variable_name,
                allowed_file_types=list(part.allowed_file_types),
                allowed_file_extensions=list(part.allowed_file_extensions),
                allowed_file_upload_methods=list(part.allowed_file_upload_methods),
                number_limits=part.number_limits,
            )
        case DateInput():
            return ResolvedDateResponse(
                type="date_input",
                output_variable_name=part.output_variable_name,
                default_value=part.resolved_default_value,
            )
        case DateTimeInput():
            return ResolvedDateTimeResponse(
                type="datetime_input",
                output_variable_name=part.output_variable_name,
                default_value=part.resolved_default_value,
            )
        case _:
            assert_never(part)

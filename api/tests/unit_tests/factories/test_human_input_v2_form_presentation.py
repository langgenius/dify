"""Behavior tests for rendering accepted Human Input v2 form values."""

import pytest

from core.human_input_v2.resolved_form import (
    FileInput,
    FileListInput,
    FormPart,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
)
from factories.human_input_v2_form_presentation import render_filled_content
from graphon.file import File, FileTransferMethod, FileType
from graphon.variables.segments import ArrayFileSegment, FileSegment, NoneSegment, Segment, StringSegment


@pytest.fixture
def form() -> ResolvedForm:
    return ResolvedForm(title="", parts=(), actions=(), legacy_form_content="Unused legacy template")


@pytest.fixture
def attachment() -> File:
    return File(
        file_id="file-1",
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/review.pdf",
        filename="review.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=100,
    )


def test_render_follows_source_order_without_reinterpreting_submitted_markers(form: ResolvedForm) -> None:
    note = ParagraphInput(output_variable_name="note", default_value=None)
    form = form.model_copy(
        update={
            "parts": (
                MarkdownFragment(text="Literal {{#$output.choice#}}: "),
                note,
                MarkdownFragment(text=" / "),
                SelectInput(output_variable_name="choice", options=("Yes", "No"), default_value=None),
                MarkdownFragment(text=" / "),
                note,
                ParagraphInput(output_variable_name="empty", default_value="unused"),
            )
        }
    )

    content = render_filled_content(
        form,
        {
            "choice": StringSegment(value="Yes"),
            "empty": StringSegment(value=""),
            "note": StringSegment(value="{{#$output.choice#}}"),
        },
    )

    assert content == "Literal {{#$output.choice#}}: {{#$output.choice#}} / Yes / {{#$output.choice#}}"


@pytest.mark.parametrize(
    "part",
    [
        ParagraphInput(output_variable_name="answer", default_value="unused"),
        SelectInput(output_variable_name="answer", options=("Yes", "No"), default_value="Yes"),
        FileInput(
            output_variable_name="answer",
            allowed_file_types=(),
            allowed_file_extensions=(),
            allowed_file_upload_methods=(),
        ),
        FileListInput(
            output_variable_name="answer",
            allowed_file_types=(),
            allowed_file_extensions=(),
            allowed_file_upload_methods=(),
            number_limits=3,
        ),
    ],
    ids=["paragraph", "select", "file", "file-list"],
)
@pytest.mark.parametrize("inputs", [{}, {"answer": NoneSegment()}], ids=["missing", "null"])
def test_render_omits_missing_and_null_values(form: ResolvedForm, part: FormPart, inputs: dict[str, Segment]) -> None:
    form = form.model_copy(update={"parts": (MarkdownFragment(text="before"), part, MarkdownFragment(text="after"))})

    assert render_filled_content(form, inputs) == "beforeafter"


@pytest.mark.parametrize(("count", "expected"), [(0, "[0 files]"), (1, "[1 files]"), (2, "[2 files]")])
def test_render_uses_file_placeholders_and_list_counts(
    form: ResolvedForm, attachment: File, count: int, expected: str
) -> None:
    form = form.model_copy(
        update={
            "parts": (
                FileInput(
                    output_variable_name="attachment",
                    allowed_file_types=(),
                    allowed_file_extensions=(),
                    allowed_file_upload_methods=(),
                ),
                MarkdownFragment(text=" / "),
                FileListInput(
                    output_variable_name="files",
                    allowed_file_types=(),
                    allowed_file_extensions=(),
                    allowed_file_upload_methods=(),
                    number_limits=3,
                ),
            )
        }
    )

    content = render_filled_content(
        form, {"attachment": FileSegment(value=attachment), "files": ArrayFileSegment(value=[attachment] * count)}
    )

    assert content == f"[file] / {expected}"

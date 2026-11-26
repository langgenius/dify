"""Behavior tests for presenting and rendering Human Input v2 form values."""

from urllib.parse import parse_qsl, urlencode, urlsplit

import pytest

from core.human_input_v2.resolved_form import (
    DateInput,
    DateTimeInput,
    FileInput,
    FileListInput,
    FormPart,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
)
from core.tools.signature import sign_tool_file
from core.workflow.nodes.human_input.entities import (
    DateInputConfig,
    DateTimeInputConfig,
    ParagraphInputConfig,
)
from core.workflow.nodes.human_input.enums import ValueSourceType
from factories.human_input_v2_form_presentation import (
    build_form_presentation,
    refresh_form_file_urls,
    render_filled_content,
)
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


@pytest.mark.parametrize(
    "markup", ["[Report]({url})", "![Report]({url})", "<{url}>", "{url}", '[Report]: {url} "Title"']
)
def test_file_refresh_keeps_markdown_and_both_snapshot_representations_consistent(
    form: ResolvedForm, markup: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000000)
    url = sign_tool_file("b4c3d2e1-0000-4000-8000-123456789abc", ".pdf")
    external = "https://example.com/report.pdf?download=true"
    before = f"Review {markup.format(url=url)} / {markup.format(url=url)} / [External]({external}) "
    after = "\nFrozen text."
    note = ParagraphInput(output_variable_name="note", resolved_default_value=url)
    snapshot = form.model_copy(
        update={
            "parts": (MarkdownFragment(text=before), note, MarkdownFragment(text=after)),
            "legacy_form_content": before + "{{#$output.note#}}" + after,
        }
    )
    monkeypatch.setattr("core.tools.signature.time.time", lambda: 1700000400)
    monkeypatch.setattr("core.tools.signature.os.urandom", lambda _: b"\x01" * 16)
    new_url = sign_tool_file("b4c3d2e1-0000-4000-8000-123456789abc", ".pdf")
    parsed = urlsplit(new_url)
    new_url = parsed._replace(query=urlencode(parse_qsl(parsed.query))).geturl()

    refreshed = refresh_form_file_urls(snapshot)

    first, refreshed_note, last = refreshed.parts
    assert isinstance(first, MarkdownFragment)
    assert isinstance(last, MarkdownFragment)
    assert refreshed_note == note
    assert last.text == after
    assert refreshed.title == snapshot.title
    assert refreshed.actions == snapshot.actions
    assert refreshed.legacy_form_content == first.text + "{{#$output.note#}}" + after
    assert first.text == before.replace(url, new_url)
    assert snapshot.legacy_form_content == before + "{{#$output.note#}}" + after


@pytest.mark.parametrize(
    ("default_value", "expected_value", "expected_resolved_defaults"),
    [(None, "", {}), ("", "", {"answer": ""}), ("Preset answer", "Preset answer", {"answer": "Preset answer"})],
)
def test_paragraph_presentation_supplies_a_concrete_default_for_shared_form_controls(
    form: ResolvedForm,
    default_value: str | None,
    expected_value: str,
    expected_resolved_defaults: dict[str, str],
) -> None:
    form = form.model_copy(
        update={"parts": (ParagraphInput(output_variable_name="answer", resolved_default_value=default_value),)}
    )

    presentation = build_form_presentation(form)

    (paragraph,) = presentation.inputs
    assert isinstance(paragraph, ParagraphInputConfig)
    assert paragraph.default is not None
    assert paragraph.default.type == ValueSourceType.CONSTANT
    assert paragraph.default.value == expected_value
    assert presentation.resolved_default_values == expected_resolved_defaults


def test_render_follows_source_order_without_reinterpreting_submitted_markers(form: ResolvedForm) -> None:
    note = ParagraphInput(output_variable_name="note", resolved_default_value=None)
    form = form.model_copy(
        update={
            "parts": (
                MarkdownFragment(text="Literal {{#$output.choice#}}: "),
                note,
                MarkdownFragment(text=" / "),
                SelectInput(output_variable_name="choice", options=("Yes", "No"), resolved_default_value=None),
                MarkdownFragment(text=" / "),
                note,
                ParagraphInput(output_variable_name="empty", resolved_default_value="unused"),
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
        ParagraphInput(output_variable_name="answer", resolved_default_value="unused"),
        SelectInput(output_variable_name="answer", options=("Yes", "No"), resolved_default_value="Yes"),
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


def test_date_and_datetime_presentation_preserve_concrete_defaults(form: ResolvedForm) -> None:
    form = form.model_copy(
        update={
            "parts": (
                DateInput(output_variable_name="due_date", resolved_default_value="2026-11-25"),
                DateTimeInput(output_variable_name="meeting_at", resolved_default_value="2026-11-25T14:30:00Z"),
                DateInput(output_variable_name="empty_date", resolved_default_value=None),
            )
        }
    )

    presentation = build_form_presentation(form)

    assert len(presentation.inputs) == 3
    date_input, datetime_input, empty_date_input = presentation.inputs
    assert isinstance(date_input, DateInputConfig)
    assert date_input.default is not None
    assert date_input.default.type == ValueSourceType.CONSTANT
    assert date_input.default.value == "2026-11-25"
    assert isinstance(datetime_input, DateTimeInputConfig)
    assert datetime_input.default is not None
    assert datetime_input.default.type == ValueSourceType.CONSTANT
    assert datetime_input.default.value == "2026-11-25T14:30:00Z"
    assert isinstance(empty_date_input, DateInputConfig)
    assert empty_date_input.default is None
    assert presentation.resolved_default_values == {
        "due_date": "2026-11-25",
        "meeting_at": "2026-11-25T14:30:00Z",
    }


def test_render_includes_submitted_date_and_datetime_and_omits_missing(form: ResolvedForm) -> None:
    form = form.model_copy(
        update={
            "parts": (
                MarkdownFragment(text="Due: "),
                DateInput(output_variable_name="due_date", resolved_default_value="2026-11-25"),
                MarkdownFragment(text=" At: "),
                DateTimeInput(output_variable_name="meeting_at", resolved_default_value=None),
                MarkdownFragment(text=" Missing: "),
                DateInput(output_variable_name="missing_date", resolved_default_value=None),
            )
        }
    )

    content = render_filled_content(
        form,
        {
            "due_date": StringSegment(value="2026-12-01"),
            "meeting_at": StringSegment(value="2026-12-01T09:15:00Z"),
            "missing_date": NoneSegment(),
        },
    )

    assert content == "Due: 2026-12-01 At: 2026-12-01T09:15:00Z Missing: "

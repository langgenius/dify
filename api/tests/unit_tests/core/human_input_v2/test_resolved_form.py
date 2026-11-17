"""Behavior tests for channel-neutral resolved Human Input v2 forms."""

import json

import pytest
from pydantic import BaseModel, ValidationError

from core.human_input import ButtonStyle
from core.human_input_v2.resolved_form import (
    FileInput,
    FileListInput,
    MarkdownFragment,
    ParagraphInput,
    ResolvedForm,
    SelectInput,
    UserAction,
)
from graphon.file.enums import FileTransferMethod, FileType


@pytest.fixture
def form() -> ResolvedForm:
    return ResolvedForm(
        title="Review",
        parts=(
            MarkdownFragment(text="Please review\n"),
            ParagraphInput(output_variable_name="reason", default_value="Ship it"),
            SelectInput(output_variable_name="decision", options=("approve", "reject"), default_value=None),
            FileInput(
                output_variable_name="attachment",
                allowed_file_types=(FileType.DOCUMENT, FileType.CUSTOM),
                allowed_file_extensions=("pdf", "md"),
                allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL),
            ),
            FileListInput(
                output_variable_name="evidence",
                allowed_file_types=(FileType.IMAGE,),
                allowed_file_extensions=(),
                allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE,),
                number_limits=3,
            ),
        ),
        actions=(UserAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),),
        legacy_form_content="Please review {{#$output.reason#}}",
    )


def test_resolved_form_json_round_trip_preserves_all_parts_and_enums(form: ResolvedForm) -> None:
    serialized = form.model_dump_json()

    assert json.loads(serialized) == {
        "title": "Review",
        "parts": [
            {"type": "markdown_fragment", "text": "Please review\n"},
            {"type": "paragraph_input", "output_variable_name": "reason", "default_value": "Ship it"},
            {
                "type": "select_input",
                "output_variable_name": "decision",
                "options": ["approve", "reject"],
                "default_value": None,
            },
            {
                "type": "file_input",
                "output_variable_name": "attachment",
                "allowed_file_types": ["document", "custom"],
                "allowed_file_extensions": ["pdf", "md"],
                "allowed_file_upload_methods": ["local_file", "remote_url"],
            },
            {
                "type": "file_list_input",
                "output_variable_name": "evidence",
                "allowed_file_types": ["image"],
                "allowed_file_extensions": [],
                "allowed_file_upload_methods": ["local_file"],
                "number_limits": 3,
            },
        ],
        "actions": [{"id": "approve", "title": "Approve", "button_style": "primary"}],
        "legacy_form_content": "Please review {{#$output.reason#}}",
    }
    restored = ResolvedForm.model_validate_json(serialized)
    assert restored == form
    assert restored.actions[0].button_style is ButtonStyle.PRIMARY
    attachment = restored.parts[3]
    assert isinstance(attachment, FileInput)
    assert attachment.allowed_file_types[0] is FileType.DOCUMENT
    assert attachment.allowed_file_upload_methods[0] is FileTransferMethod.LOCAL_FILE
    assert ResolvedForm.model_validate(form.model_dump()) == form


def test_resolved_form_and_nested_values_are_frozen(form: ResolvedForm) -> None:
    with pytest.raises(ValidationError, match="frozen_instance"):
        form.title = "Changed"  # pyrefly: ignore[read-only]
    paragraph = form.parts[1]
    assert isinstance(paragraph, ParagraphInput)
    with pytest.raises(ValidationError, match="frozen_instance"):
        paragraph.default_value = "Changed"  # pyrefly: ignore[read-only]
    with pytest.raises(ValidationError, match="frozen_instance"):
        form.actions[0].title = "Changed"  # pyrefly: ignore[read-only]


@pytest.mark.parametrize(
    ("model", "values", "error_type"),
    [
        (MarkdownFragment, {"text": 1}, "string_type"),
        (ParagraphInput, {"output_variable_name": "reason", "default_value": 1}, "string_type"),
        (SelectInput, {"output_variable_name": "choice", "options": ["yes"], "default_value": None}, "tuple_type"),
        (SelectInput, {"output_variable_name": "choice", "options": (1,), "default_value": None}, "string_type"),
        (UserAction, {"id": "approve", "title": "Approve", "button_style": "primary"}, "is_instance_of"),
        (ResolvedForm, {"title": None, "parts": (), "actions": (), "legacy_form_content": ""}, "string_type"),
        (ResolvedForm, {"title": "", "parts": [], "actions": (), "legacy_form_content": ""}, "tuple_type"),
        (ResolvedForm, {"title": "", "parts": (), "actions": [], "legacy_form_content": ""}, "tuple_type"),
    ],
)
def test_internal_construction_rejects_incorrect_types(
    model: type[BaseModel], values: dict[str, object], error_type: str
) -> None:
    with pytest.raises(ValidationError, match=error_type):
        model.model_validate(values)


@pytest.mark.parametrize("field", ["allowed_file_types", "allowed_file_extensions", "allowed_file_upload_methods"])
def test_file_constraints_reject_mutable_sequences(field: str, form: ResolvedForm) -> None:
    values = form.parts[3].model_dump()
    values[field] = []

    with pytest.raises(ValidationError, match="tuple_type"):
        FileInput.model_validate(values)


@pytest.mark.parametrize("number_limits", [True, "3", 1.5])
def test_file_list_number_limit_requires_an_integer(number_limits: object, form: ResolvedForm) -> None:
    values = form.parts[4].model_dump()
    values["number_limits"] = number_limits

    with pytest.raises(ValidationError, match="int_type"):
        FileListInput.model_validate(values)


def test_all_models_reject_extra_fields(form: ResolvedForm) -> None:
    for model in (form, *form.parts, *form.actions):
        values = model.model_dump()
        values["unexpected"] = True
        with pytest.raises(ValidationError, match="extra_forbidden"):
            type(model).model_validate(values)


@pytest.mark.parametrize(
    ("part", "error_type"),
    [
        ({"type": "unknown", "text": "content"}, "union_tag_invalid"),
        ({"text": "content"}, "union_tag_not_found"),
        ({"type": "paragraph_input", "text": "content"}, "missing"),
    ],
)
def test_json_deserialization_requires_matching_part_discriminator(part: dict[str, str], error_type: str) -> None:
    serialized = json.dumps({"title": "", "parts": [part], "actions": [], "legacy_form_content": ""})

    with pytest.raises(ValidationError, match=error_type):
        ResolvedForm.model_validate_json(serialized)


def test_type_correct_values_are_preserved_without_business_validation() -> None:
    action = UserAction(id="", title="", button_style=ButtonStyle.DEFAULT)
    form = ResolvedForm(
        title="",
        parts=(
            ParagraphInput(output_variable_name="", default_value="  Untrimmed  "),
            SelectInput(output_variable_name=" Choice ", options=("", "", " Yes "), default_value="unlisted"),
            FileListInput(
                output_variable_name="",
                allowed_file_types=(),
                allowed_file_extensions=(" .PDF ",),
                allowed_file_upload_methods=(),
                number_limits=0,
            ),
        ),
        actions=(action, action),
        legacy_form_content=" {{#$output.reason#}} ",
    )

    assert ResolvedForm.model_validate_json(form.model_dump_json()) == form
    paragraph = form.parts[0]
    assert isinstance(paragraph, ParagraphInput)
    assert paragraph.default_value == "  Untrimmed  "
    select = form.parts[1]
    assert isinstance(select, SelectInput)
    assert select.output_variable_name == " Choice "
    assert form.legacy_form_content == " {{#$output.reason#}} "

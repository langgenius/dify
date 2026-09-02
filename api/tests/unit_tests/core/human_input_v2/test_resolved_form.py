"""Behavior tests for channel-neutral resolved Human Input v2 forms."""

from dataclasses import FrozenInstanceError, fields
from typing import get_type_hints

import pytest

from core import human_input_v2
from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    SelectInput,
)
from core.workflow.nodes.human_input.enums import ButtonStyle
from graphon.file.enums import FileTransferMethod, FileType


def _file_input() -> FileInput:
    return FileInput(
        output_variable_name="attachment",
        allowed_file_types=(FileType.DOCUMENT, FileType.CUSTOM),
        allowed_file_extensions=("pdf", "md"),
        allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL),
    )


def test_resolved_form_values_are_frozen_and_own_immutable_tuples() -> None:
    paragraph = ParagraphInput(output_variable_name="reason", default_value="Ship it")
    select = SelectInput(output_variable_name="decision", options=("approve", "reject"), default_value="approve")
    file_input = _file_input()
    file_list = FileListInput(
        output_variable_name="evidence",
        allowed_file_types=(FileType.IMAGE,),
        allowed_file_extensions=(),
        allowed_file_upload_methods=(FileTransferMethod.LOCAL_FILE,),
        number_limits=3,
    )
    action = ResolvedFormAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY)
    form = ResolvedForm(
        title="Review",
        blocks=(MarkdownText("Please review\n"), paragraph, select, file_input, file_list),
        user_actions=(action,),
        legacy_form_content="Please review {{#$output.reason#}}",
    )

    assert form.blocks[3].allowed_file_types == (FileType.DOCUMENT, FileType.CUSTOM)
    assert form.blocks[3].allowed_file_upload_methods == (
        FileTransferMethod.LOCAL_FILE,
        FileTransferMethod.REMOTE_URL,
    )
    with pytest.raises(FrozenInstanceError):
        form.title = "Changed"
    with pytest.raises(FrozenInstanceError):
        paragraph.default_value = "Changed"


@pytest.mark.parametrize(
    "constructor",
    [
        lambda: SelectInput("decision", ["approve"], None),
        lambda: FileInput("file", [FileType.DOCUMENT], (), (FileTransferMethod.LOCAL_FILE,)),
        lambda: FileInput("file", (FileType.DOCUMENT,), ["pdf"], (FileTransferMethod.LOCAL_FILE,)),
        lambda: FileInput("file", (FileType.DOCUMENT,), (), [FileTransferMethod.LOCAL_FILE]),
        lambda: FileListInput("files", (FileType.DOCUMENT,), (), [FileTransferMethod.LOCAL_FILE], 1),
        lambda: ResolvedForm(None, [MarkdownText("content")], (), "content"),
        lambda: ResolvedForm(None, (), [ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY)], "content"),
    ],
)
def test_resolved_form_values_reject_mutable_sequence_ownership(constructor) -> None:
    with pytest.raises(TypeError, match="immutable tuple"):
        constructor()


@pytest.mark.parametrize(
    ("action_id", "title"),
    [("", "Approve"), ("approve", "")],
)
def test_resolved_form_action_rejects_each_blank_component(action_id: str, title: str) -> None:
    with pytest.raises(ValueError, match="must not be blank"):
        ResolvedFormAction(action_id, title, ButtonStyle.PRIMARY)


def test_resolved_defaults_and_identifiers_are_validated_at_construction() -> None:
    with pytest.raises(ValueError, match="default"):
        SelectInput("decision", ("approve", "reject"), "escalate")
    with pytest.raises(ValueError, match="output variable name"):
        ParagraphInput("", None)
    with pytest.raises(ValueError, match="number limits"):
        FileListInput("files", (), (), (), 0)
    with pytest.raises(TypeError, match="ButtonStyle"):
        ResolvedFormAction("approve", "Approve", "primary")


def test_resolved_form_rejects_duplicate_action_identifiers() -> None:
    action = ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY)

    with pytest.raises(ValueError, match="unique"):
        ResolvedForm(None, (), (action, action), "content")


def test_input_blocks_expose_only_resolved_presentation_fields() -> None:
    paragraph_fields = {field.name for field in fields(ParagraphInput)}
    select_fields = {field.name for field in fields(SelectInput)}
    file_fields = {field.name for field in fields(FileInput)}
    resolved_form_fields = {field.name for field in fields(ResolvedForm)}

    assert paragraph_fields == {"output_variable_name", "default_value"}
    assert select_fields == {"output_variable_name", "options", "default_value"}
    assert file_fields == {
        "output_variable_name",
        "allowed_file_types",
        "allowed_file_extensions",
        "allowed_file_upload_methods",
    }
    assert resolved_form_fields == {"title", "blocks", "user_actions", "legacy_form_content"}
    assert get_type_hints(ResolvedFormAction)["button_style"] is ButtonStyle
    assert not hasattr(human_input_v2, "InputBlock")


def test_resolved_form_exports_use_channel_neutral_names() -> None:
    assert hasattr(human_input_v2, "ResolvedFormAction")
    assert hasattr(human_input_v2, "ResolvedFormContent")
    assert not hasattr(human_input_v2, "CardAction")
    assert not hasattr(human_input_v2, "CardContent")

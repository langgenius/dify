"""Behavior tests for compiling Human Input v2 authoring data into a resolved form."""

import pytest
from pydantic import ValidationError

from constants import DEFAULT_FILE_NUMBER_LIMITS
from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedFormAction,
    SelectInput,
)
from core.workflow.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    FormInputConfig,
    ParagraphInputConfig,
    SelectInputConfig,
    StringListSource,
    StringSource,
    UserActionConfig,
)
from core.workflow.nodes.human_input.enums import ButtonStyle, ValueSourceType
from core.workflow.nodes.human_input_v2.entities import DebugModeConfig, HumanInputNodeData, MessageTemplateConfig
from core.workflow.nodes.human_input_v2.form_compiler import MissingResolvedInputError, compile_resolved_form
from graphon.file.enums import FileTransferMethod, FileType
from graphon.runtime import VariablePool
from graphon.variables import ArrayStringSegment, StringSegment


def _node_data(
    *,
    form_content: str,
    inputs: list[FormInputConfig],
    user_actions: list[UserActionConfig] | None = None,
) -> HumanInputNodeData:
    return HumanInputNodeData(
        title="Review",
        recipients_spec=[],
        message_template=MessageTemplateConfig(subject="Review", body="Review the request"),
        debug_mode=DebugModeConfig(channels=[]),
        form_content=form_content,
        inputs=inputs,
        user_actions=user_actions
        or [UserActionConfig(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY)],
    )


def test_compiler_preserves_markdown_and_input_source_order() -> None:
    node_data = _node_data(
        form_content="Before {{#$output.reason#}} between {{#$output.decision#}} after",
        inputs=[
            ParagraphInputConfig(output_variable_name="reason"),
            SelectInputConfig(
                output_variable_name="decision",
                option_source=StringListSource(type=ValueSourceType.CONSTANT, value=["approve", "reject"]),
            ),
        ],
    )

    resolved = compile_resolved_form(node_data, VariablePool.empty())

    assert resolved.blocks == (
        MarkdownText("Before "),
        ParagraphInput("reason", None),
        MarkdownText(" between "),
        SelectInput("decision", ("approve", "reject"), None),
        MarkdownText(" after"),
    )
    assert resolved.title == "Review"
    assert resolved.user_actions == (ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),)
    assert resolved.user_actions[0].button_style is ButtonStyle.PRIMARY


def test_compiler_keeps_adjacent_inputs_adjacent_and_preserves_whitespace_fragments() -> None:
    node_data = _node_data(
        form_content="{{#$output.first#}}{{#$output.second#}} \n {{#$output.third#}}",
        inputs=[
            ParagraphInputConfig(output_variable_name="first"),
            ParagraphInputConfig(output_variable_name="second"),
            ParagraphInputConfig(output_variable_name="third"),
        ],
    )

    resolved = compile_resolved_form(node_data, VariablePool.empty())

    assert resolved.blocks == (
        ParagraphInput("first", None),
        ParagraphInput("second", None),
        MarkdownText(" \n "),
        ParagraphInput("third", None),
    )


def test_compiler_rejects_missing_referenced_input_and_omits_unreferenced_input() -> None:
    node_data = _node_data(
        form_content="{{#$output.referenced#}} {{#$output.missing#}}",
        inputs=[
            ParagraphInputConfig(output_variable_name="referenced"),
            ParagraphInputConfig(output_variable_name="unused"),
        ],
    )

    with pytest.raises(MissingResolvedInputError, match="missing"):
        compile_resolved_form(node_data, VariablePool.empty())

    resolved = compile_resolved_form(
        _node_data(
            form_content="{{#$output.referenced#}}",
            inputs=[
                ParagraphInputConfig(output_variable_name="referenced"),
                ParagraphInputConfig(output_variable_name="unused"),
            ],
        ),
        VariablePool.empty(),
    )
    assert resolved.blocks == (ParagraphInput("referenced", None),)


def test_compiler_resolves_legacy_content_paragraph_defaults_and_select_values() -> None:
    variable_pool = VariablePool.empty()
    variable_pool.add(("start", "request"), StringSegment(value="expense report"))
    variable_pool.add(("start", "paragraph_default"), StringSegment(value="Looks good"))
    variable_pool.add(("start", "options"), ArrayStringSegment(value=["approve", "reject"]))
    node_data = _node_data(
        form_content=(
            "Review {{#start.request#}} / {{#start.request#}}: "
            "{{#$output.constant_reason#}} {{#$output.variable_reason#}} {{#$output.decision#}}"
        ),
        inputs=[
            ParagraphInputConfig(
                output_variable_name="constant_reason",
                default=StringSource(type=ValueSourceType.CONSTANT, value="No concerns"),
            ),
            ParagraphInputConfig(
                output_variable_name="variable_reason",
                default=StringSource(type=ValueSourceType.VARIABLE, selector=("start", "paragraph_default")),
            ),
            SelectInputConfig(
                output_variable_name="decision",
                option_source=StringListSource(type=ValueSourceType.VARIABLE, selector=("start", "options")),
            ),
        ],
    )

    resolved = compile_resolved_form(
        node_data,
        variable_pool,
        resolved_default_values={"decision": "approve"},
    )

    assert resolved.legacy_form_content == (
        "Review expense report / expense report: "
        "{{#$output.constant_reason#}} {{#$output.variable_reason#}} {{#$output.decision#}}"
    )
    assert tuple(block for block in resolved.blocks if not isinstance(block, MarkdownText)) == (
        ParagraphInput("constant_reason", "No concerns"),
        ParagraphInput("variable_reason", "Looks good"),
        SelectInput("decision", ("approve", "reject"), "approve"),
    )


def test_compiler_freezes_file_constraints_and_effective_file_list_number_limits() -> None:
    common_constraints = {
        "allowed_file_types": [FileType.DOCUMENT, FileType.CUSTOM],
        "allowed_file_extensions": ["pdf", "md"],
        "allowed_file_upload_methods": [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL],
    }
    node_data = _node_data(
        form_content="{{#$output.attachment#}}{{#$output.evidence#}}",
        inputs=[
            FileInputConfig(output_variable_name="attachment", **common_constraints),
            FileListInputConfig(output_variable_name="evidence", number_limits=0, **common_constraints),
        ],
    )

    resolved = compile_resolved_form(node_data, VariablePool.empty())

    assert resolved.blocks == (
        FileInput(
            "attachment",
            (FileType.DOCUMENT, FileType.CUSTOM),
            ("pdf", "md"),
            (FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL),
        ),
        FileListInput(
            "evidence",
            (FileType.DOCUMENT, FileType.CUSTOM),
            ("pdf", "md"),
            (FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL),
            DEFAULT_FILE_NUMBER_LIMITS,
        ),
    )


def test_node_data_owns_duplicate_output_slot_validation() -> None:
    with pytest.raises(ValidationError, match="duplicated output slot 'reason'"):
        _node_data(
            form_content="{{#$output.reason#}} then {{#$output.reason#}}",
            inputs=[ParagraphInputConfig(output_variable_name="reason")],
        )


def test_node_data_reuses_input_and_action_identifier_validation() -> None:
    with pytest.raises(ValidationError, match="duplicated output_variable_name 'reason'"):
        _node_data(
            form_content="{{#$output.reason#}}",
            inputs=[
                ParagraphInputConfig(output_variable_name="reason"),
                ParagraphInputConfig(output_variable_name="reason"),
            ],
        )
    with pytest.raises(ValidationError, match="duplicated user action id 'approve'"):
        _node_data(
            form_content="",
            inputs=[],
            user_actions=[
                UserActionConfig(id="approve", title="Approve"),
                UserActionConfig(id="approve", title="Approve again"),
            ],
        )

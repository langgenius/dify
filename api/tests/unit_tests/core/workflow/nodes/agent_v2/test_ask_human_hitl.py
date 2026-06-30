"""Unit tests for the ask_human -> HITL form translation layer (ENG-636)."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from dify_agent.layers.ask_human import AskHumanToolArgs
from dify_agent.protocol import DeferredToolCallPayload

from core.repositories.human_input_repository import FormCreateParams, HumanInputFormRepository
from core.workflow.human_input_adapter import (
    EmailDeliveryMethod,
    ExternalRecipient,
    InteractiveSurfaceDeliveryMethod,
)
from core.workflow.nodes.agent_v2.ask_human_hitl import (
    AskHumanFormBuildError,
    ask_human_args_to_node_data,
    build_ask_human_pause_reason,
    build_delivery_methods,
    parse_ask_human_args,
)
from core.workflow.nodes.human_input.entities import (
    FileInputConfig,
    FileListInputConfig,
    ParagraphInputConfig,
    SelectInputConfig,
)
from core.workflow.nodes.human_input.enums import ButtonStyle, TimeoutUnit
from models.agent_config_entities import AgentHumanContactConfig


def _args(**overrides: Any) -> AskHumanToolArgs:
    payload: dict[str, Any] = {"question": "Approve the budget?"}
    payload.update(overrides)
    return AskHumanToolArgs.model_validate(payload)


def _deferred_call(args: dict[str, Any], *, tool_name: str = "ask_human") -> DeferredToolCallPayload:
    return DeferredToolCallPayload(tool_call_id="call-1", tool_name=tool_name, args=args)


def _fake_repository(form_id: str = "form-123") -> MagicMock:
    repo = MagicMock(spec=HumanInputFormRepository)
    repo.create_form.return_value = MagicMock(id=form_id)
    return repo


# ─────────────────────────── parse_ask_human_args ───────────────────────────


def test_parse_ask_human_args_from_mapping() -> None:
    parsed = parse_ask_human_args({"question": "Need a decision"})
    assert isinstance(parsed, AskHumanToolArgs)
    assert parsed.question == "Need a decision"


def test_parse_ask_human_args_passthrough() -> None:
    original = _args()
    assert parse_ask_human_args(original) is original


def test_parse_ask_human_args_invalid_payload_raises() -> None:
    with pytest.raises(AskHumanFormBuildError):
        parse_ask_human_args({"question": ""})  # blank question is rejected


def test_parse_ask_human_args_non_mapping_raises() -> None:
    with pytest.raises(AskHumanFormBuildError):
        parse_ask_human_args("not a mapping")


# ───────────────────────── ask_human_args_to_node_data ──────────────────────


def test_node_data_maps_every_field_type() -> None:
    args = _args(
        fields=[
            {"type": "paragraph", "name": "reason", "label": "Reason", "default": "n/a"},
            {
                "type": "select",
                "name": "tier",
                "label": "Tier",
                "options": [{"value": "t1", "label": "Tier 1"}, {"value": "t2", "label": "Tier 2"}],
                "default": "t2",
            },
            {"type": "file", "name": "doc", "label": "Document"},
            {"type": "file-list", "name": "evidence", "label": "Evidence", "max_files": 3},
        ],
    )

    node_data = ask_human_args_to_node_data(args, node_title="Budget review")

    assert [type(i) for i in node_data.inputs] == [
        ParagraphInputConfig,
        SelectInputConfig,
        FileInputConfig,
        FileListInputConfig,
    ]
    paragraph, select, _file, file_list = node_data.inputs
    assert isinstance(paragraph, ParagraphInputConfig)
    assert isinstance(select, SelectInputConfig)
    assert isinstance(file_list, FileListInputConfig)
    assert paragraph.output_variable_name == "reason"
    assert paragraph.default is not None
    assert paragraph.default.value == "n/a"
    assert select.option_source.value == ["t1", "t2"]
    assert file_list.number_limits == 3
    assert node_data.timeout == 36
    assert node_data.timeout_unit == TimeoutUnit.HOUR
    assert node_data.title == "Budget review"


def test_node_data_form_content_embeds_title_question_and_field_markers() -> None:
    args = _args(
        title="Decision needed",
        markdown="Some **context** here.",
        fields=[{"type": "paragraph", "name": "reason", "label": "Reason", "required": True}],
    )

    content = ask_human_args_to_node_data(args, node_title="t").form_content

    assert "## Decision needed" in content
    assert "Approve the budget?" in content
    assert "Some **context** here." in content
    # The label carries a required marker and positions the input via $output.
    assert "**Reason ***" in content
    assert "{{#$output.reason#}}" in content


def test_node_data_maps_action_styles_and_titles() -> None:
    args = _args(
        actions=[
            {"id": "approve", "label": "Approve", "style": "primary"},
            {"id": "reject", "label": "Reject", "style": "destructive"},
            {"id": "later", "label": "Decide later"},
        ],
    )

    actions = ask_human_args_to_node_data(args, node_title="t").user_actions

    assert [(a.id, a.title, a.button_style) for a in actions] == [
        ("approve", "Approve", ButtonStyle.PRIMARY),
        ("reject", "Reject", ButtonStyle.ACCENT),  # destructive -> accent
        ("later", "Decide later", ButtonStyle.DEFAULT),
    ]


def test_node_data_synthesizes_submit_action_when_none_given() -> None:
    actions = ask_human_args_to_node_data(_args(), node_title="t").user_actions
    assert len(actions) == 1
    assert actions[0].id == "submit"
    assert actions[0].button_style == ButtonStyle.PRIMARY


def test_node_data_clamps_overlong_action_id_deterministically() -> None:
    long_id = "approve_the_quarterly_budget_request"  # > 20 chars, valid identifier
    args = _args(actions=[{"id": long_id, "label": "Approve"}])

    first = ask_human_args_to_node_data(args, node_title="t").user_actions[0]
    second = ask_human_args_to_node_data(args, node_title="t").user_actions[0]

    assert len(first.id) <= 20
    assert first.id.isidentifier()
    assert first.id == second.id  # stable across builds
    assert first.title == "Approve"  # label preserved verbatim


# ───────────────────────────── build_delivery_methods ──────────────────────


def test_delivery_always_includes_interactive_surface() -> None:
    methods = build_delivery_methods([], args=_args())
    assert len(methods) == 1
    assert isinstance(methods[0], InteractiveSurfaceDeliveryMethod)


def test_delivery_adds_email_for_contacts_and_dedupes() -> None:
    contacts = [
        AgentHumanContactConfig(email="a@x.com"),
        AgentHumanContactConfig(email="a@x.com"),  # duplicate
        AgentHumanContactConfig(email=None),  # no email
        AgentHumanContactConfig(email="b@x.com"),
    ]

    methods = build_delivery_methods(contacts, args=_args())

    email_methods = [m for m in methods if isinstance(m, EmailDeliveryMethod)]
    assert len(email_methods) == 1
    recipients = email_methods[0].config.recipients.items
    assert [r.email for r in recipients if isinstance(r, ExternalRecipient)] == ["a@x.com", "b@x.com"]


def test_delivery_high_urgency_prefixes_subject() -> None:
    methods = build_delivery_methods(
        [AgentHumanContactConfig(email="a@x.com")],
        args=_args(title="Sign off", urgency="high"),
    )
    email_method = next(m for m in methods if isinstance(m, EmailDeliveryMethod))
    assert email_method.config.subject.startswith("[Action needed] ")


# ─────────────────────────── build_ask_human_pause_reason ───────────────────


def test_pause_reason_none_for_non_ask_human_tool() -> None:
    result = build_ask_human_pause_reason(
        deferred_tool_call=_deferred_call({"question": "q"}, tool_name="final_output"),
        node_id="node-1",
        default_node_title="Agent",
        workflow_run_id="wf-1",
        contacts=[],
        repository=_fake_repository(),
    )
    assert result is None


def test_pause_reason_requires_workflow_run_id() -> None:
    with pytest.raises(AskHumanFormBuildError):
        build_ask_human_pause_reason(
            deferred_tool_call=_deferred_call({"question": "q"}),
            node_id="node-1",
            default_node_title="Agent",
            workflow_run_id="",
            contacts=[],
            repository=_fake_repository(),
        )


def test_pause_reason_builds_form_and_returns_human_input_required() -> None:
    repo = _fake_repository(form_id="form-xyz")
    contacts = [AgentHumanContactConfig(email="a@x.com")]

    result = build_ask_human_pause_reason(
        deferred_tool_call=_deferred_call(
            {
                "title": "Approve?",
                "question": "Please approve",
                "fields": [{"type": "paragraph", "name": "note", "label": "Note"}],
                "actions": [{"id": "ok", "label": "OK"}],
            }
        ),
        node_id="node-1",
        default_node_title="Agent fallback",
        workflow_run_id="wf-1",
        contacts=contacts,
        repository=repo,
    )

    assert result is not None
    assert result.form_id == "form-xyz"
    assert result.node_id == "node-1"
    assert result.node_title == "Approve?"  # args.title wins over default
    assert [i.output_variable_name for i in result.inputs] == ["note"]
    assert [a.id for a in result.actions] == ["ok"]

    params: FormCreateParams = repo.create_form.call_args.args[0]
    assert params.workflow_execution_id == "wf-1"
    assert params.node_id == "node-1"
    # No conversation_id passed -> pure workflow run owns the form by workflow_run_id only.
    assert params.conversation_id is None
    assert any(isinstance(m, EmailDeliveryMethod) for m in params.delivery_methods)


def test_pause_reason_forwards_conversation_id_for_chatflow() -> None:
    # ENG-635 (review): an agent node running in a chatflow tags its ask_human form
    # with the conversation in addition to the workflow run.
    repo = _fake_repository(form_id="form-xyz")

    build_ask_human_pause_reason(
        deferred_tool_call=_deferred_call({"question": "Please approve"}),
        node_id="node-1",
        default_node_title="Agent",
        workflow_run_id="wf-1",
        conversation_id="conv-1",
        contacts=[],
        repository=repo,
    )

    params: FormCreateParams = repo.create_form.call_args.args[0]
    assert params.workflow_execution_id == "wf-1"
    assert params.conversation_id == "conv-1"


def test_pause_reason_falls_back_to_default_node_title() -> None:
    result = build_ask_human_pause_reason(
        deferred_tool_call=_deferred_call({"question": "q with no title"}),
        node_id="node-1",
        default_node_title="Agent fallback",
        workflow_run_id="wf-1",
        contacts=[],
        repository=_fake_repository(),
    )
    assert result is not None
    assert result.node_title == "Agent fallback"


def test_pause_reason_select_default_flows_into_resolved_defaults() -> None:
    repo = _fake_repository()
    result = build_ask_human_pause_reason(
        deferred_tool_call=_deferred_call(
            {
                "question": "pick",
                "fields": [
                    {
                        "type": "select",
                        "name": "tier",
                        "label": "Tier",
                        "options": [{"value": "t1", "label": "Tier 1"}],
                        "default": "t1",
                    }
                ],
            }
        ),
        node_id="node-1",
        default_node_title="Agent",
        workflow_run_id="wf-1",
        contacts=[],
        repository=repo,
    )
    assert result is not None
    assert result.resolved_default_values == {"tier": "t1"}


def test_pause_reason_wraps_repository_value_error() -> None:
    repo = MagicMock(spec=HumanInputFormRepository)
    repo.create_form.side_effect = ValueError("db boom")
    with pytest.raises(AskHumanFormBuildError):
        build_ask_human_pause_reason(
            deferred_tool_call=_deferred_call({"question": "q"}),
            node_id="node-1",
            default_node_title="Agent",
            workflow_run_id="wf-1",
            contacts=[],
            repository=repo,
        )

import asyncio
import inspect
from collections.abc import Awaitable
from typing import Any, cast

import pytest
from pydantic_ai.messages import ToolCallPart
from pydantic_ai.tools import DeferredToolRequests, ToolDefinition

from dify_agent.layers.ask_human import DifyAskHumanLayerConfig
from dify_agent.layers.ask_human.schema import AskHumanToolArgs
from dify_agent.layers.ask_human.layer import DifyAskHumanLayer


async def _await_tool_definition(value: Awaitable[ToolDefinition | None]) -> ToolDefinition | None:
    return await value


def test_ask_human_layer_exposes_one_external_tool_and_prompt_hint() -> None:
    config = DifyAskHumanLayerConfig(
        tool_name="human_gate",
        tool_description="Collect a human decision.",
        max_fields=2,
        max_actions=3,
        allowed_field_types=["paragraph"],
        allow_file_fields=False,
        max_question_chars=240,
        max_markdown_chars=512,
        max_field_label_chars=32,
        max_action_label_chars=16,
    )
    layer = DifyAskHumanLayer.from_config(config)

    prompt_hint = layer.build_prompt_hint()
    tool = layer.tools[0]
    prepare = tool.prepare
    assert prepare is not None
    prepared_or_awaitable = prepare(
        cast(Any, None),
        ToolDefinition(
            name=tool.name, description=tool.description, parameters_json_schema=tool.function_schema.json_schema
        ),
    )
    prepared = (
        asyncio.run(_await_tool_definition(cast(Awaitable[ToolDefinition | None], prepared_or_awaitable)))
        if inspect.isawaitable(prepared_or_awaitable)
        else prepared_or_awaitable
    )

    assert len(layer.prefix_prompts) == 1
    assert len(layer.tools) == 1
    assert "Allowed field types: paragraph." in prompt_hint
    assert "File upload fields are disabled." in prompt_hint
    assert "Use at most 2 field(s)." in prompt_hint
    assert "Use at most 3 action(s)." in prompt_hint
    assert "Keep 'question' under 240 characters." in prompt_hint
    assert "Keep 'markdown' under 512 characters." in prompt_hint
    assert "Keep each field label under 32 characters." in prompt_hint
    assert "Keep each action label under 16 characters." in prompt_hint
    assert prepared is not None
    assert prepared.name == "human_gate"
    assert prepared.description == "Collect a human decision."
    assert prepared.kind == "external"
    assert prepared.parameters_json_schema == AskHumanToolArgs.model_json_schema()


def test_ask_human_layer_normalizes_default_action_in_deferred_payload() -> None:
    layer = DifyAskHumanLayer.from_config(DifyAskHumanLayerConfig())

    payload = layer.build_deferred_tool_call_payload(
        DeferredToolRequests(
            calls=[
                ToolCallPart(
                    tool_name="ask_human",
                    args={
                        "question": "Need a human answer",
                        "fields": [{"type": "paragraph", "name": "comment", "label": "Comment"}],
                    },
                    tool_call_id="call-1",
                )
            ]
        )
    )

    assert payload.tool_call_id == "call-1"
    assert payload.tool_name == "ask_human"
    assert payload.args == {
        "title": None,
        "question": "Need a human answer",
        "markdown": None,
        "fields": [
            {
                "type": "paragraph",
                "name": "comment",
                "label": "Comment",
                "required": False,
                "placeholder": None,
                "default": None,
            }
        ],
        "actions": [{"id": "submit", "label": "Submit", "style": "primary"}],
        "urgency": "normal",
    }
    assert payload.metadata == {
        "layer_type": "dify.ask_human",
        "tool_name": "ask_human",
        "schema_version": 1,
    }


def test_ask_human_layer_rejects_disallowed_field_types_in_deferred_payload() -> None:
    layer = DifyAskHumanLayer.from_config(DifyAskHumanLayerConfig(allowed_field_types=["paragraph"]))

    with pytest.raises(ValueError, match="field type 'select' is not allowed"):
        _ = layer.build_deferred_tool_call_payload(
            DeferredToolRequests(
                calls=[
                    ToolCallPart(
                        tool_name="ask_human",
                        args={
                            "question": "Need a choice",
                            "fields": [
                                {
                                    "type": "select",
                                    "name": "decision",
                                    "label": "Decision",
                                    "options": [{"value": "yes", "label": "Yes"}],
                                }
                            ],
                        },
                        tool_call_id="call-2",
                    )
                ]
            )
        )


def test_ask_human_layer_rejects_tool_name_mismatch_in_deferred_payload() -> None:
    layer = DifyAskHumanLayer.from_config(DifyAskHumanLayerConfig(tool_name="human_gate"))

    with pytest.raises(ValueError, match="deferred tool name must be 'human_gate', got 'ask_human'"):
        _ = layer.build_deferred_tool_call_payload(
            DeferredToolRequests(
                calls=[
                    ToolCallPart(
                        tool_name="ask_human",
                        args={"question": "Need a human answer"},
                        tool_call_id="call-3",
                    )
                ]
            )
        )

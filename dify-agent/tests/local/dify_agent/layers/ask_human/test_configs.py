import pytest
from pydantic import ValidationError

import dify_agent.layers.ask_human as ask_human_exports
from dify_agent.layers.ask_human import DIFY_ASK_HUMAN_LAYER_TYPE_ID, DifyAskHumanLayerConfig
from dify_agent.layers.ask_human.schema import AskHumanToolArgs


def test_ask_human_package_exports_client_safe_symbols_only() -> None:
    assert ask_human_exports.DIFY_ASK_HUMAN_LAYER_TYPE_ID == "dify.ask_human"
    assert ask_human_exports.__all__ == [
        "AskHumanAction",
        "AskHumanActionStyle",
        "AskHumanField",
        "AskHumanFieldType",
        "AskHumanFileField",
        "AskHumanFileListField",
        "AskHumanParagraphField",
        "AskHumanResultStatus",
        "AskHumanSelectField",
        "AskHumanSelectOption",
        "AskHumanSelectedAction",
        "AskHumanToolArgs",
        "AskHumanToolResult",
        "AskHumanUrgency",
        "DEFAULT_ASK_HUMAN_TOOL_DESCRIPTION",
        "DIFY_ASK_HUMAN_LAYER_TYPE_ID",
        "DifyAskHumanLayerConfig",
    ]
    assert not hasattr(ask_human_exports, "DifyAskHumanLayer")


def test_ask_human_layer_config_defaults_and_effective_description() -> None:
    config = DifyAskHumanLayerConfig()

    assert DIFY_ASK_HUMAN_LAYER_TYPE_ID == "dify.ask_human"
    assert config.model_dump(mode="json") == {
        "enabled": True,
        "tool_name": "ask_human",
        "tool_description": None,
        "max_fields": 8,
        "max_actions": 4,
        "allowed_field_types": ["paragraph", "select"],
        "allow_file_fields": False,
        "max_markdown_chars": 8000,
        "max_question_chars": 1000,
        "max_field_label_chars": 120,
        "max_action_label_chars": 80,
    }
    assert "Ask a human for missing information" in config.effective_tool_description


def test_ask_human_layer_config_rejects_invalid_tool_name() -> None:
    with pytest.raises(ValidationError, match="tool_name must be a valid tool identifier"):
        _ = DifyAskHumanLayerConfig(tool_name="ask-human")


def test_ask_human_layer_config_rejects_file_field_types_when_disabled() -> None:
    with pytest.raises(ValidationError, match="cannot include file field types"):
        _ = DifyAskHumanLayerConfig(allowed_field_types=["paragraph", "file"])


def test_ask_human_tool_args_reject_duplicate_field_names() -> None:
    with pytest.raises(ValidationError, match="field name 'comment' must be unique"):
        _ = AskHumanToolArgs.model_validate(
            {
                "question": "Need a reply",
                "fields": [
                    {"type": "paragraph", "name": "comment", "label": "Comment"},
                    {"type": "paragraph", "name": "comment", "label": "Another comment"},
                ],
            }
        )

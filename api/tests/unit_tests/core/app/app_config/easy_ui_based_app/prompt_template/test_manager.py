from collections.abc import Mapping
from typing import cast

import pytest

from core.app.app_config.easy_ui_based_app.prompt_template.manager import (
    PromptTemplateConfigManager,
)
from core.app.app_config.entities import PromptTemplateEntity
from graphon.model_runtime.entities.message_entities import PromptMessageRole
from models.model import AppMode, AppModelConfigDict


def _app_model_config(config: Mapping[str, object]) -> AppModelConfigDict:
    """App model configs are JSON loaded from the database; these tests build partial ones."""
    return cast(AppModelConfigDict, config)


class TestPromptTemplateConfigManagerConvert:
    def test_convert_missing_prompt_type_raises(self) -> None:
        with pytest.raises(ValueError, match="prompt_type is required"):
            PromptTemplateConfigManager.convert(_app_model_config({}))

    def test_convert_simple_prompt(self) -> None:
        config = {"prompt_type": "simple", "pre_prompt": "hello"}

        result = PromptTemplateConfigManager.convert(_app_model_config(config))

        assert result == PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE, simple_prompt_template="hello"
        )

    def test_convert_advanced_chat_valid(self) -> None:
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [{"text": "hi", "role": "user"}]},
        }

        result = PromptTemplateConfigManager.convert(_app_model_config(config))

        assert result.prompt_type == PromptTemplateEntity.PromptType.ADVANCED
        assert result.advanced_chat_prompt_template is not None
        assert len(result.advanced_chat_prompt_template.messages) == 1
        message = result.advanced_chat_prompt_template.messages[0]
        assert message.text == "hi"
        assert message.role == PromptMessageRole.USER

    @pytest.mark.parametrize(
        "message",
        [
            {"text": 123, "role": "user"},
            {"text": "hi", "role": 123},
        ],
    )
    def test_convert_advanced_invalid_message_fields(self, message: dict[str, object]) -> None:
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [message]},
        }

        with pytest.raises(ValueError, match="(?:message role must be a string|message text must be a string)"):
            PromptTemplateConfigManager.convert(_app_model_config(config))

    def test_convert_advanced_completion_with_roles(self) -> None:
        config = {
            "prompt_type": "advanced",
            "completion_prompt_config": {
                "prompt": {"text": "complete"},
                "conversation_histories_role": {
                    "user_prefix": "U",
                    "assistant_prefix": "A",
                },
            },
        }

        result = PromptTemplateConfigManager.convert(_app_model_config(config))

        assert result.prompt_type == PromptTemplateEntity.PromptType.ADVANCED
        assert result.advanced_completion_prompt_template is not None
        assert result.advanced_completion_prompt_template.prompt == "complete"
        assert result.advanced_completion_prompt_template.role_prefix is not None
        assert result.advanced_completion_prompt_template.role_prefix.user == "U"
        assert result.advanced_completion_prompt_template.role_prefix.assistant == "A"


# -----------------------------
# validate_and_set_defaults
# -----------------------------


class TestValidateAndSetDefaults:
    def setup_method(self) -> None:
        self.valid_model = {"mode": "chat"}

    def test_default_prompt_type_set(self) -> None:
        config = {"model": self.valid_model}

        result, keys = PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

        assert result["prompt_type"] == "simple"
        assert isinstance(keys, list)

    def test_invalid_prompt_type_raises(self) -> None:
        config = {"prompt_type": "invalid", "model": self.valid_model}

        with pytest.raises(
            ValueError,
            match=("prompt_type must be in \\[<PromptType\\.SIMPLE: 'simple'>, <PromptType\\.ADVANCED: 'advanced'>\\]"),
        ):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_invalid_chat_prompt_config_type(self) -> None:
        config = {
            "prompt_type": "simple",
            "chat_prompt_config": "invalid",
            "model": self.valid_model,
        }

        with pytest.raises(ValueError, match="chat_prompt_config must be of object type"):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_simple_mode_invalid_pre_prompt_type(self) -> None:
        config = {
            "prompt_type": "simple",
            "pre_prompt": 123,
            "model": self.valid_model,
        }

        with pytest.raises(ValueError, match="pre_prompt must be of string type"):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_advanced_requires_one_config(self) -> None:
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": dict[str, object](),
            "completion_prompt_config": dict[str, object](),
            "model": {"mode": "chat"},
        }

        with pytest.raises(
            ValueError,
            match=("chat_prompt_config or completion_prompt_config is required when prompt_type is advanced"),
        ):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_advanced_invalid_model_mode(self) -> None:
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": list[object]()},
            "model": {"mode": "invalid"},
        }

        with pytest.raises(
            ValueError, match="model\\.mode must be in \\['completion', 'chat'\\] when prompt_type is advanced"
        ):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_advanced_chat_prompt_length_exceeds(self) -> None:
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [dict[str, object]()] * 11},
            "model": {"mode": "chat"},
        }

        with pytest.raises(ValueError, match="prompt messages must be less than 10"):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_completion_prefix_defaults_set_when_empty(self) -> None:
        config = {
            "prompt_type": "advanced",
            "completion_prompt_config": {
                "prompt": {"text": "hi"},
                "conversation_histories_role": {
                    "user_prefix": "",
                    "assistant_prefix": "",
                },
            },
            "model": {"mode": "completion"},
        }

        updated, _ = PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

        roles = updated["completion_prompt_config"]["conversation_histories_role"]
        assert roles["user_prefix"] == "Human"
        assert roles["assistant_prefix"] == "Assistant"


# -----------------------------
# validate_post_prompt
# -----------------------------


class TestValidatePostPrompt:
    @pytest.mark.parametrize("value", [None, ""])
    def test_post_prompt_defaults(self, value: str | None) -> None:
        config = {"post_prompt": value}
        result = PromptTemplateConfigManager.validate_post_prompt_and_set_defaults(config)
        assert result["post_prompt"] == ""

    def test_post_prompt_invalid_type(self) -> None:
        config = {"post_prompt": 123}
        with pytest.raises(ValueError, match="post_prompt must be of string type"):
            PromptTemplateConfigManager.validate_post_prompt_and_set_defaults(config)

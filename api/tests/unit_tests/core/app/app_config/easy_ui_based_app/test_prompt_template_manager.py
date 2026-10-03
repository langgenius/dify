import pytest

from core.app.app_config.easy_ui_based_app.prompt_template.manager import (
    PromptTemplateConfigManager,
)
from core.app.app_config.entities import PromptTemplateEntity
from graphon.model_runtime.entities.message_entities import PromptMessageRole
from models.model import AppMode


class TestPromptTemplateConfigManagerConvert:
    def test_convert_missing_prompt_type_raises(self):
        with pytest.raises(ValueError, match="prompt_type is required"):
            PromptTemplateConfigManager.convert({})

    def test_convert_simple_prompt(self):
        config = {"prompt_type": "simple", "pre_prompt": "hello"}

        result = PromptTemplateConfigManager.convert(config)

        assert result == PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE, simple_prompt_template="hello"
        )

    def test_convert_advanced_chat_valid(self):
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [{"text": "hi", "role": "user"}]},
        }

        result = PromptTemplateConfigManager.convert(config)

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
    def test_convert_advanced_invalid_message_fields(self, message):
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [message]},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.convert(config)

    def test_convert_advanced_completion_with_roles(self):
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

        result = PromptTemplateConfigManager.convert(config)

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
    def setup_method(self):
        self.valid_model = {"mode": "chat"}

    def test_default_prompt_type_set(self):
        config = {"model": self.valid_model}

        result, keys = PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

        assert result["prompt_type"] == "simple"
        assert isinstance(keys, list)

    def test_invalid_prompt_type_raises(self):
        config = {"prompt_type": "invalid", "model": self.valid_model}

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_invalid_chat_prompt_config_type(self):
        config = {
            "prompt_type": "simple",
            "chat_prompt_config": "invalid",
            "model": self.valid_model,
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_simple_mode_invalid_pre_prompt_type(self):
        config = {
            "prompt_type": "simple",
            "pre_prompt": 123,
            "model": self.valid_model,
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_advanced_requires_one_config(self):
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {},
            "completion_prompt_config": {},
            "model": {"mode": "chat"},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_advanced_invalid_model_mode(self):
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": []},
            "model": {"mode": "invalid"},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_advanced_chat_prompt_length_exceeds(self):
        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [{}] * 11},
            "model": {"mode": "chat"},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults(AppMode.CHAT, config)

    def test_completion_prefix_defaults_set_when_empty(self):
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
    def test_post_prompt_defaults(self, value):
        config = {"post_prompt": value}
        result = PromptTemplateConfigManager.validate_post_prompt_and_set_defaults(config)
        assert result["post_prompt"] == ""

    def test_post_prompt_invalid_type(self):
        config = {"post_prompt": 123}
        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_post_prompt_and_set_defaults(config)

from collections import UserString
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

from core.app.app_config.easy_ui_based_app.prompt_template.manager import (
    PromptTemplateConfigManager,
)

# -----------------------------
# Helpers
# -----------------------------


class DummyEnumValue(UserString):
    def __init__(self, value):
        super().__init__(value)
        self.value = value


class DummyPromptType:
    def __init__(self):
        self.SIMPLE = DummyEnumValue("simple")
        self.ADVANCED = DummyEnumValue("advanced")

    def value_of(self, value):
        for enum_value in self:
            if enum_value.value == value:
                return enum_value
        raise ValueError(f"invalid prompt type value {value}")

    def __iter__(self):
        return iter([self.SIMPLE, self.ADVANCED])


# -----------------------------
# Convert Tests
# -----------------------------


class TestPromptTemplateConfigManagerConvert:
    def test_convert_missing_prompt_type_raises(self):
        with pytest.raises(ValueError, match="prompt_type is required"):
            PromptTemplateConfigManager.convert({})

    def test_convert_simple_prompt(self, mocker: MockerFixture):
        mock_prompt_entity_cls = MagicMock()
        mock_prompt_entity_cls.PromptType = DummyPromptType()

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.PromptTemplateEntity",
            mock_prompt_entity_cls,
        )

        mock_prompt_entity_cls.return_value = "simple_entity"

        config = {"prompt_type": "simple", "pre_prompt": "hello"}

        result = PromptTemplateConfigManager.convert(config)

        assert result == "simple_entity"
        mock_prompt_entity_cls.assert_called_once_with(prompt_type="simple", simple_prompt_template="hello")

    def test_convert_advanced_chat_valid(self, mocker: MockerFixture):
        mock_prompt_entity_cls = MagicMock()
        mock_prompt_entity_cls.PromptType = DummyPromptType()
        mock_prompt_entity_cls.return_value = "advanced_entity"

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.PromptTemplateEntity",
            mock_prompt_entity_cls,
        )

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.PromptMessageRole.value_of",
            return_value="role_enum",
        )

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.AdvancedChatMessageEntity",
            return_value="chat_msg",
        )

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.AdvancedChatPromptTemplateEntity",
            return_value="chat_template",
        )

        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [{"text": "hi", "role": "user"}]},
        }

        result = PromptTemplateConfigManager.convert(config)

        assert result == "advanced_entity"

    @pytest.mark.parametrize(
        "message",
        [
            {"text": 123, "role": "user"},
            {"text": "hi", "role": 123},
        ],
    )
    def test_convert_advanced_invalid_message_fields(self, mocker: MockerFixture, message):
        mock_prompt_entity_cls = MagicMock()
        mock_prompt_entity_cls.PromptType = DummyPromptType()

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.PromptTemplateEntity",
            mock_prompt_entity_cls,
        )

        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [message]},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.convert(config)

    def test_convert_advanced_completion_with_roles(self, mocker: MockerFixture):
        mock_prompt_entity_cls = MagicMock()
        mock_prompt_entity_cls.PromptType = DummyPromptType()
        mock_prompt_entity_cls.return_value = "advanced_entity"

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.PromptTemplateEntity",
            mock_prompt_entity_cls,
        )

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.AdvancedCompletionPromptTemplateEntity",
            return_value="completion_template",
        )

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

        assert result == "advanced_entity"


# -----------------------------
# validate_and_set_defaults
# -----------------------------


class TestValidateAndSetDefaults:
    def setup_method(self):
        self.valid_model = {"mode": "chat"}

    def _patch_prompt_type(self, mocker: MockerFixture):
        mock_prompt_entity_cls = MagicMock()
        mock_prompt_entity_cls.PromptType = DummyPromptType()
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.PromptTemplateEntity",
            mock_prompt_entity_cls,
        )
        return mock_prompt_entity_cls

    def test_default_prompt_type_set(self, mocker: MockerFixture):
        self._patch_prompt_type(mocker)

        config = {"model": self.valid_model}

        result, keys = PromptTemplateConfigManager.validate_and_set_defaults("chat_app", config)

        assert result["prompt_type"] == "simple"
        assert isinstance(keys, list)

    def test_invalid_prompt_type_raises(self, mocker: MockerFixture):
        class InvalidEnum(DummyPromptType):
            def __iter__(self):
                return iter([DummyEnumValue("valid")])

        mock_prompt_entity_cls = MagicMock()
        mock_prompt_entity_cls.PromptType = InvalidEnum()

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.prompt_template.manager.PromptTemplateEntity",
            mock_prompt_entity_cls,
        )

        config = {"prompt_type": "invalid", "model": self.valid_model}

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults("chat_app", config)

    def test_invalid_chat_prompt_config_type(self, mocker: MockerFixture):
        self._patch_prompt_type(mocker)

        config = {
            "prompt_type": "simple",
            "chat_prompt_config": "invalid",
            "model": self.valid_model,
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults("chat_app", config)

    def test_simple_mode_invalid_pre_prompt_type(self, mocker: MockerFixture):
        self._patch_prompt_type(mocker)

        config = {
            "prompt_type": "simple",
            "pre_prompt": 123,
            "model": self.valid_model,
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults("chat_app", config)

    def test_advanced_requires_one_config(self, mocker: MockerFixture):
        self._patch_prompt_type(mocker)

        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {},
            "completion_prompt_config": {},
            "model": {"mode": "chat"},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults("chat_app", config)

    def test_advanced_invalid_model_mode(self, mocker: MockerFixture):
        self._patch_prompt_type(mocker)

        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": []},
            "model": {"mode": "invalid"},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults("chat_app", config)

    def test_advanced_chat_prompt_length_exceeds(self, mocker: MockerFixture):
        self._patch_prompt_type(mocker)

        config = {
            "prompt_type": "advanced",
            "chat_prompt_config": {"prompt": [{}] * 11},
            "model": {"mode": "chat"},
        }

        with pytest.raises(ValueError):
            PromptTemplateConfigManager.validate_and_set_defaults("chat_app", config)

    def test_completion_prefix_defaults_set_when_empty(self, mocker: MockerFixture):
        self._patch_prompt_type(mocker)

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

        updated, _ = PromptTemplateConfigManager.validate_and_set_defaults("chat", config)

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

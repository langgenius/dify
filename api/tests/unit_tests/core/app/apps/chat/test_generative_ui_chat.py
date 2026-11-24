from __future__ import annotations

import json

import pytest

from core.app.app_config.features.generative_ui.manager import GenerativeUIConfigManager
from core.app.apps.chat.app_runner import ChatAppRunner
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.message_entities import (
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from libs.generative_ui_prompt import load_generative_ui_prompt
from models.model import AppModelConfig


class TestGenerativeUIConfigManager:
    @pytest.mark.parametrize("raw_config", [{}, {"generative_ui": {}}])
    def test_validate_and_set_defaults_populates_disabled_default(self, raw_config: dict[str, object]) -> None:
        config, keys = GenerativeUIConfigManager.validate_and_set_defaults(dict(raw_config))

        assert config == {"generative_ui": {"enabled": False}}
        assert keys == ["generative_ui"]

    def test_validate_and_set_defaults_accepts_enabled_flag(self) -> None:
        config, keys = GenerativeUIConfigManager.validate_and_set_defaults({"generative_ui": {"enabled": True}})

        assert config == {"generative_ui": {"enabled": True}}
        assert keys == ["generative_ui"]

    @pytest.mark.parametrize(
        "invalid_config",
        [
            {"generative_ui": "yes"},
            {"generative_ui": {"enabled": "true"}},
            {"generative_ui": {"enabled": 1}},
        ],
    )
    def test_validate_and_set_defaults_rejects_invalid_payload(self, invalid_config: dict[str, object]) -> None:
        with pytest.raises(ValueError, match="generative_ui"):
            GenerativeUIConfigManager.validate_and_set_defaults(invalid_config)

    def test_convert_returns_boolean_flag(self) -> None:
        assert GenerativeUIConfigManager.convert({}) is False
        assert GenerativeUIConfigManager.convert({"generative_ui": {"enabled": False}}) is False
        assert GenerativeUIConfigManager.convert({"generative_ui": {"enabled": True}}) is True


class TestAppModelConfigGenerativeUI:
    def test_app_model_config_round_trips_generative_ui(self) -> None:
        config = AppModelConfig(app_id="app-1", model=json.dumps({"provider": "openai", "name": "gpt-4o"}))
        assert config.generative_ui_dict == {"enabled": False}

        config.from_model_config_dict({"generative_ui": {"enabled": True}})
        assert config.generative_ui_dict == {"enabled": True}
        assert config.to_dict(annotation_reply={"enabled": False})["generative_ui"] == {"enabled": True}


class TestChatAppRunnerGenerativeUIPrompt:
    def test_injects_into_existing_chat_system_message_without_mutating_caller(self) -> None:
        original_system = SystemPromptMessage(content="You are helpful.")
        original_user = UserPromptMessage(content="Show Q1 sales.")
        prompt_messages = [original_system, original_user]

        updated = ChatAppRunner._inject_generative_ui_prompt(
            prompt_messages=prompt_messages,
            model_mode=LLMMode.CHAT.value,
        )

        assert len(updated) == 2
        assert isinstance(updated[0], SystemPromptMessage)
        assert isinstance(updated[0].content, str)
        assert updated[0].content.startswith("You are helpful.")
        assert load_generative_ui_prompt().strip() in updated[0].content
        assert original_system.content == "You are helpful."

    def test_prepends_chat_system_message_when_absent(self) -> None:
        updated = ChatAppRunner._inject_generative_ui_prompt(
            prompt_messages=[UserPromptMessage(content="Show Q1 sales.")],
            model_mode=LLMMode.CHAT.value,
        )

        assert len(updated) == 2
        assert isinstance(updated[0], SystemPromptMessage)
        assert updated[0].content == load_generative_ui_prompt()

    def test_injects_into_completion_user_prompt(self) -> None:
        updated_str = ChatAppRunner._inject_generative_ui_prompt(
            prompt_messages=[UserPromptMessage(content="Summarize.")],
            model_mode=LLMMode.COMPLETION.value,
        )
        assert len(updated_str) == 1
        assert isinstance(updated_str[0], UserPromptMessage)
        assert isinstance(updated_str[0].content, str)
        assert load_generative_ui_prompt() in updated_str[0].content
        assert updated_str[0].content.endswith("Summarize.")

        updated_list = ChatAppRunner._inject_generative_ui_prompt(
            prompt_messages=[UserPromptMessage(content=[TextPromptMessageContent(data="Summarize.")])],
            model_mode=LLMMode.COMPLETION.value,
        )
        assert len(updated_list) == 1
        assert isinstance(updated_list[0], UserPromptMessage)
        assert isinstance(updated_list[0].content, list)
        assert load_generative_ui_prompt() in updated_list[0].content[0].data

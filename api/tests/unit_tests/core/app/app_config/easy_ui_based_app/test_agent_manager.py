from unittest.mock import MagicMock

import pytest

from core.app.app_config.easy_ui_based_app.agent.manager import AgentConfigManager


class TestAgentConfigManagerConvert:
    @pytest.fixture
    def base_config(self):
        return {
            "agent_mode": {
                "enabled": True,
                "strategy": "cot",
                "tools": [],
            },
            "model": {
                "provider": "openai",
                "name": "gpt-4",
                "mode": "completion",
            },
        }

    def test_convert_returns_none_when_agent_mode_missing(self):
        config = {"model": {"provider": "openai", "name": "gpt-4"}}

        result = AgentConfigManager.convert(config)

        assert result is None

    @pytest.mark.parametrize("agent_mode_value", [None, {}, {"enabled": False}])
    def test_convert_returns_none_when_agent_mode_disabled(self, agent_mode_value, base_config):
        config = base_config.copy()
        config["agent_mode"] = agent_mode_value

        result = AgentConfigManager.convert(config)

        assert result is None

    @pytest.mark.parametrize(
        ("strategy_input", "expected_enum"),
        [
            ("function_call", "FUNCTION_CALLING"),
            ("cot", "CHAIN_OF_THOUGHT"),
            ("react", "CHAIN_OF_THOUGHT"),
        ],
    )
    def test_convert_strategy_mapping(self, strategy_input, expected_enum, base_config):
        config = base_config.copy()
        config["agent_mode"] = {
            "enabled": True,
            "strategy": strategy_input,
            "tools": [],
        }

        result = AgentConfigManager.convert(config)

        assert result is not None
        assert result.strategy.name == expected_enum

    def test_convert_unknown_strategy_openai_defaults_to_function_calling(self, base_config):
        config = base_config.copy()
        config["agent_mode"] = {
            "enabled": True,
            "strategy": "unknown_strategy",
            "tools": [],
        }
        config["model"]["provider"] = "openai"

        result = AgentConfigManager.convert(config)

        assert result.strategy.name == "FUNCTION_CALLING"

    def test_convert_unknown_strategy_non_openai_defaults_to_chain_of_thought(self, base_config):
        config = base_config.copy()
        config["agent_mode"] = {
            "enabled": True,
            "strategy": "unknown_strategy",
            "tools": [],
        }
        config["model"]["provider"] = "anthropic"

        result = AgentConfigManager.convert(config)

        assert result.strategy.name == "CHAIN_OF_THOUGHT"

    def test_convert_skips_disabled_tools(self, mocker, base_config):
        # Patch AgentEntity to bypass pydantic validation
        mock_agent_entity = mocker.patch(
            "core.app.app_config.easy_ui_based_app.agent.manager.AgentEntity",
            return_value=MagicMock(),
        )

        mock_validate = mocker.patch(
            "core.app.app_config.easy_ui_based_app.agent.manager.AgentToolEntity.model_validate",
            return_value={
                "provider_type": "type2",
                "provider_id": "id2",
                "tool_name": "tool2",
                "tool_parameters": {},
                "credential_id": None,
            },
        )

        config = base_config.copy()
        config["agent_mode"] = {
            "enabled": True,
            "strategy": "cot",
            "tools": [
                {
                    "provider_type": "type1",
                    "provider_id": "id1",
                    "tool_name": "tool1",
                    "enabled": False,
                },
                {
                    "provider_type": "type2",
                    "provider_id": "id2",
                    "tool_name": "tool2",
                    "enabled": True,
                    "extra_key": "x",
                },
            ],
        }

        AgentConfigManager.convert(config)

        mock_validate.assert_called_once()
        mock_agent_entity.assert_called_once()

    def test_convert_tool_requires_minimum_keys(self, mocker, base_config):
        mock_validate = mocker.patch(
            "core.app.app_config.easy_ui_based_app.agent.manager.AgentToolEntity.model_validate",
            return_value=MagicMock(),
        )

        config = base_config.copy()
        config["agent_mode"] = {
            "enabled": True,
            "strategy": "cot",
            "tools": [
                {"a": 1, "b": 2},  # insufficient keys
            ],
        }

        result = AgentConfigManager.convert(config)

        assert result is not None
        assert result.tools == []
        mock_validate.assert_not_called()

    def test_convert_completion_mode_prompt_defaults(self, base_config):
        config = base_config.copy()
        config["agent_mode"]["prompt"] = {}
        config["model"]["mode"] = "completion"

        result = AgentConfigManager.convert(config)

        assert result is not None
        assert result.prompt.first_prompt is not None
        assert result.prompt.next_iteration is not None

    def test_convert_chat_mode_prompt_defaults(self, base_config):
        config = base_config.copy()
        config["agent_mode"]["prompt"] = {}
        config["model"]["mode"] = "chat"

        result = AgentConfigManager.convert(config)

        assert result is not None
        assert result.prompt.first_prompt is not None
        assert result.prompt.next_iteration is not None

    def test_convert_router_strategy_returns_none(self, base_config):
        config = base_config.copy()
        config["agent_mode"] = {
            "enabled": True,
            "strategy": "router",
            "tools": [],
        }

        result = AgentConfigManager.convert(config)

        assert result is None

    def test_convert_react_router_strategy_returns_none(self, base_config):
        config = base_config.copy()
        config["agent_mode"] = {
            "enabled": True,
            "strategy": "react_router",
            "tools": [],
        }

        result = AgentConfigManager.convert(config)

        assert result is None

    def test_convert_max_iteration_default(self, base_config):
        config = base_config.copy()
        config["agent_mode"].pop("max_iteration", None)

        result = AgentConfigManager.convert(config)

        assert result.max_iteration == 10

    def test_convert_custom_max_iteration(self, base_config):
        config = base_config.copy()
        config["agent_mode"]["max_iteration"] = 25

        result = AgentConfigManager.convert(config)

        assert result.max_iteration == 25

    def test_convert_missing_model_raises_key_error(self, base_config):
        config = base_config.copy()
        del config["model"]

        with pytest.raises(KeyError):
            AgentConfigManager.convert(config)

    @pytest.mark.parametrize(
        ("invalid_config", "should_raise"),
        [
            (None, True),
            (123, True),
            ("", False),
            ([], False),
        ],
    )
    def test_convert_invalid_input_type_behavior(self, invalid_config, should_raise):
        if should_raise:
            with pytest.raises(TypeError):
                AgentConfigManager.convert(invalid_config)  # type: ignore
        else:
            result = AgentConfigManager.convert(invalid_config)  # type: ignore
            assert result is None

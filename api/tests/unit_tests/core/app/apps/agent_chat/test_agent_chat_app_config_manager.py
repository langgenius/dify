import uuid
from types import SimpleNamespace

import pytest

from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom
from core.app.apps.agent_chat.app_config_manager import (
    AgentChatAppConfigManager,
)
from core.entities.agent_entities import PlanningStrategy


class TestAgentChatAppConfigManagerGetAppConfig:
    def test_get_app_config_override_config(self, mocker):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent-chat")
        app_model_config = mocker.MagicMock(id="cfg1")
        app_model_config.to_dict.return_value = {"ignored": True}

        override_config = {"model": {"provider": "p"}}

        mocker.patch("core.app.apps.agent_chat.app_config_manager.ModelConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.PromptTemplateConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.AgentConfigManager.convert")
        mocker.patch.object(AgentChatAppConfigManager, "convert_features")
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.BasicVariablesConfigManager.convert",
            return_value=("variables", "external"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.AgentChatAppConfig",
            side_effect=lambda **kwargs: SimpleNamespace(**kwargs),
        )

        result = AgentChatAppConfigManager.get_app_config(
            app_model=app_model,
            app_model_config=app_model_config,
            conversation=None,
            override_config_dict=override_config,
        )

        assert result.app_model_config_dict == override_config
        assert result.app_model_config_from == EasyUIBasedAppModelConfigFrom.ARGS
        assert result.variables == "variables"
        assert result.external_data_variables == "external"

    def test_get_app_config_conversation_specific(self, mocker):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent-chat")
        app_model_config = mocker.MagicMock(id="cfg1")
        app_model_config.to_dict.return_value = {"model": {"provider": "p"}}
        conversation = mocker.MagicMock()

        mocker.patch("core.app.apps.agent_chat.app_config_manager.ModelConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.PromptTemplateConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.AgentConfigManager.convert")
        mocker.patch.object(AgentChatAppConfigManager, "convert_features")
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.BasicVariablesConfigManager.convert",
            return_value=("variables", "external"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.AgentChatAppConfig",
            side_effect=lambda **kwargs: SimpleNamespace(**kwargs),
        )

        result = AgentChatAppConfigManager.get_app_config(
            app_model=app_model,
            app_model_config=app_model_config,
            conversation=conversation,
            override_config_dict=None,
        )

        assert result.app_model_config_dict == app_model_config.to_dict.return_value
        assert result.app_model_config_from.value == "conversation-specific-config"

    def test_get_app_config_latest_config(self, mocker):
        app_model = mocker.MagicMock(id="app1", tenant_id="tenant", mode="agent-chat")
        app_model_config = mocker.MagicMock(id="cfg1")
        app_model_config.to_dict.return_value = {"model": {"provider": "p"}}

        mocker.patch("core.app.apps.agent_chat.app_config_manager.ModelConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.PromptTemplateConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.convert")
        mocker.patch("core.app.apps.agent_chat.app_config_manager.AgentConfigManager.convert")
        mocker.patch.object(AgentChatAppConfigManager, "convert_features")
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.BasicVariablesConfigManager.convert",
            return_value=("variables", "external"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.AgentChatAppConfig",
            side_effect=lambda **kwargs: SimpleNamespace(**kwargs),
        )

        result = AgentChatAppConfigManager.get_app_config(
            app_model=app_model,
            app_model_config=app_model_config,
            conversation=None,
            override_config_dict=None,
        )

        assert result.app_model_config_from.value == "app-latest-config"


class TestAgentChatAppConfigManagerConfigValidate:
    def test_config_validate_filters_related_keys(self, mocker):
        config = {
            "model": {},
            "user_input_form": {},
            "file_upload": {},
            "prompt_template": {},
            "agent_mode": {},
            "opening_statement": {},
            "suggested_questions_after_answer": {},
            "speech_to_text": {},
            "text_to_speech": {},
            "retriever_resource": {},
            "dataset": {},
            "moderation": {},
            "extra": "value",
        }

        def return_with_key(key):
            return config, [key]

        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.ModelConfigManager.validate_and_set_defaults",
            side_effect=lambda tenant_id, cfg: return_with_key("model"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.BasicVariablesConfigManager.validate_and_set_defaults",
            side_effect=lambda tenant_id, cfg: return_with_key("user_input_form"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.FileUploadConfigManager.validate_and_set_defaults",
            side_effect=lambda cfg: return_with_key("file_upload"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.PromptTemplateConfigManager.validate_and_set_defaults",
            side_effect=lambda app_mode, cfg: return_with_key("prompt_template"),
        )
        mocker.patch.object(
            AgentChatAppConfigManager,
            "validate_agent_mode_and_set_defaults",
            side_effect=lambda tenant_id, cfg: return_with_key("agent_mode"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.OpeningStatementConfigManager.validate_and_set_defaults",
            side_effect=lambda cfg: return_with_key("opening_statement"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults",
            side_effect=lambda cfg: return_with_key("suggested_questions_after_answer"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.SpeechToTextConfigManager.validate_and_set_defaults",
            side_effect=lambda cfg: return_with_key("speech_to_text"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.TextToSpeechConfigManager.validate_and_set_defaults",
            side_effect=lambda cfg: return_with_key("text_to_speech"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.RetrievalResourceConfigManager.validate_and_set_defaults",
            side_effect=lambda cfg: return_with_key("retriever_resource"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.validate_and_set_defaults",
            side_effect=lambda tenant_id, app_mode, cfg: return_with_key("dataset"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.validate_and_set_defaults",
            side_effect=lambda tenant_id, cfg: return_with_key("moderation"),
        )

        filtered = AgentChatAppConfigManager.config_validate("tenant", config)
        assert set(filtered.keys()) == {
            "model",
            "user_input_form",
            "file_upload",
            "prompt_template",
            "agent_mode",
            "opening_statement",
            "suggested_questions_after_answer",
            "speech_to_text",
            "text_to_speech",
            "retriever_resource",
            "dataset",
            "moderation",
        }
        assert "extra" not in filtered


class TestValidateAgentModeAndSetDefaults:
    def test_defaults_when_missing(self):
        config = {}
        updated, keys = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config)
        assert "agent_mode" in updated
        assert updated["agent_mode"]["enabled"] is False
        assert updated["agent_mode"]["tools"] == []
        assert keys == ["agent_mode"]

    @pytest.mark.parametrize(
        "agent_mode",
        ["invalid", 123],
    )
    def test_agent_mode_type_validation(self, agent_mode):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", {"agent_mode": agent_mode})

    def test_agent_mode_empty_list_defaults(self):
        config = {"agent_mode": []}
        updated, _ = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config)
        assert updated["agent_mode"]["enabled"] is False
        assert updated["agent_mode"]["tools"] == []

    def test_enabled_must_be_bool(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", {"agent_mode": {"enabled": "yes"}})

    def test_strategy_must_be_valid(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "strategy": "invalid"}}
            )

    def test_tools_must_be_list(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": "not-list"}}
            )

    def test_old_tool_dataset_requires_id(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True}}]}}
            )

    def test_old_tool_dataset_id_must_be_uuid(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True, "id": "bad"}}]}},
            )

    def test_old_tool_dataset_id_not_exists(self, mocker):
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.is_dataset_exists",
            return_value=False,
        )
        dataset_id = str(uuid.uuid4())
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True, "id": dataset_id}}]}},
            )

    def test_old_tool_enabled_must_be_bool(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": "yes", "id": str(uuid.uuid4())}}]}},
            )

    @pytest.mark.parametrize("missing_key", ["provider_type", "provider_id", "tool_name", "tool_parameters"])
    def test_new_style_tool_requires_fields(self, missing_key):
        tool = {"enabled": True, "provider_type": "type", "provider_id": "id", "tool_name": "tool"}
        tool.pop(missing_key, None)
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": [tool]}}
            )

    def test_valid_old_and_new_style_tools(self, mocker):
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.is_dataset_exists",
            return_value=True,
        )
        dataset_id = str(uuid.uuid4())
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER.value,
                "tools": [
                    {"dataset": {"id": dataset_id}},
                    {
                        "provider_type": "builtin",
                        "provider_id": "p1",
                        "tool_name": "tool",
                        "tool_parameters": {},
                    },
                ],
            }
        }

        updated, _ = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config)
        assert updated["agent_mode"]["tools"][0]["dataset"]["enabled"] is False
        assert updated["agent_mode"]["tools"][1]["enabled"] is False

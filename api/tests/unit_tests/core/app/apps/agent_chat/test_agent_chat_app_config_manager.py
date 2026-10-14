import uuid

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom
from core.app.apps.agent_chat.app_config_manager import (
    AgentChatAppConfig,
    AgentChatAppConfigManager,
)
from core.entities.agent_entities import PlanningStrategy
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation


def _app() -> App:
    return App(
        id="app1",
        tenant_id="tenant",
        name="Agent chat app",
        description="",
        mode=AppMode.AGENT_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _config() -> AppModelConfig:
    model = AppModelConfig(app_id="app1")
    config = model.to_dict(annotation_reply={"enabled": False})
    config["model"] = {"provider": "langgenius/openai/openai", "name": "m", "mode": "chat"}
    config["pre_prompt"] = "Help {{name}}."
    config["user_input_form"] = [{"text-input": {"variable": "name", "label": "Name", "required": True}}]
    config["external_data_tools"] = [{"enabled": True, "variable": "weather", "type": "api", "config": {}}]
    config["agent_mode"] = {"enabled": True, "strategy": "function_call", "tools": [], "prompt": None}
    return model.from_model_config_dict(config)


def _conversation() -> Conversation:
    return Conversation(
        id="conv",
        app_id="app1",
        mode=AppMode.AGENT_CHAT,
        name="Conversation",
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
    )


_CURRENT_SESSION: Session | None = None


@pytest.fixture(autouse=True)
def _bind_unbound_session(unbound_session: Session):
    global _CURRENT_SESSION
    _CURRENT_SESSION = unbound_session
    yield
    _CURRENT_SESSION = None


def _session() -> Session:
    assert _CURRENT_SESSION is not None
    return _CURRENT_SESSION


class TestAgentChatAppConfigManagerGetAppConfig:
    def test_get_app_config_override_config(self) -> None:
        app_model_config = _config()
        override_config = app_model_config.to_dict(annotation_reply={"enabled": False})
        override_config["pre_prompt"] = "Override {{name}}."

        result = AgentChatAppConfigManager.get_app_config(
            app_model=_app(),
            app_model_config=app_model_config,
            conversation=None,
            override_config_dict=override_config,
            annotation_reply=None,
        )

        assert isinstance(result, AgentChatAppConfig)
        assert result.app_model_config_dict == override_config
        assert result.app_model_config_from == EasyUIBasedAppModelConfigFrom.ARGS
        assert result.model.provider == "langgenius/openai/openai"
        assert result.model.model == "m"
        assert result.prompt_template.simple_prompt_template == "Override {{name}}."
        assert app_model_config.pre_prompt == "Help {{name}}."
        assert len(result.variables) == 1
        assert result.variables[0].variable == "name"
        assert result.variables[0].required is True
        assert len(result.external_data_variables) == 1
        assert result.external_data_variables[0].variable == "weather"
        assert result.external_data_variables[0].type == "api"
        assert result.agent is not None
        assert result.agent.strategy.value == "function-calling"

    @pytest.mark.parametrize(
        ("conversation", "expected_from"),
        [
            (_conversation(), EasyUIBasedAppModelConfigFrom.CONVERSATION_SPECIFIC_CONFIG),
            (None, EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG),
        ],
    )
    def test_get_app_config_stored_config(
        self,
        conversation: Conversation | None,
        expected_from: EasyUIBasedAppModelConfigFrom,
    ) -> None:
        """None selects the latest app config; a conversation selects its supplied config."""
        app_model_config = _config()
        result = AgentChatAppConfigManager.get_app_config(
            app_model=_app(),
            app_model_config=app_model_config,
            conversation=conversation,
            override_config_dict=None,
            annotation_reply={"enabled": False},
        )

        assert isinstance(result, AgentChatAppConfig)
        assert result.app_model_config_from == expected_from
        assert result.app_model_config_id == app_model_config.id
        assert result.app_model_config_dict == app_model_config.to_dict(annotation_reply={"enabled": False})
        assert result.prompt_template.simple_prompt_template == "Help {{name}}."
        assert result.model.model == "m"
        assert result.agent is not None
        assert result.agent.strategy.value == "function-calling"

    def test_get_app_config_requires_annotation_reply_without_override(self):
        with pytest.raises(ValueError, match="Annotation reply config is required"):
            AgentChatAppConfigManager.get_app_config(
                app_model=_app(),
                app_model_config=_config(),
                conversation=None,
                annotation_reply=None,
            )


class TestAgentChatAppConfigManagerConfigValidate:
    def test_config_validate_filters_related_keys(self, mocker: MockerFixture):
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
            side_effect=lambda tenant_id, cfg, session: return_with_key("agent_mode"),
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
            side_effect=lambda tenant_id, app_mode, cfg, session: return_with_key("dataset"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.validate_and_set_defaults",
            side_effect=lambda tenant_id, cfg: return_with_key("moderation"),
        )

        filtered = AgentChatAppConfigManager.config_validate("tenant", config, _session())
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
        updated, keys = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config, _session())
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
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": agent_mode}, _session()
            )

    def test_agent_mode_empty_list_defaults(self):
        config = {"agent_mode": []}
        updated, _ = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config, _session())
        assert updated["agent_mode"]["enabled"] is False
        assert updated["agent_mode"]["tools"] == []

    def test_enabled_must_be_bool(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": "yes"}}, _session()
            )

    def test_strategy_must_be_valid(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "strategy": "invalid"}}, _session()
            )

    def test_tools_must_be_list(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": "not-list"}}, _session()
            )

    def test_old_tool_dataset_requires_id(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True}}]}}, _session()
            )

    def test_old_tool_dataset_id_must_be_uuid(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True, "id": "bad"}}]}},
                _session(),
            )

    def test_old_tool_dataset_id_not_exists(self, mocker: MockerFixture):
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.is_dataset_exists",
            return_value=False,
        )
        dataset_id = str(uuid.uuid4())
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True, "id": dataset_id}}]}},
                _session(),
            )

    def test_old_tool_enabled_must_be_bool(self):
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": "yes", "id": str(uuid.uuid4())}}]}},
                _session(),
            )

    @pytest.mark.parametrize("missing_key", ["provider_type", "provider_id", "tool_name", "tool_parameters"])
    def test_new_style_tool_requires_fields(self, missing_key):
        tool = {"enabled": True, "provider_type": "type", "provider_id": "id", "tool_name": "tool"}
        tool.pop(missing_key, None)
        with pytest.raises(ValueError):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": [tool]}}, _session()
            )

    def test_valid_old_and_new_style_tools(self, mocker: MockerFixture):
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

        updated, _ = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config, _session())
        assert updated["agent_mode"]["tools"][0]["dataset"]["enabled"] is False
        assert updated["agent_mode"]["tools"][1]["enabled"] is False

import json
import uuid
from collections.abc import Generator

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
        _inputs={},
        from_source=ConversationFromSource.CONSOLE,
    )


_CURRENT_SESSION: Session | None = None


@pytest.fixture(autouse=True)
def _bind_unbound_session(unbound_session: Session) -> Generator[None]:
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

    @pytest.mark.parametrize("tools", [[], [{}]], ids=["no-tools", "legacy-empty-tool"])
    @pytest.mark.parametrize(
        ("conversation", "expected_from"),
        [
            (_conversation(), EasyUIBasedAppModelConfigFrom.CONVERSATION_SPECIFIC_CONFIG),
            (None, EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG),
        ],
    )
    def test_get_app_config_stored_config(
        self,
        tools: list[dict[str, object]],
        conversation: Conversation | None,
        expected_from: EasyUIBasedAppModelConfigFrom,
    ) -> None:
        """None selects the latest app config; a conversation selects its supplied config."""
        app_model_config = _config()
        app_model_config.agent_mode = json.dumps({**app_model_config.agent_mode_dict, "tools": tools})
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
        assert result.agent.tools == []

    def test_get_app_config_requires_annotation_reply_without_override(self) -> None:
        with pytest.raises(ValueError, match="Annotation reply config is required"):
            AgentChatAppConfigManager.get_app_config(
                app_model=_app(),
                app_model_config=_config(),
                conversation=None,
                annotation_reply=None,
            )


class TestAgentChatAppConfigManagerConfigValidate:
    def test_config_validate_filters_related_keys(self, mocker: MockerFixture) -> None:
        config: dict[str, object] = {
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

        def return_with_key(key: str) -> tuple[dict[str, object], list[str]]:
            return config, [key]

        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.ModelConfigManager.validate_and_set_defaults",
            side_effect=lambda _tenant_id, _cfg: return_with_key("model"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.BasicVariablesConfigManager.validate_and_set_defaults",
            side_effect=lambda _tenant_id, _cfg: return_with_key("user_input_form"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.FileUploadConfigManager.validate_and_set_defaults",
            side_effect=lambda _cfg: return_with_key("file_upload"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.PromptTemplateConfigManager.validate_and_set_defaults",
            side_effect=lambda _app_mode, _cfg: return_with_key("prompt_template"),
        )
        mocker.patch.object(
            AgentChatAppConfigManager,
            "validate_agent_mode_and_set_defaults",
            side_effect=lambda _tenant_id, _cfg, _session: return_with_key("agent_mode"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.OpeningStatementConfigManager.validate_and_set_defaults",
            side_effect=lambda _cfg: return_with_key("opening_statement"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults",
            side_effect=lambda _cfg: return_with_key("suggested_questions_after_answer"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.SpeechToTextConfigManager.validate_and_set_defaults",
            side_effect=lambda _cfg: return_with_key("speech_to_text"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.TextToSpeechConfigManager.validate_and_set_defaults",
            side_effect=lambda _cfg: return_with_key("text_to_speech"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.RetrievalResourceConfigManager.validate_and_set_defaults",
            side_effect=lambda _cfg: return_with_key("retriever_resource"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.validate_and_set_defaults",
            side_effect=lambda _tenant_id, _app_mode, _cfg, _session: return_with_key("dataset"),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.validate_and_set_defaults",
            side_effect=lambda _tenant_id, _cfg: return_with_key("moderation"),
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
    def test_defaults_when_missing(self) -> None:
        config: dict[str, object] = {}
        updated, keys = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config, _session())
        assert "agent_mode" in updated
        assert updated["agent_mode"]["enabled"] is False
        assert updated["agent_mode"]["tools"] == []
        assert keys == ["agent_mode"]

    @pytest.mark.parametrize(
        "agent_mode",
        ["invalid", 123],
    )
    def test_agent_mode_type_validation(self, agent_mode: str | int) -> None:
        with pytest.raises(ValueError, match="agent_mode must be of object type"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": agent_mode}, _session()
            )

    def test_agent_mode_empty_list_defaults(self) -> None:
        config: dict[str, object] = {"agent_mode": []}
        updated, _ = AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config, _session())
        assert updated["agent_mode"]["enabled"] is False
        assert updated["agent_mode"]["tools"] == []

    def test_enabled_must_be_bool(self) -> None:
        with pytest.raises(ValueError, match="enabled in agent_mode must be of boolean type"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": "yes"}}, _session()
            )

    def test_strategy_must_be_valid(self) -> None:
        with pytest.raises(ValueError, match="strategy in agent_mode must be in the specified strategy list"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "strategy": "invalid"}}, _session()
            )

    def test_tools_must_be_list(self) -> None:
        with pytest.raises(ValueError, match="tools in agent_mode must be a list of objects"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": "not-list"}}, _session()
            )

    def test_old_tool_dataset_requires_id(self) -> None:
        with pytest.raises(ValueError, match="id is required in dataset"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True}}]}}, _session()
            )

    def test_old_tool_dataset_id_must_be_uuid(self) -> None:
        with pytest.raises(ValueError, match="id in dataset must be of UUID type"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True, "id": "bad"}}]}},
                _session(),
            )

    def test_old_tool_dataset_id_not_exists(self, mocker: MockerFixture) -> None:
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.is_dataset_exists",
            return_value=False,
        )
        dataset_id = str(uuid.uuid4())
        with pytest.raises(ValueError, match="Dataset ID does not exist, please check your permission\\."):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": True, "id": dataset_id}}]}},
                _session(),
            )

    def test_old_tool_enabled_must_be_bool(self) -> None:
        with pytest.raises(ValueError, match="enabled in agent_mode\\.tools must be of boolean type"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant",
                {"agent_mode": {"enabled": True, "tools": [{"dataset": {"enabled": "yes", "id": str(uuid.uuid4())}}]}},
                _session(),
            )

    @pytest.mark.parametrize("missing_key", ["provider_type", "provider_id", "tool_name", "tool_parameters"])
    def test_new_style_tool_requires_fields(self, missing_key: str) -> None:
        tool = {"enabled": True, "provider_type": "type", "provider_id": "id", "tool_name": "tool"}
        tool.pop(missing_key, None)
        with pytest.raises(
            ValueError,
            match=(
                "(?:provider_id is required in agent_mode\\.tools|provider_type is "
                "required in agent_mode\\.tools|tool_name is required in "
                "agent_mode\\.tools|tool_parameters is required in agent_mode\\.tools)"
            ),
        ):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults(
                "tenant", {"agent_mode": {"enabled": True, "tools": [tool]}}, _session()
            )

    def test_valid_old_and_new_style_tools(self, mocker: MockerFixture) -> None:
        mocker.patch(
            "core.app.apps.agent_chat.app_config_manager.DatasetConfigManager.is_dataset_exists",
            return_value=True,
        )
        dataset_id = str(uuid.uuid4())
        config: dict[str, object] = {
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

    @pytest.mark.parametrize(
        "tool",
        [
            pytest.param({}, id="empty-object"),
            pytest.param(None, id="null"),
            pytest.param(False, id="boolean"),
            pytest.param(0, id="number"),
            pytest.param("", id="empty-string"),
            pytest.param("tool", id="string"),
            pytest.param([], id="empty-list"),
            pytest.param(["tool"], id="list"),
        ],
    )
    def test_tool_entries_must_be_non_empty_objects(self, tool: object) -> None:
        config = {
            "agent_mode": {
                "enabled": True,
                "strategy": PlanningStrategy.ROUTER.value,
                "tools": [tool],
            }
        }
        with pytest.raises(ValueError, match=r"Each item in agent_mode\.tools must be a non-empty object"):
            AgentChatAppConfigManager.validate_agent_mode_and_set_defaults("tenant", config, _session())

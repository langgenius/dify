from types import SimpleNamespace
from unittest.mock import patch

from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from models.model import AppMode


class TestAdvancedChatAppConfigManager:
    def test_get_app_config(self):
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.ADVANCED_CHAT.value)
        workflow = SimpleNamespace(id="wf-1", features_dict={})

        with (
            patch(
                "core.app.apps.advanced_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.convert",
                return_value=None,
            ),
            patch(
                "core.app.apps.advanced_chat.app_config_manager.WorkflowVariablesConfigManager.convert",
                return_value=[],
            ),
        ):
            app_config = AdvancedChatAppConfigManager.get_app_config(app_model, workflow)

        assert app_config.workflow_id == "wf-1"
        assert app_config.app_mode == AppMode.ADVANCED_CHAT

    def test_config_validate_filters_keys(self):
        def _add_key(key, value):
            def _inner(*args, **kwargs):
                config = kwargs.get("config") if kwargs else args[-1]
                config = {**config, key: value}
                return config, [key]

            return _inner

        with (
            patch(
                "core.app.apps.advanced_chat.app_config_manager.FileUploadConfigManager.validate_and_set_defaults",
                side_effect=_add_key("file_upload", 1),
            ),
            patch(
                "core.app.apps.advanced_chat.app_config_manager.OpeningStatementConfigManager.validate_and_set_defaults",
                side_effect=_add_key("opening_statement", 2),
            ),
            patch(
                "core.app.apps.advanced_chat.app_config_manager.SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults",
                side_effect=_add_key("suggested_questions_after_answer", 3),
            ),
            patch(
                "core.app.apps.advanced_chat.app_config_manager.SpeechToTextConfigManager.validate_and_set_defaults",
                side_effect=_add_key("speech_to_text", 4),
            ),
            patch(
                "core.app.apps.advanced_chat.app_config_manager.TextToSpeechConfigManager.validate_and_set_defaults",
                side_effect=_add_key("text_to_speech", 5),
            ),
            patch(
                "core.app.apps.advanced_chat.app_config_manager.RetrievalResourceConfigManager.validate_and_set_defaults",
                side_effect=_add_key("retriever_resource", 6),
            ),
            patch(
                "core.app.apps.advanced_chat.app_config_manager.SensitiveWordAvoidanceConfigManager.validate_and_set_defaults",
                side_effect=_add_key("sensitive_word_avoidance", 7),
            ),
        ):
            filtered = AdvancedChatAppConfigManager.config_validate(tenant_id="t1", config={})

        assert filtered["file_upload"] == 1
        assert filtered["opening_statement"] == 2
        assert filtered["suggested_questions_after_answer"] == 3
        assert filtered["speech_to_text"] == 4
        assert filtered["text_to_speech"] == 5
        assert filtered["retriever_resource"] == 6
        assert filtered["sensitive_word_avoidance"] == 7

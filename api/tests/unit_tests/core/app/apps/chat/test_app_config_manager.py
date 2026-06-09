from types import SimpleNamespace
from unittest.mock import patch

from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom, ModelConfigEntity, PromptTemplateEntity
from core.app.apps.chat.app_config_manager import ChatAppConfigManager
from models.model import AppMode


class TestChatAppConfigManager:
    def test_get_app_config_uses_override_dict(self):
        app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT.value)
        app_model_config = SimpleNamespace(id="config-1", to_dict=lambda: {"model": "m"})
        override = {"model": "override"}

        model_entity = ModelConfigEntity(provider="p", model="m")
        prompt_entity = PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="hi",
        )

        with (
            patch("core.app.apps.chat.app_config_manager.ModelConfigManager.convert", return_value=model_entity),
            patch(
                "core.app.apps.chat.app_config_manager.PromptTemplateConfigManager.convert", return_value=prompt_entity
            ),
            patch(
                "core.app.apps.chat.app_config_manager.SensitiveWordAvoidanceConfigManager.convert",
                return_value=None,
            ),
            patch("core.app.apps.chat.app_config_manager.DatasetConfigManager.convert", return_value=None),
            patch("core.app.apps.chat.app_config_manager.BasicVariablesConfigManager.convert", return_value=([], [])),
        ):
            app_config = ChatAppConfigManager.get_app_config(
                app_model=app_model,
                app_model_config=app_model_config,
                conversation=None,
                override_config_dict=override,
            )

        assert app_config.app_model_config_from == EasyUIBasedAppModelConfigFrom.ARGS
        assert app_config.app_model_config_dict == override
        assert app_config.app_mode == AppMode.CHAT

    def test_config_validate_filters_related_keys(self):
        config = {"extra": 1}

        def _add_key(key, value):
            def _inner(*args, **kwargs):
                config = args[-1]
                config = {**config, key: value}
                return config, [key]

            return _inner

        with (
            patch(
                "core.app.apps.chat.app_config_manager.ModelConfigManager.validate_and_set_defaults",
                side_effect=_add_key("model", 1),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.BasicVariablesConfigManager.validate_and_set_defaults",
                side_effect=_add_key("inputs", 2),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.FileUploadConfigManager.validate_and_set_defaults",
                side_effect=_add_key("file_upload", 3),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.PromptTemplateConfigManager.validate_and_set_defaults",
                side_effect=_add_key("prompt", 4),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.DatasetConfigManager.validate_and_set_defaults",
                side_effect=_add_key("dataset", 5),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.OpeningStatementConfigManager.validate_and_set_defaults",
                side_effect=_add_key("opening_statement", 6),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults",
                side_effect=_add_key("suggested_questions_after_answer", 7),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.SpeechToTextConfigManager.validate_and_set_defaults",
                side_effect=_add_key("speech_to_text", 8),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.TextToSpeechConfigManager.validate_and_set_defaults",
                side_effect=_add_key("text_to_speech", 9),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.RetrievalResourceConfigManager.validate_and_set_defaults",
                side_effect=_add_key("retriever_resource", 10),
            ),
            patch(
                "core.app.apps.chat.app_config_manager.SensitiveWordAvoidanceConfigManager.validate_and_set_defaults",
                side_effect=_add_key("sensitive_word_avoidance", 11),
            ),
        ):
            filtered = ChatAppConfigManager.config_validate(tenant_id="t1", config=config)

        assert filtered["model"] == 1
        assert filtered["inputs"] == 2
        assert filtered["file_upload"] == 3
        assert filtered["prompt"] == 4
        assert filtered["dataset"] == 5
        assert filtered["opening_statement"] == 6
        assert filtered["suggested_questions_after_answer"] == 7
        assert filtered["speech_to_text"] == 8
        assert filtered["text_to_speech"] == 9
        assert filtered["retriever_resource"] == 10
        assert filtered["sensitive_word_avoidance"] == 11

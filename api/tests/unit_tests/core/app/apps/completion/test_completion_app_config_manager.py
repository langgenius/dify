from types import SimpleNamespace

from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

import core.app.apps.completion.app_config_manager as module
from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom
from core.app.apps.completion.app_config_manager import CompletionAppConfigManager
from models.model import App, AppMode, AppModelConfig


def _app() -> App:
    return App(
        id="app1",
        tenant_id="tenant",
        name="Completion app",
        description="",
        mode=AppMode.COMPLETION,
        enable_site=False,
        enable_api=False,
    )


def _config() -> AppModelConfig:
    return AppModelConfig(app_id="app1")


class TestCompletionAppConfigManager:
    def test_get_app_config_with_override(self, mocker: MockerFixture):
        app_model = _app()
        app_model_config = _config()

        override_config = {"model": {"provider": "override"}}

        mocker.patch.object(module.ModelConfigManager, "convert", return_value="model")
        mocker.patch.object(module.PromptTemplateConfigManager, "convert", return_value="prompt")
        mocker.patch.object(module.SensitiveWordAvoidanceConfigManager, "convert", return_value="moderation")
        mocker.patch.object(module.DatasetConfigManager, "convert", return_value="dataset")
        mocker.patch.object(CompletionAppConfigManager, "convert_features", return_value="features")
        mocker.patch.object(module.BasicVariablesConfigManager, "convert", return_value=(["v1"], ["ext1"]))
        mocker.patch.object(module, "CompletionAppConfig", side_effect=lambda **kwargs: SimpleNamespace(**kwargs))

        result = CompletionAppConfigManager.get_app_config(
            app_model=app_model,
            app_model_config=app_model_config,
            override_config_dict=override_config,
            annotation_reply=None,
        )

        assert result.app_model_config_from == EasyUIBasedAppModelConfigFrom.ARGS
        assert result.app_model_config_dict == override_config
        assert result.variables == ["v1"]
        assert result.external_data_variables == ["ext1"]
        assert result.app_mode == AppMode.COMPLETION

    def test_get_app_config_without_override_uses_model_config(self, mocker: MockerFixture):
        app_model = _app()
        app_model_config = _config()
        annotation_reply = {"enabled": False}
        to_dict = mocker.patch.object(
            AppModelConfig,
            "to_dict",
            return_value={"model": {"provider": "x"}},
        )

        mocker.patch.object(module.ModelConfigManager, "convert", return_value="model")
        mocker.patch.object(module.PromptTemplateConfigManager, "convert", return_value="prompt")
        mocker.patch.object(module.SensitiveWordAvoidanceConfigManager, "convert", return_value="moderation")
        mocker.patch.object(module.DatasetConfigManager, "convert", return_value="dataset")
        mocker.patch.object(CompletionAppConfigManager, "convert_features", return_value="features")
        mocker.patch.object(module.BasicVariablesConfigManager, "convert", return_value=([], []))
        mocker.patch.object(module, "CompletionAppConfig", side_effect=lambda **kwargs: SimpleNamespace(**kwargs))

        result = CompletionAppConfigManager.get_app_config(
            app_model=app_model,
            app_model_config=app_model_config,
            annotation_reply=annotation_reply,
        )

        assert result.app_model_config_from == EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG
        assert result.app_model_config_dict == {"model": {"provider": "x"}}
        to_dict.assert_called_once_with(annotation_reply=annotation_reply)

    def test_config_validate_filters_related_keys(self, mocker: MockerFixture, unbound_session: Session):
        config = {
            "model": {"provider": "x"},
            "variables": ["v"],
            "file_upload": {"enabled": True},
            "prompt": {"template": "t"},
            "dataset": {"enabled": True},
            "tts": {"enabled": True},
            "more_like_this": {"enabled": True},
            "moderation": {"enabled": True},
            "extra": "drop",
        }

        mocker.patch.object(
            module.ModelConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["model"]),
        )
        mocker.patch.object(
            module.BasicVariablesConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["variables"]),
        )
        mocker.patch.object(
            module.FileUploadConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["file_upload"]),
        )
        mocker.patch.object(
            module.PromptTemplateConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["prompt"]),
        )
        mocker.patch.object(
            module.DatasetConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["dataset"]),
        )
        mocker.patch.object(
            module.TextToSpeechConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["tts"]),
        )
        mocker.patch.object(
            module.MoreLikeThisConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["more_like_this"]),
        )
        mocker.patch.object(
            module.SensitiveWordAvoidanceConfigManager,
            "validate_and_set_defaults",
            return_value=(config, ["moderation"]),
        )

        filtered = CompletionAppConfigManager.config_validate("tenant", config, unbound_session)

        assert "extra" not in filtered
        assert set(filtered.keys()) == {
            "model",
            "variables",
            "file_upload",
            "prompt",
            "dataset",
            "tts",
            "more_like_this",
            "moderation",
        }

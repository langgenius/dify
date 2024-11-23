from typing import Optional

from core.app.app_config.base_app_config_manager import BaseAppConfigManager
from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.easy_ui_based_app.dataset.manager import DatasetConfigManager
from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
from core.app.app_config.easy_ui_based_app.prompt_template.manager import PromptTemplateConfigManager
from core.app.app_config.easy_ui_based_app.variables.manager import BasicVariablesConfigManager
from core.app.app_config.entities import EasyUIBasedAppConfig, EasyUIBasedAppModelConfigFrom
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.app_config.features.more_like_this.manager import MoreLikeThisConfigManager
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager
from models.model import App, AppMode, AppModelConfig


class CompletionAppConfig(EasyUIBasedAppConfig):
    """
    Completion App Config Entity.
    """

    pass


class CompletionAppConfigManager(BaseAppConfigManager):
    @classmethod
    def get_app_config(
        cls, app_model: App, app_model_config: AppModelConfig, override_config_dict: Optional[dict] = None
    ) -> CompletionAppConfig:
        """
        Convert app model config to completion app config
        :param app_model: app model
        :param app_model_config: app model config
        :param override_config_dict: app model config dict
        :return:
        """
        if override_config_dict:
            config_from = EasyUIBasedAppModelConfigFrom.ARGS
        else:
            config_from = EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG

        if config_from != EasyUIBasedAppModelConfigFrom.ARGS:
            app_model_config_dict = app_model_config.to_dict()
            config_dict = app_model_config_dict.copy()
        else:
            config_dict = override_config_dict

        app_mode = AppMode.value_of(app_model.mode)
        app_config = CompletionAppConfig(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            app_mode=app_mode,
            app_model_config_from=config_from,
            app_model_config_id=app_model_config.id,
            app_model_config_dict=config_dict,
            model=ModelConfigManager.convert(config=config_dict),
            prompt_template=PromptTemplateConfigManager.convert(config=config_dict),
            sensitive_word_avoidance=SensitiveWordAvoidanceConfigManager.convert(config=config_dict),
            dataset=DatasetConfigManager.convert(config=config_dict),
            additional_features=cls.convert_features(config_dict, app_mode),
        )

        app_config.variables, app_config.external_data_variables = BasicVariablesConfigManager.convert(
            config=config_dict
        )

        return app_config

    @classmethod
    def config_validate(cls, tenant_id: str, config: dict) -> dict:
        """
        Validate for completion app model config

        :param tenant_id: tenant id
        :param config: app model config args
        """
        app_mode = AppMode.COMPLETION

        related_config_keys = []

        # model
        config, current_related_config_keys = ModelConfigManager.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # user_input_form
        config, current_related_config_keys = BasicVariablesConfigManager.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # file upload validation
        config, current_related_config_keys = FileUploadConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # prompt
        config, current_related_config_keys = PromptTemplateConfigManager.validate_and_set_defaults(app_mode, config)
        related_config_keys.extend(current_related_config_keys)

        # dataset_query_variable
        config, current_related_config_keys = DatasetConfigManager.validate_and_set_defaults(
            tenant_id, app_mode, config
        )
        related_config_keys.extend(current_related_config_keys)

        # text_to_speech
        config, current_related_config_keys = TextToSpeechConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # more_like_this
        config, current_related_config_keys = MoreLikeThisConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # moderation validation
        config, current_related_config_keys = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id, config
        )
        related_config_keys.extend(current_related_config_keys)

        related_config_keys = list(set(related_config_keys))

        # Filter out extra parameters
        filtered_config = {key: config.get(key) for key in related_config_keys}

        return filtered_config

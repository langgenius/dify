from typing import Optional, Union

from core.app.app_config.entities import AppAdditionalFeatures, EasyUIBasedAppModelConfigFrom
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.app_config.features.more_like_this.manager import MoreLikeThisConfigManager
from core.app.app_config.features.opening_statement.manager import OpeningStatementConfigManager
from core.app.app_config.features.retrieval_resource.manager import RetrievalResourceConfigManager
from core.app.app_config.features.speech_to_text.manager import SpeechToTextConfigManager
from core.app.app_config.features.suggested_questions_after_answer.manager import (
    SuggestedQuestionsAfterAnswerConfigManager,
)
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager
from models.model import AppMode, AppModelConfig


class BaseAppConfigManager:

    @classmethod
    def convert_to_config_dict(cls, config_from: EasyUIBasedAppModelConfigFrom,
                               app_model_config: Union[AppModelConfig, dict],
                               config_dict: Optional[dict] = None) -> dict:
        """
        Convert app model config to config dict
        :param config_from: app model config from
        :param app_model_config: app model config
        :param config_dict: app model config dict
        :return:
        """
        if config_from != EasyUIBasedAppModelConfigFrom.ARGS:
            app_model_config_dict = app_model_config.to_dict()
            config_dict = app_model_config_dict.copy()

        return config_dict

    @classmethod
    def convert_features(cls, config_dict: dict, app_mode: AppMode) -> AppAdditionalFeatures:
        """
        Convert app config to app model config

        :param config_dict: app config
        :param app_mode: app mode
        """
        config_dict = config_dict.copy()

        additional_features = AppAdditionalFeatures()
        additional_features.show_retrieve_source = RetrievalResourceConfigManager.convert(
            config=config_dict
        )

        additional_features.file_upload = FileUploadConfigManager.convert(
            config=config_dict,
            is_vision=app_mode in [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT]
        )

        additional_features.opening_statement, additional_features.suggested_questions = \
            OpeningStatementConfigManager.convert(
                config=config_dict
            )

        additional_features.suggested_questions_after_answer = SuggestedQuestionsAfterAnswerConfigManager.convert(
            config=config_dict
        )

        additional_features.more_like_this = MoreLikeThisConfigManager.convert(
            config=config_dict
        )

        additional_features.speech_to_text = SpeechToTextConfigManager.convert(
            config=config_dict
        )

        additional_features.text_to_speech = TextToSpeechConfigManager.convert(
            config=config_dict
        )

        return additional_features

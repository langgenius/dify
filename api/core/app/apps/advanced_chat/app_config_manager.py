from core.app.app_config.base_app_config_manager import BaseAppConfigManager
from core.app.app_config.common.sensitive_word_avoidance.manager import SensitiveWordAvoidanceConfigManager
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.app_config.features.opening_statement.manager import OpeningStatementConfigManager
from core.app.app_config.features.retrieval_resource.manager import RetrievalResourceConfigManager
from core.app.app_config.features.speech_to_text.manager import SpeechToTextConfigManager
from core.app.app_config.features.suggested_questions_after_answer.manager import (
    SuggestedQuestionsAfterAnswerConfigManager,
)
from core.app.app_config.features.text_to_speech.manager import TextToSpeechConfigManager
from core.app.app_config.workflow_ui_based_app.variables.manager import WorkflowVariablesConfigManager
from models.model import App, AppMode
from models.workflow import Workflow


class AdvancedChatAppConfig(WorkflowUIBasedAppConfig):
    """
    Advanced Chatbot App Config Entity.
    """

    pass


class AdvancedChatAppConfigManager(BaseAppConfigManager):
    @classmethod
    def get_app_config(cls, app_model: App, workflow: Workflow) -> AdvancedChatAppConfig:
        features_dict = workflow.features_dict

        app_mode = AppMode.value_of(app_model.mode)
        app_config = AdvancedChatAppConfig(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            app_mode=app_mode,
            workflow_id=workflow.id,
            sensitive_word_avoidance=SensitiveWordAvoidanceConfigManager.convert(config=features_dict),
            variables=WorkflowVariablesConfigManager.convert(workflow=workflow),
            additional_features=cls.convert_features(features_dict, app_mode),
        )

        return app_config

    @classmethod
    def config_validate(cls, tenant_id: str, config: dict, only_structure_validate: bool = False) -> dict:
        """
        Validate for advanced chat app model config

        :param tenant_id: tenant id
        :param config: app model config args
        :param only_structure_validate: if True, only structure validation will be performed
        """
        related_config_keys = []

        # file upload validation
        config, current_related_config_keys = FileUploadConfigManager.validate_and_set_defaults(
            config=config, is_vision=False
        )
        related_config_keys.extend(current_related_config_keys)

        # opening_statement
        config, current_related_config_keys = OpeningStatementConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # suggested_questions_after_answer
        config, current_related_config_keys = SuggestedQuestionsAfterAnswerConfigManager.validate_and_set_defaults(
            config
        )
        related_config_keys.extend(current_related_config_keys)

        # speech_to_text
        config, current_related_config_keys = SpeechToTextConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # text_to_speech
        config, current_related_config_keys = TextToSpeechConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # return retriever resource
        config, current_related_config_keys = RetrievalResourceConfigManager.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # moderation validation
        config, current_related_config_keys = SensitiveWordAvoidanceConfigManager.validate_and_set_defaults(
            tenant_id=tenant_id, config=config, only_structure_validate=only_structure_validate
        )
        related_config_keys.extend(current_related_config_keys)

        related_config_keys = list(set(related_config_keys))

        # Filter out extra parameters
        filtered_config = {key: config.get(key) for key in related_config_keys}

        return filtered_config

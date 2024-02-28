from core.apps.config_validators.file_upload import FileUploadValidator
from core.apps.config_validators.moderation import ModerationValidator
from core.apps.config_validators.opening_statement import OpeningStatementValidator
from core.apps.config_validators.retriever_resource import RetrieverResourceValidator
from core.apps.config_validators.speech_to_text import SpeechToTextValidator
from core.apps.config_validators.suggested_questions import SuggestedQuestionsValidator
from core.apps.config_validators.text_to_speech import TextToSpeechValidator


class AdvancedChatAppConfigValidator:
    @classmethod
    def config_validate(cls, tenant_id: str, config: dict) -> dict:
        """
        Validate for advanced chat app model config

        :param tenant_id: tenant id
        :param config: app model config args
        """
        related_config_keys = []

        # file upload validation
        config, current_related_config_keys = FileUploadValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # opening_statement
        config, current_related_config_keys = OpeningStatementValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # suggested_questions_after_answer
        config, current_related_config_keys = SuggestedQuestionsValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # speech_to_text
        config, current_related_config_keys = SpeechToTextValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # text_to_speech
        config, current_related_config_keys = TextToSpeechValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # return retriever resource
        config, current_related_config_keys = RetrieverResourceValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # moderation validation
        config, current_related_config_keys = ModerationValidator.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        related_config_keys = list(set(related_config_keys))

        # Filter out extra parameters
        filtered_config = {key: config.get(key) for key in related_config_keys}

        return filtered_config

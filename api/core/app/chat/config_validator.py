from core.app.validators.dataset_retrieval import DatasetValidator
from core.app.validators.external_data_fetch import ExternalDataFetchValidator
from core.app.validators.file_upload import FileUploadValidator
from core.app.validators.model_validator import ModelValidator
from core.app.validators.moderation import ModerationValidator
from core.app.validators.opening_statement import OpeningStatementValidator
from core.app.validators.prompt import PromptValidator
from core.app.validators.retriever_resource import RetrieverResourceValidator
from core.app.validators.speech_to_text import SpeechToTextValidator
from core.app.validators.suggested_questions import SuggestedQuestionsValidator
from core.app.validators.text_to_speech import TextToSpeechValidator
from core.app.validators.user_input_form import UserInputFormValidator
from models.model import AppMode


class ChatAppConfigValidator:
    @classmethod
    def config_validate(cls, tenant_id: str, config: dict) -> dict:
        """
        Validate for chat app model config

        :param tenant_id: tenant id
        :param config: app model config args
        """
        app_mode = AppMode.CHAT

        related_config_keys = []

        # model
        config, current_related_config_keys = ModelValidator.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # user_input_form
        config, current_related_config_keys = UserInputFormValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # external data tools validation
        config, current_related_config_keys = ExternalDataFetchValidator.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        # file upload validation
        config, current_related_config_keys = FileUploadValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # prompt
        config, current_related_config_keys = PromptValidator.validate_and_set_defaults(app_mode, config)
        related_config_keys.extend(current_related_config_keys)

        # dataset_query_variable
        config, current_related_config_keys = DatasetValidator.validate_and_set_defaults(tenant_id, app_mode, config)
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

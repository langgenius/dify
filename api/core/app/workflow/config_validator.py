from core.app.validators.file_upload import FileUploadValidator
from core.app.validators.moderation import ModerationValidator
from core.app.validators.text_to_speech import TextToSpeechValidator


class WorkflowAppConfigValidator:
    @classmethod
    def config_validate(cls, tenant_id: str, config: dict) -> dict:
        """
        Validate for workflow app model config

        :param tenant_id: tenant id
        :param config: app model config args
        """
        related_config_keys = []

        # file upload validation
        config, current_related_config_keys = FileUploadValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # text_to_speech
        config, current_related_config_keys = TextToSpeechValidator.validate_and_set_defaults(config)
        related_config_keys.extend(current_related_config_keys)

        # moderation validation
        config, current_related_config_keys = ModerationValidator.validate_and_set_defaults(tenant_id, config)
        related_config_keys.extend(current_related_config_keys)

        related_config_keys = list(set(related_config_keys))

        # Filter out extra parameters
        filtered_config = {key: config.get(key) for key in related_config_keys}

        return filtered_config

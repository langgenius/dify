from typing import IO, Optional

from core.model_runtime.model_providers.openai_api_compatible.speech2text.speech2text import OAICompatSpeech2TextModel


class GPUStackSpeech2TextModel(OAICompatSpeech2TextModel):
    """
    Model class for GPUStack Speech to text model.
    """

    def _invoke(self, model: str, credentials: dict, file: IO[bytes], user: Optional[str] = None) -> str:
        """
        Invoke speech2text model
        :param model: model name
        :param credentials: model credentials
        :param file: audio file
        :param user: unique user id
        :return: text for given audio file
        """
        compatible_credentials = self._get_compatible_credentials(credentials)
        return super()._invoke(model, compatible_credentials, file)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        """
        compatible_credentials = self._get_compatible_credentials(credentials)
        super().validate_credentials(model, compatible_credentials)

    def _get_compatible_credentials(self, credentials: dict) -> dict:
        """
        Get compatible credentials

        :param credentials: model credentials
        :return: compatible credentials
        """
        compatible_credentials = credentials.copy()
        base_url = credentials["endpoint_url"].rstrip("/").removesuffix("/v1-openai")
        compatible_credentials["endpoint_url"] = f"{base_url}/v1-openai"
        return compatible_credentials

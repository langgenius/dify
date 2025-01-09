from typing import Any, Optional

from core.model_runtime.model_providers.openai_api_compatible.tts.tts import OAICompatText2SpeechModel


class GPUStackText2SpeechModel(OAICompatText2SpeechModel):
    """
    Model class for GPUStack Text to Speech model.
    """

    def _invoke(
        self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, user: Optional[str] = None
    ) -> Any:
        """
        Invoke text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :param user: unique user id
        :return: text translated to audio file
        """
        compatible_credentials = self._get_compatible_credentials(credentials)
        return super()._invoke(
            model=model,
            tenant_id=tenant_id,
            credentials=compatible_credentials,
            content_text=content_text,
            voice=voice,
            user=user,
        )

    def validate_credentials(self, model: str, credentials: dict, user: Optional[str] = None) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :param user: unique user id
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

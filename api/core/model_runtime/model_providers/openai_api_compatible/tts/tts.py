from collections.abc import Iterable
from typing import Optional
from urllib.parse import urljoin

import requests

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.openai_api_compatible._common import _CommonOaiApiCompat


class OAICompatText2SpeechModel(_CommonOaiApiCompat, TTSModel):
    """
    Model class for OpenAI-compatible text2speech model.
    """

    def _invoke(
        self,
        model: str,
        tenant_id: str,
        credentials: dict,
        content_text: str,
        voice: str,
        user: Optional[str] = None,
    ) -> Iterable[bytes]:
        """
        Invoke TTS model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model voice/speaker
        :param user: unique user id
        :return: audio data as bytes iterator
        """
        # Set up headers with authentication if provided
        headers = {}
        if api_key := credentials.get("api_key"):
            headers["Authorization"] = f"Bearer {api_key}"

        # Construct endpoint URL
        endpoint_url = credentials.get("endpoint_url")
        if not endpoint_url.endswith("/"):
            endpoint_url += "/"
        endpoint_url = urljoin(endpoint_url, "audio/speech")

        # Get audio format from model properties
        audio_format = self._get_model_audio_type(model, credentials)

        # Split text into chunks if needed based on word limit
        word_limit = self._get_model_word_limit(model, credentials)
        sentences = self._split_text_into_sentences(content_text, word_limit)

        for sentence in sentences:
            # Prepare request payload
            payload = {"model": model, "input": sentence, "voice": voice, "response_format": audio_format}

            # Make POST request
            response = requests.post(endpoint_url, headers=headers, json=payload, stream=True)

            if response.status_code != 200:
                raise InvokeBadRequestError(response.text)

            # Stream the audio data
            for chunk in response.iter_content(chunk_size=4096):
                if chunk:
                    yield chunk

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # Get default voice for validation
            voice = self._get_model_default_voice(model, credentials)

            # Test with a simple text
            next(
                self._invoke(
                    model=model, tenant_id="validate", credentials=credentials, content_text="Test.", voice=voice
                )
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        Get customizable model schema
        """
        # Parse voices from comma-separated string
        voice_names = credentials.get("voices", "alloy").strip().split(",")
        voices = []

        for voice in voice_names:
            voice = voice.strip()
            if not voice:
                continue

            # Use en-US for all voices
            voices.append(
                {
                    "name": voice,
                    "mode": voice,
                    "language": "en-US",
                }
            )

        # If no voices provided or all voices were empty strings, use 'alloy' as default
        if not voices:
            voices = [{"name": "Alloy", "mode": "alloy", "language": "en-US"}]

        return AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TTS,
            model_properties={
                ModelPropertyKey.AUDIO_TYPE: credentials.get("audio_type", "mp3"),
                ModelPropertyKey.WORD_LIMIT: int(credentials.get("word_limit", 4096)),
                ModelPropertyKey.DEFAULT_VOICE: voices[0]["mode"],
                ModelPropertyKey.VOICES: voices,
            },
        )

    def get_tts_model_voices(self, model: str, credentials: dict, language: Optional[str] = None) -> list:
        """
        Override base get_tts_model_voices to handle customizable voices
        """
        model_schema = self.get_customizable_model_schema(model, credentials)

        if not model_schema or ModelPropertyKey.VOICES not in model_schema.model_properties:
            raise ValueError("this model does not support voice")

        voices = model_schema.model_properties[ModelPropertyKey.VOICES]

        # Always return all voices regardless of language
        return [{"name": d["name"], "value": d["mode"]} for d in voices]

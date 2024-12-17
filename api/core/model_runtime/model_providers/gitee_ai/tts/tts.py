from typing import Optional

import requests

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.model_providers.gitee_ai._common import _CommonGiteeAI


class GiteeAIText2SpeechModel(_CommonGiteeAI, TTSModel):
    """
    Model class for OpenAI text2speech model.
    """

    def _invoke(
        self, model: str, tenant_id: str, credentials: dict, content_text: str, voice: str, user: Optional[str] = None
    ) -> any:
        """
        _invoke text2speech model

        :param model: model name
        :param tenant_id: user tenant id
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :param user: unique user id
        :return: text translated to audio file
        """
        return self._tts_invoke_streaming(model=model, credentials=credentials, content_text=content_text, voice=voice)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        validate credentials text2speech model

        :param model: model name
        :param credentials: model credentials
        :return: text translated to audio file
        """
        try:
            self._tts_invoke_streaming(
                model=model,
                credentials=credentials,
                content_text="Hello Dify!",
                voice=self._get_model_default_voice(model, credentials),
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _tts_invoke_streaming(self, model: str, credentials: dict, content_text: str, voice: str) -> any:
        """
        _tts_invoke_streaming text2speech model
        :param model: model name
        :param credentials: model credentials
        :param content_text: text content to be translated
        :param voice: model timbre
        :return: text translated to audio file
        """
        try:
            # doc: https://ai.gitee.com/docs/openapi/serverless#tag/serverless/POST/{service}/text-to-speech
            endpoint_url = "https://ai.gitee.com/api/serverless/" + model + "/text-to-speech"

            headers = {"Content-Type": "application/json"}
            api_key = credentials.get("api_key")
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"

            payload = {"inputs": content_text}
            response = requests.post(endpoint_url, headers=headers, json=payload)

            if response.status_code != 200:
                raise InvokeBadRequestError(response.text)

            data = response.content

            for i in range(0, len(data), 1024):
                yield data[i : i + 1024]
        except Exception as ex:
            raise InvokeBadRequestError(str(ex))

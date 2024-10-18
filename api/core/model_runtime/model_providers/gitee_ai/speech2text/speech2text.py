import os
from typing import IO, Optional

import requests

from core.model_runtime.errors.invoke import InvokeBadRequestError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.gitee_ai._common import _CommonGiteeAI


class GiteeAISpeech2TextModel(_CommonGiteeAI, Speech2TextModel):
    """
    Model class for OpenAI Compatible Speech to text model.
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
        # doc: https://ai.gitee.com/docs/openapi/serverless#tag/serverless/POST/{service}/speech-to-text

        endpoint_url = f"https://ai.gitee.com/api/serverless/{model}/speech-to-text"
        files = [("file", file)]
        _, file_ext = os.path.splitext(file.name)
        headers = {"Content-Type": f"audio/{file_ext}", "Authorization": f"Bearer {credentials.get('api_key')}"}
        response = requests.post(endpoint_url, headers=headers, files=files)
        if response.status_code != 200:
            raise InvokeBadRequestError(response.text)
        response_data = response.json()
        return response_data["text"]

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            audio_file_path = self._get_demo_file_path()

            with open(audio_file_path, "rb") as audio_file:
                self._invoke(model, credentials, audio_file)
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

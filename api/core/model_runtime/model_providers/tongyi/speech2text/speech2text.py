import shutil
import tempfile
from typing import IO, Optional

import dashscope  # type: ignore
from dashscope import MultiModalConversation  # type: ignore

from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.tongyi._common import _CommonTongyi


class TongYiSpeech2TextModel(_CommonTongyi, Speech2TextModel):
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
        # initialize client
        dashscope.api_key = credentials["dashscope_api_key"]

        # 创建临时文件
        with tempfile.NamedTemporaryFile(delete=True, dir="/tmp") as temp_file:
            # 将上传的文件写入临时文件
            shutil.copyfileobj(file, temp_file)
            temp_file.flush()  # 确保数据写入磁盘

            messages = [
                {
                    "role": "user",
                    "content": [{"audio": temp_file.name}],
                }
            ]
            try:
                response_data = MultiModalConversation.call(model=model, messages=messages)
                text = "".join(
                    content["text"]
                    for choice in response_data["output"]["choices"]
                    for content in choice["message"]["content"]
                )
                return text
            except Exception as ex:
                raise InvokeError(str(ex))

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

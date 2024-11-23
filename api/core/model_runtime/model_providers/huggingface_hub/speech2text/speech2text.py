from typing import Optional, Union, IO
from pathlib import Path
import io

from huggingface_hub import InferenceClient
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.huggingface_hub._common import _CommonHuggingfaceHub
from core.model_runtime.errors.invoke import InvokeBadRequestError

class HuggingfaceHubSpeech2TextModel(_CommonHuggingfaceHub, Speech2TextModel):
    def _invoke(self, model: str, credentials: dict, file: IO[bytes], user: Optional[str] = None) -> str:
        """
        Invoke Speech2Text model

        :param model: model name
        :param credentials: model credentials
        :param file: audio file
        :param user: unique user id (not used in this implementation)
        :return: transcribed text
        """
        client = InferenceClient(token=credentials["huggingfacehub_api_token"])

        execute_model = model

        if credentials["huggingfacehub_api_type"] == "inference_endpoints":
            execute_model = credentials["huggingfacehub_endpoint_url"]

        try:
            # Read the audio content from the file object
            audio_content = file.read()

            # Call the API using the InferenceClient
            result = client.automatic_speech_recognition(audio=audio_content, model=execute_model)
            
            if isinstance(result, dict) and "text" in result:
                return result["text"]
            elif isinstance(result, str):
                return result
            elif hasattr(result, 'text'):
                return result.text
            else:
                raise InvokeBadRequestError(f"Unexpected result format: {type(result)}")

        except Exception as e:
            raise InvokeBadRequestError(f"Error in speech recognition: {str(e)}")

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

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        used to define customizable model schema
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.SPEECH2TEXT,
            model_properties={},
            parameter_rules=[],
        )
        return entity

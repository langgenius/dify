import json
import logging
from typing import IO, Any, Optional

import boto3

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.sagemaker.sagemaker import generate_presigned_url

logger = logging.getLogger(__name__)


class SageMakerSpeech2TextModel(Speech2TextModel):
    """
    Model class for Xinference speech to text model.
    """

    sagemaker_client: Any = None
    s3_client: Any = None

    def _invoke(self, model: str, credentials: dict, file: IO[bytes], user: Optional[str] = None) -> str:
        """
        Invoke speech2text model

        :param model: model name
        :param credentials: model credentials
        :param file: audio file
        :param user: unique user id
        :return: text for given audio file
        """
        asr_text = None

        try:
            if not self.sagemaker_client:
                access_key = credentials.get("aws_access_key_id")
                secret_key = credentials.get("aws_secret_access_key")
                aws_region = credentials.get("aws_region")
                if aws_region:
                    if access_key and secret_key:
                        self.sagemaker_client = boto3.client(
                            "sagemaker-runtime",
                            aws_access_key_id=access_key,
                            aws_secret_access_key=secret_key,
                            region_name=aws_region,
                        )
                        self.s3_client = boto3.client(
                            "s3", aws_access_key_id=access_key, aws_secret_access_key=secret_key, region_name=aws_region
                        )
                    else:
                        self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                        self.s3_client = boto3.client("s3", region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime")
                    self.s3_client = boto3.client("s3")

            s3_prefix = "dify/speech2text/"
            sagemaker_endpoint = credentials.get("sagemaker_endpoint")
            bucket = credentials.get("audio_s3_cache_bucket")

            s3_presign_url = generate_presigned_url(self.s3_client, file, bucket, s3_prefix)
            payload = {"audio_s3_presign_uri": s3_presign_url}

            response_model = self.sagemaker_client.invoke_endpoint(
                EndpointName=sagemaker_endpoint, Body=json.dumps(payload), ContentType="application/json"
            )
            json_str = response_model["Body"].read().decode("utf8")
            json_obj = json.loads(json_str)
            asr_text = json_obj["text"]
        except Exception as e:
            logger.exception(f"Exception {e}, line : {line}")

        return asr_text

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        pass

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError, KeyError, ValueError],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
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

import itertools
import json
import logging
import time
from typing import Any, Optional

import boto3

from core.embedding.embedding_constant import EmbeddingInputType
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType, PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel

BATCH_SIZE = 20
CONTEXT_SIZE = 8192

logger = logging.getLogger(__name__)


def batch_generator(generator, batch_size):
    while True:
        batch = list(itertools.islice(generator, batch_size))
        if not batch:
            break
        yield batch


class SageMakerEmbeddingModel(TextEmbeddingModel):
    """
    Model class for Cohere text embedding model.
    """

    sagemaker_client: Any = None

    def _sagemaker_embedding(self, sm_client, endpoint_name, content_list: list[str]):
        response_model = sm_client.invoke_endpoint(
            EndpointName=endpoint_name,
            Body=json.dumps({"inputs": content_list, "parameters": {}, "is_query": False, "instruction": ""}),
            ContentType="application/json",
        )
        json_str = response_model["Body"].read().decode("utf8")
        json_obj = json.loads(json_str)
        embeddings = json_obj["embeddings"]
        return embeddings

    def _invoke(
        self,
        model: str,
        credentials: dict,
        texts: list[str],
        user: Optional[str] = None,
        input_type: EmbeddingInputType = EmbeddingInputType.DOCUMENT,
    ) -> TextEmbeddingResult:
        """
        Invoke text embedding model

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param user: unique user id
        :param input_type: input type
        :return: embeddings result
        """
        # get model properties
        try:
            line = 1
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
                    else:
                        self.sagemaker_client = boto3.client("sagemaker-runtime", region_name=aws_region)
                else:
                    self.sagemaker_client = boto3.client("sagemaker-runtime")

            line = 2
            sagemaker_endpoint = credentials.get("sagemaker_endpoint")

            line = 3
            truncated_texts = [item[:CONTEXT_SIZE] for item in texts]

            batches = batch_generator((text for text in truncated_texts), batch_size=BATCH_SIZE)
            all_embeddings = []

            line = 4
            for batch in batches:
                embeddings = self._sagemaker_embedding(self.sagemaker_client, sagemaker_endpoint, batch)
                all_embeddings.extend(embeddings)

            line = 5
            # calc usage
            usage = self._calc_response_usage(
                model=model,
                credentials=credentials,
                tokens=0,  # It's not SAAS API, usage is meaningless
            )
            line = 6

            return TextEmbeddingResult(embeddings=all_embeddings, usage=usage, model=model)

        except Exception as e:
            logger.exception(f"Exception {e}, line : {line}")

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        return 0

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            print("validate_credentials ok....")
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int) -> EmbeddingUsage:
        """
        Calculate response usage

        :param model: model name
        :param credentials: model credentials
        :param tokens: input tokens
        :return: usage
        """
        # get input price info
        input_price_info = self.get_price(
            model=model, credentials=credentials, price_type=PriceType.INPUT, tokens=tokens
        )

        # transform usage
        usage = EmbeddingUsage(
            tokens=tokens,
            total_tokens=tokens,
            unit_price=input_price_info.unit_price,
            price_unit=input_price_info.unit,
            total_price=input_price_info.total_amount,
            currency=input_price_info.currency,
            latency=time.perf_counter() - self.started_at,
        )

        return usage

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [KeyError],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity | None:
        """
        used to define customizable model schema
        """

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TEXT_EMBEDDING,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: CONTEXT_SIZE,
                ModelPropertyKey.MAX_CHUNKS: BATCH_SIZE,
            },
            parameter_rules=[],
        )

        return entity

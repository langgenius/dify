import json
import logging
import time
from decimal import Decimal
from typing import Optional
from urllib.parse import urljoin
from dify_plugin import TextEmbeddingModel
import numpy as np
import requests
from dify_plugin.entities.model import (
    AIModelEntity,
    EmbeddingInputType,
    FetchFrom,
    I18nObject,
    ModelPropertyKey,
    ModelType,
    PriceConfig,
    PriceType,
)
from dify_plugin.entities.model.text_embedding import (
    EmbeddingUsage,
    TextEmbeddingResult,
)
from dify_plugin.errors.model import (
    CredentialsValidateFailedError,
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)

logger = logging.getLogger(__name__)


class OllamaEmbeddingModel(TextEmbeddingModel):
    """
    Model class for an Ollama text embedding model.
    """

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
        headers = {"Content-Type": "application/json"}
        endpoint_url = credentials.get("base_url", "")
        if endpoint_url and not endpoint_url.endswith("/"):
            endpoint_url += "/"
        endpoint_url = urljoin(endpoint_url, "api/embed")
        context_size = self._get_context_size(model, credentials)
        inputs = []
        used_tokens = 0
        for text in texts:
            num_tokens = self._get_num_tokens_by_gpt2(text)
            if num_tokens >= context_size:
                cutoff = int(np.floor(len(text) * (context_size / num_tokens)))
                inputs.append(text[0:cutoff])
            else:
                inputs.append(text)
        payload = {"input": inputs, "model": model, "options": {"use_mmap": True}}
        response = requests.post(
            endpoint_url, headers=headers, data=json.dumps(payload), timeout=(10, 300)
        )
        response.raise_for_status()
        response_data = response.json()
        embeddings = response_data["embeddings"]
        embedding_used_tokens = self.get_num_tokens(model, credentials, inputs)
        used_tokens += sum(embedding_used_tokens)
        usage = self._calc_response_usage(
            model=model, credentials=credentials, tokens=used_tokens
        )
        return TextEmbeddingResult(embeddings=embeddings, usage=usage, model=model)

    def get_num_tokens(
        self, model: str, credentials: dict, texts: list[str]
    ) -> list[int]:
        """
        Approximate number of tokens for given messages using GPT2 tokenizer

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        return [self._get_num_tokens_by_gpt2(text) for text in texts]

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._invoke(model=model, credentials=credentials, texts=["ping"])
        except InvokeError as ex:
            raise CredentialsValidateFailedError(
                f"An error occurred during credentials validation: {ex.description}"
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(
                f"An error occurred during credentials validation: {str(ex)}"
            )

    def get_customizable_model_schema(
        self, model: str, credentials: dict
    ) -> AIModelEntity:
        """
        generate custom model entities from credentials
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            model_type=ModelType.TEXT_EMBEDDING,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: int(
                    credentials.get("context_size", 512)
                ),
                ModelPropertyKey.MAX_CHUNKS: 1,
            },
            parameter_rules=[],
            pricing=PriceConfig(
                input=Decimal(credentials.get("input_price", 0)),
                unit=Decimal(credentials.get("unit", 0)),
                currency=credentials.get("currency", "USD"),
            ),
        )
        return entity

    def _calc_response_usage(
        self, model: str, credentials: dict, tokens: int
    ) -> EmbeddingUsage:
        """
        Calculate response usage

        :param model: model name
        :param credentials: model credentials
        :param tokens: input tokens
        :return: usage
        """
        input_price_info = self.get_price(
            model=model,
            credentials=credentials,
            price_type=PriceType.INPUT,
            tokens=tokens,
        )
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
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeAuthorizationError: [requests.exceptions.InvalidHeader],
            InvokeBadRequestError: [
                requests.exceptions.HTTPError,
                requests.exceptions.InvalidURL,
            ],
            InvokeRateLimitError: [requests.exceptions.RetryError],
            InvokeServerUnavailableError: [
                requests.exceptions.ConnectionError,
                requests.exceptions.HTTPError,
            ],
            InvokeConnectionError: [
                requests.exceptions.ConnectTimeout,
                requests.exceptions.ReadTimeout,
            ],
        }

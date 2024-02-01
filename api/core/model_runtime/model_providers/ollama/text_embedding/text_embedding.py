import json
import logging
import time
from decimal import Decimal
from typing import Optional
from urllib.parse import urljoin

import numpy as np
import requests
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import (AIModelEntity, FetchFrom, ModelPropertyKey, ModelType,
                                                        PriceConfig, PriceType)
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import (InvokeAuthorizationError, InvokeBadRequestError, InvokeConnectionError,
                                              InvokeError, InvokeRateLimitError, InvokeServerUnavailableError)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel

logger = logging.getLogger(__name__)


class OllamaEmbeddingModel(TextEmbeddingModel):
    """
    Model class for an Ollama text embedding model.
    """

    def _invoke(self, model: str, credentials: dict,
                texts: list[str], user: Optional[str] = None) \
            -> TextEmbeddingResult:
        """
        Invoke text embedding model

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param user: unique user id
        :return: embeddings result
        """

        # Prepare headers and payload for the request
        headers = {
            'Content-Type': 'application/json'
        }

        endpoint_url = credentials.get('base_url')
        if not endpoint_url.endswith('/'):
            endpoint_url += '/'

        endpoint_url = urljoin(endpoint_url, 'api/embeddings')

        # get model properties
        context_size = self._get_context_size(model, credentials)

        inputs = []
        used_tokens = 0

        for i, text in enumerate(texts):
            # Here token count is only an approximation based on the GPT2 tokenizer
            num_tokens = self._get_num_tokens_by_gpt2(text)

            if num_tokens >= context_size:
                cutoff = int(len(text) * (np.floor(context_size / num_tokens)))
                # if num tokens is larger than context length, only use the start
                inputs.append(text[0: cutoff])
            else:
                inputs.append(text)

        batched_embeddings = []

        for text in inputs:
            # Prepare the payload for the request
            payload = {
                'prompt': text,
                'model': model,
            }

            # Make the request to the OpenAI API
            response = requests.post(
                endpoint_url,
                headers=headers,
                data=json.dumps(payload),
                timeout=(10, 300)
            )

            response.raise_for_status()  # Raise an exception for HTTP errors
            response_data = response.json()

            # Extract embeddings and used tokens from the response
            embeddings = response_data['embedding']
            embedding_used_tokens = self.get_num_tokens(model, credentials, [text])

            used_tokens += embedding_used_tokens
            batched_embeddings.append(embeddings)

        # calc usage
        usage = self._calc_response_usage(
            model=model,
            credentials=credentials,
            tokens=used_tokens
        )

        return TextEmbeddingResult(
            embeddings=batched_embeddings,
            usage=usage,
            model=model
        )

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Approximate number of tokens for given messages using GPT2 tokenizer

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        return sum(self._get_num_tokens_by_gpt2(text) for text in texts)

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._invoke(
                model=model,
                credentials=credentials,
                texts=['ping']
            )
        except InvokeError as ex:
            raise CredentialsValidateFailedError(f'An error occurred during credentials validation: {ex.description}')
        except Exception as ex:
            raise CredentialsValidateFailedError(f'An error occurred during credentials validation: {str(ex)}')

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
            generate custom model entities from credentials
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            model_type=ModelType.TEXT_EMBEDDING,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: int(credentials.get('context_size')),
                ModelPropertyKey.MAX_CHUNKS: 1,
            },
            parameter_rules=[],
            pricing=PriceConfig(
                input=Decimal(credentials.get('input_price', 0)),
                unit=Decimal(credentials.get('unit', 0)),
                currency=credentials.get('currency', "USD")
            )
        )

        return entity

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
            model=model,
            credentials=credentials,
            price_type=PriceType.INPUT,
            tokens=tokens
        )

        # transform usage
        usage = EmbeddingUsage(
            tokens=tokens,
            total_tokens=tokens,
            unit_price=input_price_info.unit_price,
            price_unit=input_price_info.unit,
            total_price=input_price_info.total_amount,
            currency=input_price_info.currency,
            latency=time.perf_counter() - self.started_at
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
            InvokeAuthorizationError: [
                requests.exceptions.InvalidHeader,  # Missing or Invalid API Key
            ],
            InvokeBadRequestError: [
                requests.exceptions.HTTPError,  # Invalid Endpoint URL or model name
                requests.exceptions.InvalidURL,  # Misconfigured request or other API error
            ],
            InvokeRateLimitError: [
                requests.exceptions.RetryError  # Too many requests sent in a short period of time
            ],
            InvokeServerUnavailableError: [
                requests.exceptions.ConnectionError,  # Engine Overloaded
                requests.exceptions.HTTPError  # Server Error
            ],
            InvokeConnectionError: [
                requests.exceptions.ConnectTimeout,  # Timeout
                requests.exceptions.ReadTimeout  # Timeout
            ]
        }

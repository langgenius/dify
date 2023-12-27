import time
from typing import Optional
import requests
import json

import numpy as np

from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult, EmbeddingUsage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.openai_api_compatible._common import _CommonOAI_API_Compat

class OAICompatEmbeddingModel(_CommonOAI_API_Compat, TextEmbeddingModel):
    """
    Model class for an OpenAI API-compatible text embedding model.
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
            'Authorization': f'Bearer {credentials["api_key"]}',
            'Content-Type': 'application/json'
        }

        endpoint_url = credentials['endpoint_url']

        extra_model_kwargs = {}
        if user:
            extra_model_kwargs['user'] = user

        extra_model_kwargs['encoding_format'] = 'float'

        # get model properties
        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)

        embeddings: list[list[float]] = [[] for _ in range(len(texts))]
        inputs = []
        indices = []
        used_tokens = 0

        for i, text in enumerate(texts):

            # Here token count is only an approximation based on the GPT2 tokenizer
            # TODO: Optimize for better token estimation and chunking
            num_tokens = self._get_num_tokens_by_gpt2(text)

            if num_tokens >= context_size:
                cutoff = int(len(text) * (np.floor(context_size / num_tokens)))
                # if num tokens is larger than context length, only use the start
                inputs.append(text[0: cutoff])
            else:
                inputs.append(text)
            indices += [i]

        batched_embeddings = []
        _iter = range(0, len(inputs), max_chunks)

        for i in _iter:
            # Prepare the payload for the request
            payload = {
                'input': inputs[i: i + max_chunks],
                'model': model,
                **extra_model_kwargs
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
            embeddings_batch = [data['embedding'] for data in response_data['data']]
            embedding_used_tokens = response_data['usage']['total_tokens']

            used_tokens += embedding_used_tokens
            batched_embeddings += embeddings_batch

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

    def get_num_tokens(self, model: str, texts: list[str]) -> int:
        """
        Approximate number of tokens for given messages using GPT2 tokenizer

        :param model: model name
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
            headers = {
                'Authorization': f'Bearer {credentials["api_key"]}',
                'Content-Type': 'application/json'
            }

            endpoint_url = credentials['endpoint_url']

            payload = {
                'input': 'ping',
                'model': model
            }

            response = requests.post(
                url=endpoint_url,
                headers=headers,
                data=json.dumps(payload),
                timeout=(10, 300)
            )

            if response.status_code != 200:
                raise CredentialsValidateFailedError(f"Invalid response status: {response.status_code}")

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
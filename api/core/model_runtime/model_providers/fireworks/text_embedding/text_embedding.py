import time
from collections.abc import Mapping
from typing import Optional, Union

import numpy as np
from openai import OpenAI

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.fireworks._common import _CommonFireworks


class FireworksTextEmbeddingModel(_CommonFireworks, TextEmbeddingModel):
    """
    Model class for Fireworks text embedding model.
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

        credentials_kwargs = self._to_credential_kwargs(credentials)
        client = OpenAI(**credentials_kwargs)

        extra_model_kwargs = {}
        if user:
            extra_model_kwargs["user"] = user

        extra_model_kwargs["encoding_format"] = "float"

        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)

        inputs = []
        indices = []
        used_tokens = 0

        for i, text in enumerate(texts):
            # Here token count is only an approximation based on the GPT2 tokenizer
            # TODO: Optimize for better token estimation and chunking
            num_tokens = self._get_num_tokens_by_gpt2(text)

            if num_tokens >= context_size:
                cutoff = int(np.floor(len(text) * (context_size / num_tokens)))
                # if num tokens is larger than context length, only use the start
                inputs.append(text[0:cutoff])
            else:
                inputs.append(text)
            indices += [i]

        batched_embeddings = []
        _iter = range(0, len(inputs), max_chunks)

        for i in _iter:
            embeddings_batch, embedding_used_tokens = self._embedding_invoke(
                model=model,
                client=client,
                texts=inputs[i : i + max_chunks],
                extra_model_kwargs=extra_model_kwargs,
            )
            used_tokens += embedding_used_tokens
            batched_embeddings += embeddings_batch

        usage = self._calc_response_usage(model=model, credentials=credentials, tokens=used_tokens)
        return TextEmbeddingResult(embeddings=batched_embeddings, usage=usage, model=model)

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        return sum(self._get_num_tokens_by_gpt2(text) for text in texts)

    def validate_credentials(self, model: str, credentials: Mapping) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            # transform credentials to kwargs for model instance
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = OpenAI(**credentials_kwargs)

            # call embedding model
            self._embedding_invoke(model=model, client=client, texts=["ping"], extra_model_kwargs={})
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _embedding_invoke(
        self, model: str, client: OpenAI, texts: Union[list[str], str], extra_model_kwargs: dict
    ) -> tuple[list[list[float]], int]:
        """
        Invoke embedding model
        :param model: model name
        :param client: model client
        :param texts: texts to embed
        :param extra_model_kwargs: extra model kwargs
        :return: embeddings and used tokens
        """
        response = client.embeddings.create(model=model, input=texts, **extra_model_kwargs)
        return [data.embedding for data in response.data], response.usage.total_tokens

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int) -> EmbeddingUsage:
        """
        Calculate response usage

        :param model: model name
        :param credentials: model credentials
        :param tokens: input tokens
        :return: usage
        """
        input_price_info = self.get_price(
            model=model, credentials=credentials, tokens=tokens, price_type=PriceType.INPUT
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

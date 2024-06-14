import base64
import time
from typing import Optional, Union

import numpy as np
# import tiktoken
from openai import OpenAI

from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.magico._common import _CommonOAI_API_Compat


class OpenAITextEmbeddingModel(_CommonOAI_API_Compat, TextEmbeddingModel):
    """
    Model class for OpenAI text embedding model.
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
        # transform credentials to kwargs for model instance
        credentials_kwargs = self._to_credential_kwargs(credentials)
        # init model client
        client = OpenAI(**credentials_kwargs)

        extra_model_kwargs = {}
        if user:
            extra_model_kwargs['user'] = user

        extra_model_kwargs['encoding_format'] = 'base64'

        # get model properties
        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)

        embeddings: list[list[float]] = [[] for _ in range(len(texts))]
        tokens = []
        indices = []
        used_tokens = 0

        for i, text in enumerate(texts):

            # Here token count is only an approximation based on the GPT2 tokenizer
            # TODO: Optimize for better token estimation and chunking
            num_tokens = self._get_num_tokens_by_gpt2(text)

            if num_tokens >= context_size:
                cutoff = int(len(text) * (np.floor(context_size / num_tokens)))
                # if num tokens is larger than context length, only use the start
                tokens.append(text[0: cutoff])
            else:
                tokens.append(text)
            indices += [i]

        batched_embeddings = []
        _iter = range(0, len(tokens), max_chunks)

        for i in _iter:
            # call embedding model
            embeddings_batch, embedding_used_tokens = self._embedding_invoke(
                model=model,
                client=client,
                texts=tokens[i: i + max_chunks],
                extra_model_kwargs=extra_model_kwargs
            )

            used_tokens += embedding_used_tokens
            batched_embeddings += embeddings_batch

        results: list[list[list[float]]] = [[] for _ in range(len(texts))]
        num_tokens_in_batch: list[list[int]] = [[] for _ in range(len(texts))]
        for i in range(len(indices)):
            results[indices[i]].append(batched_embeddings[i])
            num_tokens_in_batch[indices[i]].append(len(tokens[i]))

        for i in range(len(texts)):
            _result = results[i]
            if len(_result) == 0:
                embeddings_batch, embedding_used_tokens = self._embedding_invoke(
                    model=model,
                    client=client,
                    texts="",
                    extra_model_kwargs=extra_model_kwargs
                )

                used_tokens += embedding_used_tokens
                average = embeddings_batch[0]
            else:
                average = np.average(_result, axis=0, weights=num_tokens_in_batch[i])
            embeddings[i] = (average / np.linalg.norm(average)).tolist()

        # calc usage
        usage = self._calc_response_usage(
            model=model,
            credentials=credentials,
            tokens=used_tokens
        )

        return TextEmbeddingResult(
            embeddings=embeddings,
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
            # transform credentials to kwargs for model instance
            credentials_kwargs = self._to_credential_kwargs(credentials)
            client = OpenAI(**credentials_kwargs)

            # call embedding model
            self._embedding_invoke(
                model=model,
                client=client,
                texts=['ping'],
                extra_model_kwargs={}
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _embedding_invoke(self, model: str, client: OpenAI, texts: Union[list[str], str],
                          extra_model_kwargs: dict) -> tuple[list[list[float]], int]:
        """
        Invoke embedding model

        :param model: model name
        :param client: model client
        :param texts: texts to embed
        :param extra_model_kwargs: extra model kwargs
        :return: embeddings and used tokens
        """
        # call embedding model

        try:
            response = client.embeddings.create(
                input=texts,
                model=model,
                **extra_model_kwargs,
            )
        except Exception as e:
            print(e)
            raise e
        

        if (
                'encoding_format' in extra_model_kwargs 
                and extra_model_kwargs['encoding_format'] == 'base64'
                and response.data
                and isinstance(response.data[0].embedding, str)
        ):
            # decode base64 embedding
            return ([list(np.frombuffer(base64.b64decode(data.embedding), dtype="float32")) for data in response.data],
                    response.usage.total_tokens)

        return [data.embedding for data in response.data], response.usage.total_tokens

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

import time
from typing import Optional

import dashscope
import numpy as np

from core.embedding.embedding_constant import EmbeddingInputType
from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import (
    EmbeddingUsage,
    TextEmbeddingResult,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import (
    TextEmbeddingModel,
)
from core.model_runtime.model_providers.tongyi._common import _CommonTongyi


class TongyiTextEmbeddingModel(_CommonTongyi, TextEmbeddingModel):
    """
    Model class for Tongyi text embedding model.
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

        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)
        inputs = []
        indices = []
        used_tokens = 0

        for i, text in enumerate(texts):
            # Here token count is only an approximation based on the GPT2 tokenizer
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
            embeddings_batch, embedding_used_tokens = self.embed_documents(
                credentials_kwargs=credentials_kwargs,
                model=model,
                texts=inputs[i : i + max_chunks],
            )
            used_tokens += embedding_used_tokens
            batched_embeddings += embeddings_batch

        # calc usage
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
        if len(texts) == 0:
            return 0
        total_num_tokens = 0
        for text in texts:
            total_num_tokens += self._get_num_tokens_by_gpt2(text)

        return total_num_tokens

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

            # call embedding model
            self.embed_documents(credentials_kwargs=credentials_kwargs, model=model, texts=["ping"])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @staticmethod
    def embed_documents(credentials_kwargs: dict, model: str, texts: list[str]) -> tuple[list[list[float]], int]:
        """Call out to Tongyi's embedding endpoint.

        Args:
            credentials_kwargs: The credentials to use for the call.
            model: The model to use for embedding.
            texts: The list of texts to embed.

        Returns:
            List of embeddings, one for each text, and tokens usage.
        """
        embeddings = []
        embedding_used_tokens = 0
        for text in texts:
            response = dashscope.TextEmbedding.call(
                api_key=credentials_kwargs["dashscope_api_key"],
                model=model,
                input=text,
                text_type="document",
            )
            if response.output and "embeddings" in response.output and response.output["embeddings"]:
                data = response.output["embeddings"][0]
                if "embedding" in data:
                    embeddings.append(data["embedding"])
                else:
                    raise ValueError("Embedding data is missing in the response.")
            else:
                raise ValueError("Response output is missing or does not contain embeddings.")

            if response.usage and "total_tokens" in response.usage:
                embedding_used_tokens += response.usage["total_tokens"]
            else:
                raise ValueError("Response usage is missing or does not contain total tokens.")

        return [list(map(float, e)) for e in embeddings], embedding_used_tokens

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int) -> EmbeddingUsage:
        """
        Calculate response usage

        :param model: model name
        :param tokens: input tokens
        :return: usage
        """
        # get input price info
        input_price_info = self.get_price(
            model=model,
            credentials=credentials,
            price_type=PriceType.INPUT,
            tokens=tokens,
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

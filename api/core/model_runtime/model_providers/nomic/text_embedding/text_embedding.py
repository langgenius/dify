import time
from functools import wraps
from typing import Optional

from nomic import embed
from nomic import login as nomic_login

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
from core.model_runtime.model_providers.nomic._common import _CommonNomic


def nomic_login_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            if not kwargs.get("credentials"):
                raise ValueError("missing credentials parameters")
            credentials = kwargs.get("credentials")
            if "nomic_api_key" not in credentials:
                raise ValueError("missing nomic_api_key in credentials parameters")
            # nomic login
            nomic_login(credentials["nomic_api_key"])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))
        return func(*args, **kwargs)

    return wrapper


class NomicTextEmbeddingModel(_CommonNomic, TextEmbeddingModel):
    """
    Model class for nomic text embedding model.
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
        embeddings, prompt_tokens, total_tokens = self.embed_text(
            model=model,
            credentials=credentials,
            texts=texts,
        )

        # calc usage
        usage = self._calc_response_usage(
            model=model, credentials=credentials, tokens=prompt_tokens, total_tokens=total_tokens
        )
        return TextEmbeddingResult(embeddings=embeddings, usage=usage, model=model)

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

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
            # call embedding model
            self.embed_text(model=model, credentials=credentials, texts=["ping"])
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @nomic_login_required
    def embed_text(self, model: str, credentials: dict, texts: list[str]) -> tuple[list[list[float]], int, int]:
        """Call out to Nomic's embedding endpoint.

        Args:
            model: The model to use for embedding.
            texts: The list of texts to embed.

        Returns:
            List of embeddings, one for each text, and tokens usage.
        """
        embeddings: list[list[float]] = []
        prompt_tokens = 0
        total_tokens = 0

        response = embed.text(
            model=model,
            texts=texts,
        )

        if not (response and "embeddings" in response):
            raise ValueError("Embedding data is missing in the response.")

        if not (response and "usage" in response):
            raise ValueError("Response usage is missing.")

        if "prompt_tokens" not in response["usage"]:
            raise ValueError("Response usage does not contain prompt tokens.")

        if "total_tokens" not in response["usage"]:
            raise ValueError("Response usage does not contain total tokens.")

        embeddings = [list(map(float, e)) for e in response["embeddings"]]
        total_tokens = response["usage"]["total_tokens"]
        prompt_tokens = response["usage"]["prompt_tokens"]
        return embeddings, prompt_tokens, total_tokens

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int, total_tokens: int) -> EmbeddingUsage:
        """
        Calculate response usage

        :param model: model name
        :param credentials: model credentials
        :param tokens: prompt tokens
        :param total_tokens: total tokens
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
            total_tokens=total_tokens,
            unit_price=input_price_info.unit_price,
            price_unit=input_price_info.unit,
            total_price=input_price_info.total_amount,
            currency=input_price_info.currency,
            latency=time.perf_counter() - self.started_at,
        )

        return usage

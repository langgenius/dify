import time
from abc import abstractmethod
from collections.abc import Mapping
from json import dumps
from typing import Any, Optional

import numpy as np
from requests import Response, post

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.wenxin._common import BaiduAccessToken, _CommonWenxin
from core.model_runtime.model_providers.wenxin.wenxin_errors import (
    BadRequestError,
    InternalServerError,
    invoke_error_mapping,
)


class TextEmbedding:
    @abstractmethod
    def embed_documents(self, model: str, texts: list[str], user: str) -> (list[list[float]], int, int):
        raise NotImplementedError


class WenxinTextEmbedding(_CommonWenxin, TextEmbedding):
    def embed_documents(self, model: str, texts: list[str], user: str) -> (list[list[float]], int, int):
        access_token = self._get_access_token()
        url = f"{self.api_bases[model]}?access_token={access_token}"
        body = self._build_embed_request_body(model, texts, user)
        headers = {
            "Content-Type": "application/json",
        }

        resp = post(url, data=dumps(body), headers=headers)
        if resp.status_code != 200:
            raise InternalServerError(f"Failed to invoke ernie bot: {resp.text}")
        return self._handle_embed_response(model, resp)

    def _build_embed_request_body(self, model: str, texts: list[str], user: str) -> dict[str, Any]:
        if len(texts) == 0:
            raise BadRequestError("The number of texts should not be zero.")
        body = {
            "input": texts,
            "user_id": user,
        }
        return body

    def _handle_embed_response(self, model: str, response: Response) -> (list[list[float]], int, int):
        data = response.json()
        if "error_code" in data:
            code = data["error_code"]
            msg = data["error_msg"]
            # raise error
            self._handle_error(code, msg)

        embeddings = [v["embedding"] for v in data["data"]]
        _usage = data["usage"]
        tokens = _usage["prompt_tokens"]
        total_tokens = _usage["total_tokens"]

        return embeddings, tokens, total_tokens


class WenxinTextEmbeddingModel(TextEmbeddingModel):
    def _create_text_embedding(self, api_key: str, secret_key: str) -> TextEmbedding:
        return WenxinTextEmbedding(api_key, secret_key)

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

        api_key = credentials["api_key"]
        secret_key = credentials["secret_key"]
        embedding: TextEmbedding = self._create_text_embedding(api_key, secret_key)
        user = user or "ErnieBotDefault"

        context_size = self._get_context_size(model, credentials)
        max_chunks = self._get_max_chunks(model, credentials)
        inputs = []
        indices = []
        used_tokens = 0
        used_total_tokens = 0

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
            embeddings_batch, _used_tokens, _total_used_tokens = embedding.embed_documents(
                model, inputs[i : i + max_chunks], user
            )
            used_tokens += _used_tokens
            used_total_tokens += _total_used_tokens
            batched_embeddings += embeddings_batch

        usage = self._calc_response_usage(model, credentials, used_tokens, used_total_tokens)
        return TextEmbeddingResult(
            model=model,
            embeddings=batched_embeddings,
            usage=usage,
        )

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

    def validate_credentials(self, model: str, credentials: Mapping) -> None:
        api_key = credentials["api_key"]
        secret_key = credentials["secret_key"]
        try:
            BaiduAccessToken.get_access_token(api_key, secret_key)
        except Exception as e:
            raise CredentialsValidateFailedError(f"Credentials validation failed: {e}")

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return invoke_error_mapping()

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int, total_tokens: int) -> EmbeddingUsage:
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
            total_tokens=total_tokens,
            unit_price=input_price_info.unit_price,
            price_unit=input_price_info.unit,
            total_price=input_price_info.total_amount,
            currency=input_price_info.currency,
            latency=time.perf_counter() - self.started_at,
        )

        return usage

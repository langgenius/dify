import json
import logging
import time
from typing import Optional

from tencentcloud.common import credential
from tencentcloud.common.exception import TencentCloudSDKException
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.hunyuan.v20230901 import hunyuan_client, models

from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import (
    InvokeError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel

logger = logging.getLogger(__name__)


class HunyuanTextEmbeddingModel(TextEmbeddingModel):
    """
    Model class for Hunyuan text embedding model.
    """

    def _invoke(
        self, model: str, credentials: dict, texts: list[str], user: Optional[str] = None
    ) -> TextEmbeddingResult:
        """
        Invoke text embedding model

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param user: unique user id
        :return: embeddings result
        """

        if model != "hunyuan-embedding":
            raise ValueError("Invalid model name")

        client = self._setup_hunyuan_client(credentials)

        embeddings = []
        token_usage = 0

        for input in texts:
            request = models.GetEmbeddingRequest()
            params = {"Input": input}
            request.from_json_string(json.dumps(params))
            response = client.GetEmbedding(request)
            usage = response.Usage.TotalTokens

            embeddings.extend([data.Embedding for data in response.Data])
            token_usage += usage

        result = TextEmbeddingResult(
            model=model,
            embeddings=embeddings,
            usage=self._calc_response_usage(model=model, credentials=credentials, tokens=token_usage),
        )

        return result

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate credentials
        """
        try:
            client = self._setup_hunyuan_client(credentials)

            req = models.ChatCompletionsRequest()
            params = {
                "Model": model,
                "Messages": [{"Role": "user", "Content": "hello"}],
                "TopP": 1,
                "Temperature": 0,
                "Stream": False,
            }
            req.from_json_string(json.dumps(params))
            client.ChatCompletions(req)
        except Exception as e:
            raise CredentialsValidateFailedError(f"Credentials validation failed: {e}")

    def _setup_hunyuan_client(self, credentials):
        secret_id = credentials["secret_id"]
        secret_key = credentials["secret_key"]
        cred = credential.Credential(secret_id, secret_key)
        httpProfile = HttpProfile()
        httpProfile.endpoint = "hunyuan.tencentcloudapi.com"
        clientProfile = ClientProfile()
        clientProfile.httpProfile = httpProfile
        client = hunyuan_client.HunyuanClient(cred, "", clientProfile)
        return client

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
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeError: [TencentCloudSDKException],
        }

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        # client = self._setup_hunyuan_client(credentials)

        num_tokens = 0
        for text in texts:
            num_tokens += self._get_num_tokens_by_gpt2(text)
            # use client.GetTokenCount to get num tokens
            # request = models.GetTokenCountRequest()
            # params = {
            #     "Prompt": text
            # }
            # request.from_json_string(json.dumps(params))
            # response = client.GetTokenCount(request)
            # num_tokens += response.TokenCount

        return num_tokens

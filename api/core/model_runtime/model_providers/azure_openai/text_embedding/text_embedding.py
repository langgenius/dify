import logging
from typing import Optional

import openai
import tiktoken
from openai import AzureOpenAI

from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult, EmbeddingUsage
from core.model_runtime.errors.invoke import InvokeConnectionError, InvokeServerUnavailableError, \
    InvokeAuthorizationError, InvokeBadRequestError, InvokeError, InvokeRateLimitError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.azure_openai._constant import EMBEDDING_BASE_MODELS, AZURE_OPENAI_API_VERSION

logger = logging.getLogger(__name__)


class AzureOpenAITextEmbeddingModel(TextEmbeddingModel):
    def _invoke(self, model: str, credentials: dict, texts: list[str],
                user: Optional[str] = None) -> TextEmbeddingResult:

        client = AzureOpenAI(
            api_version=AZURE_OPENAI_API_VERSION,
            azure_endpoint=credentials['openai_api_base'],
            api_key=credentials['openai_api_key'],
        )

        response = client.embeddings.create(
            model=model,
            input=texts
        )

        usage = EmbeddingUsage(
            tokens=0,
            total_tokens=response.usage.total_tokens,
            unit_price=0.0,
            price_unit=0.0,
            total_price=0.0,
            currency='USD',
            latency=0.0
        )

        embeddings = [item.embedding for item in response.data]

        return TextEmbeddingResult(
            embeddings=embeddings,
            usage=usage,
            model=credentials['base_model_name']
        )

    def get_num_tokens(self, model: str, texts: list[str]) -> int:
        if len(texts) == 0:
            return 0

        try:
            enc = tiktoken.encoding_for_model(model)
        except KeyError:
            enc = tiktoken.get_encoding("cl100k_base")

        total_num_tokens = 0
        for text in texts:
            # calculate the number of tokens in the encoded text
            tokenized_text = enc.encode(text)
            total_num_tokens += len(tokenized_text)

        return total_num_tokens

    def validate_credentials(self, model: str, credentials: dict) -> None:
        if 'openai_api_base' not in credentials:
            raise CredentialsValidateFailedError('Azure OpenAI API Base Endpoint is required')

        if 'openai_api_key' not in credentials:
            raise CredentialsValidateFailedError('Azure OpenAI API key is required')

        if 'base_model_name' not in credentials:
            raise CredentialsValidateFailedError('Base Model Name is required')

        if credentials['base_model_name'] not in EMBEDDING_BASE_MODELS:
            raise CredentialsValidateFailedError('Base Model Name is invalid')

        try:
            client = AzureOpenAI(
                api_version=AZURE_OPENAI_API_VERSION,
                azure_endpoint=credentials['openai_api_base'],
                api_key=credentials['openai_api_key'],
            )

            client.embeddings.create(
                model=model,
                input=['ping']
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [
                openai.APIConnectionError,
                openai.APITimeoutError
            ],
            InvokeServerUnavailableError: [
                openai.InternalServerError
            ],
            InvokeRateLimitError: [
                openai.RateLimitError
            ],
            InvokeAuthorizationError: [
                openai.AuthenticationError,
                openai.PermissionDeniedError
            ],
            InvokeBadRequestError: [
                openai.BadRequestError,
                openai.NotFoundError,
                openai.UnprocessableEntityError,
                openai.APIError
            ]
        }

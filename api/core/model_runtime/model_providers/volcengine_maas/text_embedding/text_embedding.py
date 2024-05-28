import time
from decimal import Decimal
from typing import Optional

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelPropertyKey,
    ModelType,
    PriceConfig,
    PriceType,
)
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.volcengine_maas.client import MaaSClient
from core.model_runtime.model_providers.volcengine_maas.errors import (
    AuthErrors,
    BadRequestErrors,
    ConnectionErrors,
    RateLimitErrors,
    ServerUnavailableErrors,
)
from core.model_runtime.model_providers.volcengine_maas.text_embedding.models import ModelConfigs
from core.model_runtime.model_providers.volcengine_maas.volc_sdk import MaasException


class VolcengineMaaSTextEmbeddingModel(TextEmbeddingModel):
    """
    Model class for VolcengineMaaS text embedding model.
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
        client = MaaSClient.from_credential(credentials)
        resp = MaaSClient.wrap_exception(lambda: client.embeddings(texts))

        usage = self._calc_response_usage(
            model=model, credentials=credentials, tokens=resp['usage']['total_tokens'])

        result = TextEmbeddingResult(
            model=model,
            embeddings=[v['embedding'] for v in resp['data']],
            usage=usage
        )

        return result

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        """
        Get number of tokens for given prompt messages

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :return:
        """
        num_tokens = 0
        for text in texts:
            # use GPT2Tokenizer to get num tokens
            num_tokens += self._get_num_tokens_by_gpt2(text)
        return num_tokens

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            self._invoke(model=model, credentials=credentials, texts=['ping'])
        except MaasException as e:
            raise CredentialsValidateFailedError(e.message)

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
            InvokeConnectionError: ConnectionErrors.values(),
            InvokeServerUnavailableError: ServerUnavailableErrors.values(),
            InvokeRateLimitError: RateLimitErrors.values(),
            InvokeAuthorizationError: AuthErrors.values(),
            InvokeBadRequestError: BadRequestErrors.values(),
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
            generate custom model entities from credentials
        """
        model_properties = ModelConfigs.get(
            credentials['base_model_name'], {}).get('model_properties', {}).copy()
        if credentials.get('context_size'):
            model_properties[ModelPropertyKey.CONTEXT_SIZE] = int(
                credentials.get('context_size', 4096))
        if credentials.get('max_chunks'):
            model_properties[ModelPropertyKey.MAX_CHUNKS] = int(
                credentials.get('max_chunks', 4096))
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            model_type=ModelType.TEXT_EMBEDDING,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties=model_properties,
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

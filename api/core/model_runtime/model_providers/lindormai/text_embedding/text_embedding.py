import time
from collections.abc import Mapping
from typing import Optional

from core.entities.embedding_type import EmbeddingInputType
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType, PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.lindormai._common import _check_credentials_fields, _CommonLindormAI


class LindormAITextEmbeddingModel(_CommonLindormAI, TextEmbeddingModel):
    def validate_credentials(self, model: str, credentials: Mapping) -> None:
        try:
            _check_credentials_fields(credentials)
            super()._check_model_status(model, credentials)
            self._invoke(model=model, credentials=dict(credentials), texts=["hello, New York!"])
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

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        return 0

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

        credentials should be like:
        {
            'server_url': 'server url',
            'model_uid': 'model uid',
        }

        :param model: model name
        :param credentials: model credentials
        :param texts: texts to embed
        :param user: unique user id
        :param input_type: input type
        :return: embeddings result
        """
        batch_embeddings = super()._infer_model(model, credentials, texts, {})
        token = self.get_num_tokens(model, credentials, texts)
        usage = self._calc_response_usage(model=model, credentials=credentials, tokens=token)
        result = TextEmbeddingResult(model=model, embeddings=batch_embeddings, usage=usage)
        return result

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        used to define customizable model schema
        """

        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TEXT_EMBEDDING,
            model_properties={},
            parameter_rules=[],
        )

        return entity

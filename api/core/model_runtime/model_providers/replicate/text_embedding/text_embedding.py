import json
import time
from typing import Optional

from replicate import Client as ReplicateClient

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType, PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.replicate._common import _CommonReplicate


class ReplicateEmbeddingModel(_CommonReplicate, TextEmbeddingModel):
    def _invoke(self, model: str, credentials: dict, texts: list[str],
                user: Optional[str] = None) -> TextEmbeddingResult:

        client = ReplicateClient(api_token=credentials['replicate_api_token'], timeout=30)
        replicate_model_version = f'{model}:{credentials["model_version"]}'

        text_input_key = self._get_text_input_key(model, credentials['model_version'], client)

        embeddings = self._generate_embeddings_by_text_input_key(client, replicate_model_version, text_input_key,
                                                                 texts)

        tokens = self.get_num_tokens(model, credentials, texts)
        usage = self._calc_response_usage(model, credentials, tokens)

        return TextEmbeddingResult(
            model=model,
            embeddings=embeddings,
            usage=usage
        )

    def get_num_tokens(self, model: str, credentials: dict, texts: list[str]) -> int:
        num_tokens = 0
        for text in texts:
            num_tokens += self._get_num_tokens_by_gpt2(text)
        return num_tokens

    def validate_credentials(self, model: str, credentials: dict) -> None:
        if 'replicate_api_token' not in credentials:
            raise CredentialsValidateFailedError('Replicate Access Token must be provided.')

        if 'model_version' not in credentials:
            raise CredentialsValidateFailedError('Replicate Model Version must be provided.')

        try:
            client = ReplicateClient(api_token=credentials['replicate_api_token'], timeout=30)
            replicate_model_version = f'{model}:{credentials["model_version"]}'

            text_input_key = self._get_text_input_key(model, credentials['model_version'], client)

            self._generate_embeddings_by_text_input_key(client, replicate_model_version, text_input_key,
                                                        ['Hello worlds!'])
        except Exception as e:
            raise CredentialsValidateFailedError(str(e))

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.TEXT_EMBEDDING,
            model_properties={
                'context_size': 4096,
                'max_chunks': 1
            }
        )
        return entity

    @staticmethod
    def _get_text_input_key(model: str, model_version: str, client: ReplicateClient) -> str:
        model_info = client.models.get(model)
        model_info_version = model_info.versions.get(model_version)

        # sort through the openapi schema to get the name of text, texts or inputs
        input_properties = sorted(
            model_info_version.openapi_schema["components"]["schemas"]["Input"][
                "properties"
            ].items(),
            key=lambda item: item[1].get("x-order", 0),
        )

        for input_property in input_properties:
            if input_property[0] in ('text', 'texts', 'inputs'):
                text_input_key = input_property[0]
                return text_input_key

        return ''

    @staticmethod
    def _generate_embeddings_by_text_input_key(client: ReplicateClient, replicate_model_version: str,
                                               text_input_key: str, texts: list[str]) -> list[list[float]]:

        if text_input_key in ('text', 'inputs'):
            embeddings = []
            for text in texts:
                result = client.run(replicate_model_version, input={
                    text_input_key: text
                })
                embeddings.append(result[0].get('embedding'))

            return [list(map(float, e)) for e in embeddings]
        elif 'texts' == text_input_key:
            result = client.run(replicate_model_version, input={
                'texts': json.dumps(texts),
                "batch_size": 4,
                "convert_to_numpy": False,
                "normalize_embeddings": True
            })
            return result
        else:
            raise ValueError(f'embeddings input key is invalid: {text_input_key}')

    def _calc_response_usage(self, model: str, credentials: dict, tokens: int) -> EmbeddingUsage:
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

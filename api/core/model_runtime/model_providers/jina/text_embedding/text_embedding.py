import time
from json import JSONDecodeError, dumps
from typing import Optional

from requests import post

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType, PriceType
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
from core.model_runtime.model_providers.jina.text_embedding.jina_tokenizer import JinaTokenizer


class JinaTextEmbeddingModel(TextEmbeddingModel):
    """
    Model class for Jina text embedding model.
    """
    api_base: str = 'https://api.jina.ai/v1'

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
        api_key = credentials['api_key']
        if not api_key:
            raise CredentialsValidateFailedError('api_key is required')

        base_url = credentials.get('base_url', self.api_base)
        if base_url.endswith('/'):
            base_url = base_url[:-1]

        url = base_url + '/embeddings'
        headers = {
            'Authorization': 'Bearer ' + api_key,
            'Content-Type': 'application/json'
        }

        def transform_jina_input_text(model, text):
            if model == 'jina-clip-v1':
                return {"text": text}
            return text

        data = {
            'model': model,
            'input': [transform_jina_input_text(model, text) for text in texts]
        }

        try:
            response = post(url, headers=headers, data=dumps(data))
        except Exception as e:
            raise InvokeConnectionError(str(e))

        if response.status_code != 200:
            try:
                resp = response.json()
                msg = resp['detail']
                if response.status_code == 401:
                    raise InvokeAuthorizationError(msg)
                elif response.status_code == 429:
                    raise InvokeRateLimitError(msg)
                elif response.status_code == 500:
                    raise InvokeServerUnavailableError(msg)
                else:
                    raise InvokeBadRequestError(msg)
            except JSONDecodeError as e:
                raise InvokeServerUnavailableError(
                    f"Failed to convert response to json: {e} with text: {response.text}")

        try:
            resp = response.json()
            embeddings = resp['data']
            usage = resp['usage']
        except Exception as e:
            raise InvokeServerUnavailableError(
                f"Failed to convert response to json: {e} with text: {response.text}")

        usage = self._calc_response_usage(
            model=model, credentials=credentials, tokens=usage['total_tokens'])

        result = TextEmbeddingResult(
            model=model,
            embeddings=[[
                float(data) for data in x['embedding']
            ] for x in embeddings],
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
            # use JinaTokenizer to get num tokens
            num_tokens += JinaTokenizer.get_num_tokens(text)
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
        except Exception as e:
            raise CredentialsValidateFailedError(
                f'Credentials validation failed: {e}')

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [
                InvokeConnectionError
            ],
            InvokeServerUnavailableError: [
                InvokeServerUnavailableError
            ],
            InvokeRateLimitError: [
                InvokeRateLimitError
            ],
            InvokeAuthorizationError: [
                InvokeAuthorizationError
            ],
            InvokeBadRequestError: [
                KeyError,
                InvokeBadRequestError
            ]
        }

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

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
            generate custom model entities from credentials
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            model_type=ModelType.TEXT_EMBEDDING,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: int(
                    credentials.get('context_size'))
            }
        )

        return entity

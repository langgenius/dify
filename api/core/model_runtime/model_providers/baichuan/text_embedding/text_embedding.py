from typing import Optional

from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import TextEmbeddingResult, EmbeddingUsage
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.errors.invoke import InvokeError, InvokeConnectionError, InvokeServerUnavailableError, \
    InvokeRateLimitError, InvokeAuthorizationError, InvokeBadRequestError
from core.model_runtime.model_providers.baichuan.llm.baichuan_tokenizer import BaichuanTokenizer
from core.model_runtime.model_providers.baichuan.llm.baichuan_turbo_errors import InvalidAPIKeyError, InsufficientAccountBalance, \
    InvalidAuthenticationError, RateLimitReachedError, InternalServerError, BadRequestError

from requests import post
from json import dumps, loads

import time

class BaichuanTextEmbeddingModel(TextEmbeddingModel):
    """
    Model class for BaiChuan text embedding model.
    """
    api_base: str = 'http://api.baichuan-ai.com/v1/embeddings'

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
        if model != 'baichuan-text-embedding':
            raise ValueError('Invalid model name')
        if not api_key:
            raise CredentialsValidateFailedError('api_key is required')
        url = self.api_base
        headers = {
            'Authorization': 'Bearer ' + api_key,
            'Content-Type': 'application/json'
        }

        data = {
            'model': 'Baichuan-Text-Embedding',
            'input': texts
        }

        try:
            response = post(url, headers=headers, data=dumps(data))
        except Exception as e:
            raise InvokeConnectionError(e)
        
        if response.status_code != 200:
            try:
                resp = response.json()
                # try to parse error message
                err = resp['error']['code']
                msg = resp['error']['message']
            except Exception as e:
                raise InternalServerError(f"Failed to convert response to json: {e} with text: {response.text}")

            if err == 'invalid_api_key':
                raise InvalidAPIKeyError(msg)
            elif err == 'insufficient_quota':
                raise InsufficientAccountBalance(msg)
            elif err == 'invalid_authentication':
                raise InvalidAuthenticationError(msg)
            elif 'rate' in err:
                raise RateLimitReachedError(msg)
            elif 'internal' in err:
                raise InternalServerError(msg)
            elif err == 'api_key_empty':
                raise InvalidAPIKeyError(msg)
            else:
                raise InternalServerError(f"Unknown error: {err} with message: {msg}")
            
        try:
            resp = response.json()
            embeddings = resp['data']
            usage = resp['usage']
        except Exception as e:
            raise InternalServerError(f"Failed to convert response to json: {e} with text: {response.text}")

        usage = self._calc_response_usage(model=model, credentials=credentials, tokens=usage['total_tokens'])

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
            # use BaichuanTokenizer to get num tokens
            num_tokens += BaichuanTokenizer._get_num_tokens(text)
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
        except InvalidAPIKeyError:
            raise CredentialsValidateFailedError('Invalid api key')

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [
            ],
            InvokeServerUnavailableError: [
                InternalServerError
            ],
            InvokeRateLimitError: [
                RateLimitReachedError
            ],
            InvokeAuthorizationError: [
                InvalidAuthenticationError,
                InsufficientAccountBalance,
                InvalidAPIKeyError,
            ],
            InvokeBadRequestError: [
                BadRequestError,
                KeyError
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

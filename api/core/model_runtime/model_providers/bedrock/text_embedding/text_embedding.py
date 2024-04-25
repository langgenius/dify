import json
import logging
import time
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    NoRegionError,
    ServiceNotInRegionError,
    UnknownServiceError,
)

from core.model_runtime.entities.model_entities import PriceType
from core.model_runtime.entities.text_embedding_entities import EmbeddingUsage, TextEmbeddingResult
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel

logger = logging.getLogger(__name__)

class BedrockTextEmbeddingModel(TextEmbeddingModel):


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
        client_config = Config(
            region_name=credentials["aws_region"]
        )

        bedrock_runtime = boto3.client(
            service_name='bedrock-runtime',
            config=client_config,
            aws_access_key_id=credentials["aws_access_key_id"],
            aws_secret_access_key=credentials["aws_secret_access_key"]
        )

        embeddings = []
        token_usage = 0
        
        model_prefix = model.split('.')[0]
         
        if model_prefix == "amazon" :
           for text in texts:
              body = {
                 "inputText": text,
              }
              response_body = self._invoke_bedrock_embedding(model, bedrock_runtime, body)
              embeddings.extend([response_body.get('embedding')])
              token_usage += response_body.get('inputTextTokenCount')
           logger.warning(f'Total Tokens: {token_usage}')
           result = TextEmbeddingResult(
                model=model,
                embeddings=embeddings,
                usage=self._calc_response_usage(
                    model=model,
                    credentials=credentials,
                    tokens=token_usage
                )
           )
           return result
           
        if model_prefix == "cohere" :
           input_type = 'search_document' if len(texts) > 1 else 'search_query'
           for text in texts:
              body = {
                 "texts": [text],
                 "input_type": input_type,
              }
              response_body = self._invoke_bedrock_embedding(model, bedrock_runtime, body)
              embeddings.extend(response_body.get('embeddings'))
              token_usage += len(text)
           result = TextEmbeddingResult(
                model=model,
                embeddings=embeddings,
                usage=self._calc_response_usage(
                    model=model,
                    credentials=credentials,
                    tokens=token_usage
                )
           )
           return result
        
        #others
        raise ValueError(f"Got unknown model prefix {model_prefix} when handling block response")


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
            num_tokens += self._get_num_tokens_by_gpt2(text)
        return num_tokens

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
    
    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the ermd = genai.GenerativeModel(model)ror type thrown to the caller
        The value is the md = genai.GenerativeModel(model)error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke emd = genai.GenerativeModel(model)rror mapping
        """
        return {
            InvokeConnectionError: [],
            InvokeServerUnavailableError: [],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [],
            InvokeBadRequestError: []
        }
    
    def _create_payload(self, model_prefix: str, texts: list[str], model_parameters: dict, stop: Optional[list[str]] = None, stream: bool = True):
        """
        Create payload for bedrock api call depending on model provider
        """
        payload = dict()

        if model_prefix == "amazon":
            payload['inputText'] = texts

    
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
    
    def _map_client_to_invoke_error(self, error_code: str, error_msg: str) -> type[InvokeError]:
        """
        Map client error to invoke error

        :param error_code: error code
        :param error_msg: error message
        :return: invoke error
        """

        if error_code == "AccessDeniedException":
            return InvokeAuthorizationError(error_msg)
        elif error_code in ["ResourceNotFoundException", "ValidationException"]:
            return InvokeBadRequestError(error_msg)
        elif error_code in ["ThrottlingException", "ServiceQuotaExceededException"]:
            return InvokeRateLimitError(error_msg)
        elif error_code in ["ModelTimeoutException", "ModelErrorException", "InternalServerException", "ModelNotReadyException"]:
            return InvokeServerUnavailableError(error_msg)
        elif error_code == "ModelStreamErrorException":
            return InvokeConnectionError(error_msg)

        return InvokeError(error_msg)
    

    def _invoke_bedrock_embedding(self, model: str, bedrock_runtime, body: dict, ):
        accept = 'application/json' 
        content_type = 'application/json'
        try:
            response = bedrock_runtime.invoke_model(
                body=json.dumps(body), 
                modelId=model, 
                accept=accept, 
                contentType=content_type
            )
            response_body = json.loads(response.get('body').read().decode('utf-8'))
            return response_body
        except ClientError as ex:
            error_code = ex.response['Error']['Code']
            full_error_msg = f"{error_code}: {ex.response['Error']['Message']}"
            raise self._map_client_to_invoke_error(error_code, full_error_msg)
        
        except (EndpointConnectionError, NoRegionError, ServiceNotInRegionError) as ex:
            raise InvokeConnectionError(str(ex))

        except UnknownServiceError as ex:
            raise InvokeServerUnavailableError(str(ex))

        except Exception as ex:
            raise InvokeError(str(ex))

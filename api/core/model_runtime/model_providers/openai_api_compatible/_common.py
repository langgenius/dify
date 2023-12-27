from decimal import Decimal
import requests

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.model_entities import AIModelEntity, DefaultParameterName, \
      FetchFrom, ModelPropertyKey, ModelType, ParameterRule, ParameterType, PriceConfig

from core.model_runtime.errors.invoke import InvokeConnectionError, InvokeServerUnavailableError, \
      InvokeRateLimitError, InvokeAuthorizationError, InvokeBadRequestError, InvokeError


class _CommonOAI_API_Compat:
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
            InvokeAuthorizationError: [
                requests.exceptions.InvalidHeader,  # Missing or Invalid API Key
            ],
            InvokeBadRequestError: [
                requests.exceptions.HTTPError,  # Invalid Endpoint URL or model name
                requests.exceptions.InvalidURL,  # Misconfigured request or other API error
            ],
            InvokeRateLimitError: [
                requests.exceptions.RetryError  # Too many requests sent in a short period of time
            ],
            InvokeServerUnavailableError: [
                requests.exceptions.ConnectionError,  # Engine Overloaded
                requests.exceptions.HTTPError  # Server Error
            ],
            InvokeConnectionError: [
                requests.exceptions.ConnectTimeout,  # Timeout
                requests.exceptions.ReadTimeout  # Timeout
            ]
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
            generate custom model entities from credentials
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={
                ModelPropertyKey.CONTEXT_SIZE: credentials.get('context_size'),
                ModelPropertyKey.MAX_CHUNKS: credentials.get('max_chunks'),
                ModelPropertyKey.MODE: credentials.get('__model_type')
            },
            parameter_rules=[
                ParameterRule(
                    name=DefaultParameterName.TEMPERATURE.value,
                    label=I18nObject(en_US="Temperature"),
                    type=ParameterType.FLOAT,
                    default=float(credentials.get('temperature', 0.7)),
                    min=0,
                    max=2
                ),
                ParameterRule(
                    name=DefaultParameterName.TOP_P.value,
                    label=I18nObject(en_US="Top P"),
                    type=ParameterType.FLOAT,
                    default=float(credentials.get('top_p', 1)),
                    min=0,
                    max=1
                ),
                ParameterRule(
                    name="top_k",
                    label=I18nObject(en_US="Top K"),
                    type=ParameterType.INT,
                    default=int(credentials.get('top_k', 1)),
                ),
                ParameterRule(
                    name=DefaultParameterName.FREQUENCY_PENALTY.value,
                    label=I18nObject(en_US="Frequency Penalty"),
                    type=ParameterType.FLOAT,
                    default=float(credentials.get('frequency_penalty', 0)),
                    min=-2,
                    max=2
                ),
                ParameterRule(
                    name=DefaultParameterName.PRESENCE_PENALTY.value,
                    label=I18nObject(en_US="PRESENCE Penalty"),
                    type=ParameterType.FLOAT,
                    default=float(credentials.get('PRESENCE_penalty', 0)),
                    min=-2,
                    max=2
                ),
                ParameterRule(
                    name=DefaultParameterName.MAX_TOKENS.value,
                    label=I18nObject(en_US="Max Tokens"),
                    type=ParameterType.INT,
                    default=int(credentials.get('max_tokens_to_sample', 1024)),
                    min=1,
                    max=4096
                )
            ],
            pricing=PriceConfig(
                input=Decimal(credentials.get('input_price', 0)),
                output=Decimal(credentials.get('output_price', 0)),
                unit=Decimal(credentials.get('unit', 0)),
                currency=credentials.get('currency', "USD")
            )
        )

        return entity

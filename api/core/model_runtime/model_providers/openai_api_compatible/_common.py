from decimal import Decimal

import requests
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.model_entities import (AIModelEntity, DefaultParameterName, FetchFrom,
                                                        ModelPropertyKey, ModelType, ParameterRule, ParameterType,
                                                        PriceConfig)
from core.model_runtime.errors.invoke import (InvokeAuthorizationError, InvokeBadRequestError, InvokeConnectionError,
                                              InvokeError, InvokeRateLimitError, InvokeServerUnavailableError)


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
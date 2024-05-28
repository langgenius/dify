import openai
from httpx import Timeout

from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.model_providers.azure_openai._constant import AZURE_OPENAI_API_VERSION


class _CommonAzureOpenAI:
    @staticmethod
    def _to_credential_kwargs(credentials: dict) -> dict:
        api_version = credentials.get('openai_api_version', AZURE_OPENAI_API_VERSION)
        credentials_kwargs = {
            "api_key": credentials['openai_api_key'],
            "azure_endpoint": credentials['openai_api_base'],
            "api_version": api_version,
            "timeout": Timeout(315.0, read=300.0, write=10.0, connect=5.0),
            "max_retries": 1,
        }

        return credentials_kwargs

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

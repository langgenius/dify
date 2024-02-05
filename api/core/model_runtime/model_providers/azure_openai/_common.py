from httpx import Timeout
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.model_providers.azure_openai._constant import AZURE_OPENAI_API_VERSION


class _CommonAzureOpenAI:
    @staticmethod
    def _to_credential_kwargs(credentials: dict) -> dict:
        credentials_kwargs = {
            "api_key": credentials['openai_api_key'],
            "azure_endpoint": credentials['openai_api_base'],
            "api_version": AZURE_OPENAI_API_VERSION,
            "timeout": Timeout(315.0, read=300.0, write=10.0, connect=5.0),
            "max_retries": 1,
        }

        return credentials_kwargs

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        pass


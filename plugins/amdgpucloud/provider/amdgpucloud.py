from dify_plugin import ModelProvider

from models._credentials import validate_api_key


class AMDGPUCloudModelProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        validate_api_key(credentials)
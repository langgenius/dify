import logging

from core.model_runtime.model_providers.__base.model_provider import ModelProvider

logger = logging.getLogger(__name__)


class ReplicateProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        pass

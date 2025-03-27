import logging
from collections.abc import Mapping

from dify_plugin import ModelProvider

logger = logging.getLogger(__name__)


class OpenAIProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: Mapping) -> None:
        """
        Validate provider credentials
        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        pass
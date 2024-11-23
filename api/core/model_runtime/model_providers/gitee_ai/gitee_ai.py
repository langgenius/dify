import logging

import requests

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.model_provider import ModelProvider

logger = logging.getLogger(__name__)


class GiteeAIProvider(ModelProvider):
    def validate_provider_credentials(self, credentials: dict) -> None:
        """
        Validate provider credentials
        if validate failed, raise exception

        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        """
        try:
            api_key = credentials.get("api_key")
            if not api_key:
                raise CredentialsValidateFailedError("Credentials validation failed: api_key not given")

            # send a get request to validate the credentials
            headers = {"Authorization": f"Bearer {api_key}"}
            response = requests.get("https://ai.gitee.com/api/base/account/me", headers=headers, timeout=(10, 300))

            if response.status_code != 200:
                raise CredentialsValidateFailedError(
                    f"Credentials validation failed with status code {response.status_code}"
                )
        except CredentialsValidateFailedError as ex:
            raise ex
        except Exception as ex:
            logger.exception(f"{self.get_provider_schema().provider} credentials validate failed")
            raise ex

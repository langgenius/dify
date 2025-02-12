import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.ppio.ppio import PPIOProvider


def test_validate_provider_credentials():
    provider = PPIOProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(
        credentials={
            "api_key": os.environ.get("PPIO_API_KEY"),
        }
    ) 
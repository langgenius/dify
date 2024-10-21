import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.fireworks.fireworks import FireworksProvider


@pytest.mark.parametrize("setup_openai_mock", [["chat"]], indirect=True)
def test_validate_provider_credentials(setup_openai_mock):
    provider = FireworksProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(credentials={"fireworks_api_key": os.environ.get("FIREWORKS_API_KEY")})

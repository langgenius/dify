import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.cohere.cohere import CohereProvider


def test_validate_provider_credentials():
    provider = CohereProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(credentials={"api_key": os.environ.get("COHERE_API_KEY")})

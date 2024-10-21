import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.google.google import GoogleProvider


@pytest.mark.parametrize("setup_google_mock", [["none"]], indirect=True)
def test_validate_provider_credentials(setup_google_mock):
    provider = GoogleProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(credentials={"google_api_key": os.environ.get("GOOGLE_API_KEY")})

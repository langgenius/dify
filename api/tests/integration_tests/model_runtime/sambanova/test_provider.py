import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.sambanova.sambanova import SambaNovaProvider
from tests.integration_tests.model_runtime.__mock.sambanova import setup_sambanova_mock


@pytest.mark.parametrize("setup_sambanova_mock", [["none"]], indirect=True)
def test_validate_provider_credentials(setup_sambanova_mock):
    provider = SambaNovaProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(credentials={"api_key": os.environ.get("SAMBANOVA_API_KEY")})

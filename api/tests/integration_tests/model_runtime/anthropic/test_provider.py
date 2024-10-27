import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.anthropic.anthropic import AnthropicProvider
from tests.integration_tests.model_runtime.__mock.anthropic import setup_anthropic_mock


@pytest.mark.parametrize("setup_anthropic_mock", [["none"]], indirect=True)
def test_validate_provider_credentials(setup_anthropic_mock):
    provider = AnthropicProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(credentials={"anthropic_api_key": os.environ.get("ANTHROPIC_API_KEY")})

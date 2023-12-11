import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.anthropic.anthropic import AnthropicProvider


def test_validate_provider_credentials():
    provider = AnthropicProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={}
        )

    provider.validate_provider_credentials(
        credentials={
            'anthropic_api_key': os.environ.get('ANTHROPIC_API_KEY')
        }
    )

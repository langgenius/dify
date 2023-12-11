import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openai.openai import OpenAIProvider


def test_validate_provider_credentials():
    provider = OpenAIProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={}
        )

    provider.validate_provider_credentials(
        credentials={
            'openai_api_key': os.environ.get('OPENAI_API_KEY')
        }
    )

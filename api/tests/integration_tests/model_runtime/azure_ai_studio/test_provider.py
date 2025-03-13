import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.azure_ai_studio.azure_ai_studio import AzureAIStudioProvider


def test_validate_provider_credentials():
    provider = AzureAIStudioProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(
        credentials={"api_key": os.getenv("AZURE_AI_STUDIO_API_KEY"), "api_base": os.getenv("AZURE_AI_STUDIO_API_BASE")}
    )

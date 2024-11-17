import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gitee_ai.gitee_ai import GiteeAIProvider


def test_validate_provider_credentials():
    provider = GiteeAIProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={"api_key": "invalid_key"})

    provider.validate_provider_credentials(credentials={"api_key": os.environ.get("GITEE_AI_API_KEY")})

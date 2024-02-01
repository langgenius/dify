import os

import pytest
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.bedrock.bedrock import BedrockProvider


def test_validate_provider_credentials():
    provider = BedrockProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={}
        )

    provider.validate_provider_credentials(
        credentials={
            "aws_region": os.getenv("AWS_REGION"),
            "aws_access_key": os.getenv("AWS_ACCESS_KEY"),
            "aws_secret_access_key": os.getenv("AWS_SECRET_ACCESS_KEY")
        }
    )

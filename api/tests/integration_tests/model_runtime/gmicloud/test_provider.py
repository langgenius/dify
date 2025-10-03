import os
import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gmicloud.gmicloud import GmicloudProvider


def test_validate_provider_credentials():
    provider = GmicloudProvider()
    
    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={}
        )

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'api_key': 'invalid_key'
            }
        )

    provider.validate_provider_credentials(
        credentials={
            'api_key': os.environ.get('GMI_CLOUD_API_KEY', 'valid_api_key_for_testing')
        }
    )

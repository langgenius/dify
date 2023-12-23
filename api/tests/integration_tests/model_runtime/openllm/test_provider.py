import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openllm.openllm import OpenLLMProvider

def test_validate_provider_credentials():
    provider = OpenLLMProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'server_url': 'hahahaha',
                'model_type': 'text-generation',
                'model_name': 'NOT IMPORTANT'
            }
        )

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'server_url': 'hahahaha',
                'model_type': 'embeddings',
                'model_name': 'NOT IMPORTANT'
            }
        )

    provider.validate_provider_credentials(
        credentials={
            'server_url': os.environ.get('OPENLLM_SERVER_URL'),
            'model_type': 'text-generation',
            'model_name': 'NOT IMPORTANT'
        }
    )

    provider.validate_provider_credentials(
        credentials={
            'server_url': os.environ.get('OPENLLM_SERVER_URL'),
            'model_type': 'embeddings',
            'model_name': 'NOT IMPORTANT'
        }
    )
import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.localai.localai import LocalAIProvider

def test_validate_provider_credentials():
    provider = LocalAIProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'server_url': 'hahahaha',
                'model_type': 'text-generation',
                'completion_type': 'completion',
                'model_name': 'chinese-llama-2-7b'
            }
        )

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'server_url': 'hahahaha',
                'model_type': 'embeddings',
                'completion_type': 'completion',
                'model_name': 'text-embedding-ada-002'
            }
        )

    provider.validate_provider_credentials(
        credentials={
            'server_url': os.environ.get('LOCALAI_SERVER_URL'),
            'model_type': 'text-generation',
            'completion_type': 'completion',
            'model_name': 'chinese-llama-2-7b'
        }
    )

    # provider.validate_provider_credentials(
    #     credentials={
    #         'server_url': os.environ.get('LOCALAI_SERVER_URL'),
    #         'model_type': 'embeddings',
    #         'completion_type': 'completion',
    #         'model_name': 'text-embedding-ada-002'
    #     }
    # )
import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.xinference.xinference import XinferenceAIProvider


def test_validate_provider_credentials():
    provider = XinferenceAIProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'server_url': 'hahahaha',
                'model_type': 'text-generation',
                'model_name': 'ChatGLM3',
                'model_uid': '123123'
            }
        )
    
    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
                'model_type': 'text-generation',
                'model_name': 'ChatGLM3',
                'model_uid': '123123'
            }
        )

    provider.validate_provider_credentials(
        credentials={
            'server_url': os.environ.get('XINFERENCE_SERVER_URL'),
            'model_type': 'text-generation',
            'model_name': 'ChatGLM3',
            'model_uid': os.environ.get('XINFERENCE_MODEL_UID')
        }
    )

import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.jina.jina import JinaProvider


def test_validate_provider_credentials():
    provider = JinaProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'api_key': 'hahahaha'
            }
        )

    provider.validate_provider_credentials(
        credentials={
            'api_key': os.environ.get('JINA_API_KEY')
        }
    )

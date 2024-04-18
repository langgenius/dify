import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.wenxin.wenxin import WenxinProvider


def test_validate_provider_credentials():
    provider = WenxinProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'api_key': 'hahahaha',
                'secret_key': 'hahahaha'
            }
        )

    provider.validate_provider_credentials(
        credentials={
            'api_key': os.environ.get('WENXIN_API_KEY'),
            'secret_key': os.environ.get('WENXIN_SECRET_KEY')
        }
    )

import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.hunyuan.hunyuan import HunyuanProvider


def test_validate_provider_credentials():
    provider = HunyuanProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                'secret_id': 'invalid_key',
                'secret_key': 'invalid_key'
            }
        )

    provider.validate_provider_credentials(
        credentials={
            'secret_id': os.environ.get('HUNYUAN_SECRET_ID'),
            'secret_key': os.environ.get('HUNYUAN_SECRET_KEY')
        }
    )

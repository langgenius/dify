import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.baichuan.baichuan import BaichuanProvider


def test_validate_provider_credentials():
    provider = BaichuanProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={"api_key": "hahahaha"})

    provider.validate_provider_credentials(credentials={"api_key": os.environ.get("BAICHUAN_API_KEY")})

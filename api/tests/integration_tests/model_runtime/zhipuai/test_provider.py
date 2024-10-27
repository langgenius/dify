import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.zhipuai.zhipuai import ZhipuaiProvider


def test_validate_provider_credentials():
    provider = ZhipuaiProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(credentials={"api_key": os.environ.get("ZHIPUAI_API_KEY")})

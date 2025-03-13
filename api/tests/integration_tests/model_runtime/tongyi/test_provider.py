import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.tongyi.tongyi import TongyiProvider


def test_validate_provider_credentials():
    provider = TongyiProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(
        credentials={"dashscope_api_key": os.environ.get("TONGYI_DASHSCOPE_API_KEY")}
    )

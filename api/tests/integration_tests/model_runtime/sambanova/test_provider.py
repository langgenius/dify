import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.sambanova.sambanova import SambanovaProvider
from tests.integration_tests.conftest import _load_env
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock

_load_env()


# @pytest.mark.parametrize("setup_openai_mock", [["chat"]], indirect=True)
def test_validate_provider_credentials():
    provider = SambanovaProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(credentials={"sambanova_api_key": os.environ.get("SAMBANOVA_API_KEY")})


test_validate_provider_credentials()

import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.upstage.upstage import UpstageProvider
from tests.integration_tests.model_runtime.__mock.openai import setup_openai_mock


@pytest.mark.parametrize('setup_openai_mock', [['chat']], indirect=True)
def test_validate_provider_credentials(setup_openai_mock):
    provider = UpstageProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={}
        )

    provider.validate_provider_credentials(
        credentials={
            'upstage_api_key': os.environ.get('UPSTAGE_API_KEY')
        }
    )

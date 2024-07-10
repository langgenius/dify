import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.siliconflow.siliconflow import SiliconflowProvider


def test_validate_provider_credentials():
    provider = SiliconflowProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={}
        )

    provider.validate_provider_credentials(
        credentials={
            'siliconflow_api_key': os.environ.get('SILICONFLOW_API_KEY')
        }
    )

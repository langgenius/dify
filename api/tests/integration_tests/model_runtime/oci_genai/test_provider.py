import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.oci_genai.oci_genai import OCIGENAIProvider


def test_validate_provider_credentials():
    provider = OCIGENAIProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={}
        )

    provider.validate_provider_credentials(
        credentials={
            'api_key': 'g3n3k0jPt0NO6eEPeLJLDHSeaeH2QxSQtmVaRI7X'
        }
    )

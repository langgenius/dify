import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.oci.oci import OCIGENAIProvider


def test_validate_provider_credentials():
    provider = OCIGENAIProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(
        credentials={
            "oci_config_content": os.environ.get("OCI_CONFIG_CONTENT"),
            "oci_key_content": os.environ.get("OCI_KEY_CONTENT"),
        }
    )

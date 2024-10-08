import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.nomic.nomic import NomicAtlasProvider
from tests.integration_tests.model_runtime.__mock.nomic_embeddings import setup_nomic_mock


@pytest.mark.parametrize("setup_nomic_mock", [["text_embedding"]], indirect=True)
def test_validate_provider_credentials(setup_nomic_mock):
    provider = NomicAtlasProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(credentials={})

    provider.validate_provider_credentials(
        credentials={
            "nomic_api_key": os.environ.get("NOMIC_API_KEY"),
        },
    )

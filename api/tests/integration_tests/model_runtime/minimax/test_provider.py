import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.minimax.minimax import MinimaxProvider


def test_validate_provider_credentials():
    provider = MinimaxProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                "minimax_api_key": "hahahaha",
                "minimax_group_id": "123",
            }
        )

    provider.validate_provider_credentials(
        credentials={
            "minimax_api_key": os.environ.get("MINIMAX_API_KEY"),
            "minimax_group_id": os.environ.get("MINIMAX_GROUP_ID"),
        }
    )

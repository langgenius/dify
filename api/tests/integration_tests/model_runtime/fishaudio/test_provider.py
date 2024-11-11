import os

import httpx
import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.fishaudio.fishaudio import FishAudioProvider
from tests.integration_tests.model_runtime.__mock.fishaudio import setup_fishaudio_mock


@pytest.mark.parametrize("setup_fishaudio_mock", [["list-models"]], indirect=True)
def test_validate_provider_credentials(setup_fishaudio_mock):
    print("-----", httpx.get)
    provider = FishAudioProvider()

    with pytest.raises(CredentialsValidateFailedError):
        provider.validate_provider_credentials(
            credentials={
                "api_key": "bad_api_key",
                "api_base": os.environ.get("FISH_AUDIO_API_BASE", "https://api.fish.audio"),
                "use_public_models": "false",
                "latency": "normal",
            }
        )

    provider.validate_provider_credentials(
        credentials={
            "api_key": os.environ.get("FISH_AUDIO_API_KEY", "test"),
            "api_base": os.environ.get("FISH_AUDIO_API_BASE", "https://api.fish.audio"),
            "use_public_models": "false",
            "latency": "normal",
        }
    )

import os

import pytest

from core.model_runtime.model_providers.fishaudio.tts.tts import (
    FishAudioText2SpeechModel,
)
from tests.integration_tests.model_runtime.__mock.fishaudio import setup_fishaudio_mock


@pytest.mark.parametrize("setup_fishaudio_mock", [["tts"]], indirect=True)
def test_invoke_model(setup_fishaudio_mock):
    model = FishAudioText2SpeechModel()

    result = model.invoke(
        model="tts-default",
        tenant_id="test",
        credentials={
            "api_key": os.environ.get("FISH_AUDIO_API_KEY", "test"),
            "api_base": os.environ.get("FISH_AUDIO_API_BASE", "https://api.fish.audio"),
            "use_public_models": "false",
            "latency": "normal",
        },
        content_text="Hello, world!",
        voice="03397b4c4be74759b72533b663fbd001",
    )

    content = b""
    for chunk in result:
        content += chunk

    assert content != b""

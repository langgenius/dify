import os
from pathlib import Path

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.gpustack.speech2text.speech2text import GPUStackSpeech2TextModel


def test_validate_credentials():
    model = GPUStackSpeech2TextModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="faster-whisper-medium",
            credentials={
                "endpoint_url": "invalid_url",
                "api_key": "invalid_api_key",
            },
        )

    model.validate_credentials(
        model="faster-whisper-medium",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
    )


def test_invoke_model():
    model = GPUStackSpeech2TextModel()

    # Get the directory of the current file
    current_dir = os.path.dirname(os.path.abspath(__file__))

    # Get assets directory
    assets_dir = os.path.join(os.path.dirname(current_dir), "assets")

    # Construct the path to the audio file
    audio_file_path = os.path.join(assets_dir, "audio.mp3")

    file = Path(audio_file_path).read_bytes()

    result = model.invoke(
        model="faster-whisper-medium",
        credentials={
            "endpoint_url": os.environ.get("GPUSTACK_SERVER_URL"),
            "api_key": os.environ.get("GPUSTACK_API_KEY"),
        },
        file=file,
    )

    assert isinstance(result, str)
    assert result == "1, 2, 3, 4, 5, 6, 7, 8, 9, 10"

import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openai_api_compatible.speech2text.speech2text import (
    OAICompatSpeech2TextModel,
)


def test_validate_credentials():
    model = OAICompatSpeech2TextModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="whisper-1",
            credentials={"api_key": "invalid_key", "endpoint_url": "https://api.openai.com/v1/"},
        )

    model.validate_credentials(
        model="whisper-1",
        credentials={"api_key": os.environ.get("OPENAI_API_KEY"), "endpoint_url": "https://api.openai.com/v1/"},
    )


def test_invoke_model():
    model = OAICompatSpeech2TextModel()

    # Get the directory of the current file
    current_dir = os.path.dirname(os.path.abspath(__file__))

    # Get assets directory
    assets_dir = os.path.join(os.path.dirname(current_dir), "assets")

    # Construct the path to the audio file
    audio_file_path = os.path.join(assets_dir, "audio.mp3")

    # Open the file and get the file object
    with open(audio_file_path, "rb") as audio_file:
        file = audio_file

        result = model.invoke(
            model="whisper-1",
            credentials={"api_key": os.environ.get("OPENAI_API_KEY"), "endpoint_url": "https://api.openai.com/v1/"},
            file=file,
            user="abc-123",
        )

        assert isinstance(result, str)
        assert result == "1, 2, 3, 4, 5, 6, 7, 8, 9, 10"

import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.tongyi.speech2text.speech2text import TongYiSpeech2TextModel

def test_validate_credentials():
    model = TongYiSpeech2TextModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(
            model="qwen-audio-asr",
            credentials={"dashscope_api_key": "invalid_key"},
        )

    model.validate_credentials(
        model="qwen-audio-asr",
        credentials={"dashscope_api_key": os.environ.get("TONGYI_DASHSCOPE_API_KEY")}
    )


def test_invoke_model():
    model = TongYiSpeech2TextModel()

    # Get the directory of the current file
    current_dir = os.path.dirname(os.path.abspath(__file__))

    # Get assets directory
    assets_dir = os.path.join(os.path.dirname(current_dir), "assets")

    # Construct the path to the audio file
    audio_file_path = os.path.join(assets_dir, "audio.mp3")

    # Open the file and get the file object
    with open(audio_file_path, "rb") as audio_file:
        result = model.invoke(
            model="qwen-audio-asr", credentials={"dashscope_api_key": os.environ.get("TONGYI_DASHSCOPE_API_KEY")}, file = audio_file
        )
        assert isinstance(result, str)
        assert result == "1,2,3,4,5,6,7,8,9,10."

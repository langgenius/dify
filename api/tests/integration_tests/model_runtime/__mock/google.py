from unittest.mock import MagicMock

import google.generativeai.types.generation_types as generation_config_types  # type: ignore
import pytest
from _pytest.monkeypatch import MonkeyPatch
from google.ai import generativelanguage as glm
from google.ai.generativelanguage_v1beta.types import content as gag_content
from google.generativeai import GenerativeModel
from google.generativeai.types import GenerateContentResponse, content_types, safety_types
from google.generativeai.types.generation_types import BaseGenerateContentResponse

from extensions import ext_redis


class MockGoogleResponseClass:
    _done = False

    def __iter__(self):
        full_response_text = "it's google!"

        for i in range(0, len(full_response_text) + 1, 1):
            if i == len(full_response_text):
                self._done = True
                yield GenerateContentResponse(
                    done=True, iterator=None, result=glm.GenerateContentResponse({}), chunks=[]
                )
            else:
                yield GenerateContentResponse(
                    done=False, iterator=None, result=glm.GenerateContentResponse({}), chunks=[]
                )


class MockGoogleResponseCandidateClass:
    finish_reason = "stop"

    @property
    def content(self) -> gag_content.Content:
        return gag_content.Content(parts=[gag_content.Part(text="it's google!")])


class MockGoogleClass:
    @staticmethod
    def generate_content_sync() -> GenerateContentResponse:
        return GenerateContentResponse(done=True, iterator=None, result=glm.GenerateContentResponse({}), chunks=[])

    @staticmethod
    def generate_content_stream() -> MockGoogleResponseClass:
        return MockGoogleResponseClass()

    def generate_content(
        self: GenerativeModel,
        contents: content_types.ContentsType,
        *,
        generation_config: generation_config_types.GenerationConfigType | None = None,
        safety_settings: safety_types.SafetySettingOptions | None = None,
        stream: bool = False,
        **kwargs,
    ) -> GenerateContentResponse:
        if stream:
            return MockGoogleClass.generate_content_stream()

        return MockGoogleClass.generate_content_sync()

    @property
    def generative_response_text(self) -> str:
        return "it's google!"

    @property
    def generative_response_candidates(self) -> list[MockGoogleResponseCandidateClass]:
        return [MockGoogleResponseCandidateClass()]


def mock_configure(api_key: str):
    if len(api_key) < 16:
        raise Exception("Invalid API key")


class MockFileState:
    def __init__(self):
        self.name = "FINISHED"


class MockGoogleFile:
    def __init__(self, name: str = "mock_file_name"):
        self.name = name
        self.state = MockFileState()


def mock_get_file(name: str) -> MockGoogleFile:
    return MockGoogleFile(name)


def mock_upload_file(path: str, mime_type: str) -> MockGoogleFile:
    return MockGoogleFile()


@pytest.fixture
def setup_google_mock(request, monkeypatch: MonkeyPatch):
    monkeypatch.setattr(BaseGenerateContentResponse, "text", MockGoogleClass.generative_response_text)
    monkeypatch.setattr(BaseGenerateContentResponse, "candidates", MockGoogleClass.generative_response_candidates)
    monkeypatch.setattr(GenerativeModel, "generate_content", MockGoogleClass.generate_content)
    monkeypatch.setattr("google.generativeai.configure", mock_configure)
    monkeypatch.setattr("google.generativeai.get_file", mock_get_file)
    monkeypatch.setattr("google.generativeai.upload_file", mock_upload_file)

    yield

    monkeypatch.undo()


@pytest.fixture
def setup_mock_redis() -> None:
    ext_redis.redis_client.get = MagicMock(return_value=None)
    ext_redis.redis_client.setex = MagicMock(return_value=None)
    ext_redis.redis_client.exists = MagicMock(return_value=True)

from unittest.mock import MagicMock

import pytest
from _pytest.monkeypatch import MonkeyPatch
from google.genai import errors, types

from extensions import ext_redis


class MockGoogleStreamResponse:
    def __iter__(self) -> types.GenerateContentResponse:
        full_response_text = "it's google!"

        for i in range(0, len(full_response_text) + 1, 1):
            if i == len(full_response_text):
                yield types.GenerateContentResponse(
                    candidates=[types.Candidate(content=types.Content(parts=None))],
                    usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=0),
                )
            else:
                yield types.GenerateContentResponse(
                    candidates=[types.Candidate(content=types.Content(parts=[types.Part(text=str(i))]))]
                )


class MockGoogleSyncResponse:
    def __init__(self):
        self._text = "it's google!"
        self.usage_metadata = None

    @property
    def text(self) -> str:
        return self._text


class MockGoogleClient:
    def __init__(self, api_key=None):
        if len(api_key) < 16:
            raise errors.ClientError("Invalid API key")
        self.models = self.MockModels()
        self.files = MagicMock()
        self.files.get = mock_get_file
        self.files.upload = mock_upload_file

    class MockModels:
        def generate_content(self, *args, **kwargs) -> types.GenerateContentResponse:
            return MockGoogleSyncResponse()

        def generate_content_stream(self, *args, **kwargs) -> types.GenerateContentResponse:
            return MockGoogleStreamResponse()


class MockFileState:
    def __init__(self):
        self.name = "FINISHED"


class MockGoogleFile:
    def __init__(self, name: str = "mock_file_name"):
        self.name = name
        self.state = MockFileState()
        self.uri = "http://example.com"
        self.mime_type = "image/png"


def mock_get_file(name: str) -> MockGoogleFile:
    return MockGoogleFile(name)


def mock_upload_file(path: str, config: dict) -> MockGoogleFile:
    return MockGoogleFile()


@pytest.fixture
def setup_google_mock(request, monkeypatch: MonkeyPatch):
    monkeypatch.setattr("google.genai.Client", MockGoogleClient)

    yield

    monkeypatch.undo()


@pytest.fixture
def setup_mock_redis() -> None:
    ext_redis.redis_client.get = MagicMock(return_value=None)
    ext_redis.redis_client.setex = MagicMock(return_value=None)
    ext_redis.redis_client.exists = MagicMock(return_value=True)

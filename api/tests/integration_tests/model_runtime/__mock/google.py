from collections.abc import Generator

import google.generativeai.types.content_types as content_types
import google.generativeai.types.generation_types as generation_config_types
import google.generativeai.types.safety_types as safety_types
import pytest
from _pytest.monkeypatch import MonkeyPatch
from google.ai import generativelanguage as glm
from google.ai.generativelanguage_v1beta.types import content as gag_content
from google.generativeai import GenerativeModel
from google.generativeai.client import _ClientManager, configure
from google.generativeai.types import GenerateContentResponse
from google.generativeai.types.generation_types import BaseGenerateContentResponse

current_api_key = ""


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
    def generate_content_stream() -> Generator[GenerateContentResponse, None, None]:
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
        global current_api_key

        if len(current_api_key) < 16:
            raise Exception("Invalid API key")

        if stream:
            return MockGoogleClass.generate_content_stream()

        return MockGoogleClass.generate_content_sync()

    @property
    def generative_response_text(self) -> str:
        return "it's google!"

    @property
    def generative_response_candidates(self) -> list[MockGoogleResponseCandidateClass]:
        return [MockGoogleResponseCandidateClass()]

    def make_client(self: _ClientManager, name: str):
        global current_api_key

        if name.endswith("_async"):
            name = name.split("_")[0]
            cls = getattr(glm, name.title() + "ServiceAsyncClient")
        else:
            cls = getattr(glm, name.title() + "ServiceClient")

        # Attempt to configure using defaults.
        if not self.client_config:
            configure()

        client_options = self.client_config.get("client_options", None)
        if client_options:
            current_api_key = client_options.api_key

        def nop(self, *args, **kwargs):
            pass

        original_init = cls.__init__
        cls.__init__ = nop
        client: glm.GenerativeServiceClient = cls(**self.client_config)
        cls.__init__ = original_init

        if not self.default_metadata:
            return client


@pytest.fixture
def setup_google_mock(request, monkeypatch: MonkeyPatch):
    monkeypatch.setattr(BaseGenerateContentResponse, "text", MockGoogleClass.generative_response_text)
    monkeypatch.setattr(BaseGenerateContentResponse, "candidates", MockGoogleClass.generative_response_candidates)
    monkeypatch.setattr(GenerativeModel, "generate_content", MockGoogleClass.generate_content)
    monkeypatch.setattr(_ClientManager, "make_client", MockGoogleClass.make_client)

    yield

    monkeypatch.undo()

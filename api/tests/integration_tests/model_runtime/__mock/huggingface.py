import os

import pytest
from _pytest.monkeypatch import MonkeyPatch
from huggingface_hub import InferenceClient

from tests.integration_tests.model_runtime.__mock.huggingface_chat import MockHuggingfaceChatClass

MOCK = os.getenv('MOCK_SWITCH', 'false').lower() == 'true'

@pytest.fixture
def setup_huggingface_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(InferenceClient, "text_generation", MockHuggingfaceChatClass.text_generation)
    
    yield

    if MOCK:
        monkeypatch.undo()
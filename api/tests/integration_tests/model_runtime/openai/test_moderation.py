import os

import pytest

from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.openai.moderation.moderation import OpenAIModerationModel


@pytest.mark.parametrize("setup_openai_mock", [["moderation"]], indirect=True)
def test_validate_credentials(setup_openai_mock):
    model = OpenAIModerationModel()

    with pytest.raises(CredentialsValidateFailedError):
        model.validate_credentials(model="text-moderation-stable", credentials={"openai_api_key": "invalid_key"})

    model.validate_credentials(
        model="text-moderation-stable", credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")}
    )


@pytest.mark.parametrize("setup_openai_mock", [["moderation"]], indirect=True)
def test_invoke_model(setup_openai_mock):
    model = OpenAIModerationModel()

    result = model.invoke(
        model="text-moderation-stable",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
        text="hello",
        user="abc-123",
    )

    assert isinstance(result, bool)
    assert result is False

    result = model.invoke(
        model="text-moderation-stable",
        credentials={"openai_api_key": os.environ.get("OPENAI_API_KEY")},
        text="i will kill you",
        user="abc-123",
    )

    assert isinstance(result, bool)
    assert result is True

import pytest

from core.tools.provider.builtin.dalle.dalle import DALLEProvider
from core.tools.errors import AssistantProviderCredentialValidationError

def test_dalle_provider():
    """
    Test DALLEProvider
    """
    provider = DALLEProvider()

    tools = provider.get_tools()

    assert len(tools) > 0

def test_validate_credentails():
    with pytest.raises(AssistantProviderCredentialValidationError):
        DALLEProvider().validate_credentials("dalle2", {})

    DALLEProvider().validate_credentials("dalle2", {
        "openai_api_key": "test",
        "openai_organizaion_id": "test",
        "openai_base_url": "test",
    })
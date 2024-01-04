import pytest

from core.tools.provider.builtin.google.google import GoogleProvider
from core.tools.errors import AssistantProviderCredentialValidationError

def test_google_provider():
    """
    Test GoogleProvider
    """
    provider = GoogleProvider()

    tools = provider.get_tools()

    assert len(tools) > 0

def test_validate_credentails():
    with pytest.raises(AssistantProviderCredentialValidationError):
        GoogleProvider().validate_credentials("google_search", {})

    GoogleProvider().validate_credentials("google_search", {
        "serpapi_api_key": "test"
    })
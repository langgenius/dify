from core.tools.provider.builtin.google.google import GoogleProvider

def test_google_provider():
    """
    Test GoogleProvider
    """
    provider = GoogleProvider()

    tools = provider.get_tools()

    assert len(tools) > 0
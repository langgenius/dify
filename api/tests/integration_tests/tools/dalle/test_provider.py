from core.tools.provider.builtin.dalle.dalle import DALLEProvider

def test_dalle_provider():
    """
    Test DALLEProvider
    """
    provider = DALLEProvider()

    tools = provider.get_tools()

    assert len(tools) > 0
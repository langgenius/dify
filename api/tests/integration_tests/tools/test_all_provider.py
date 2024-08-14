import pytest

from core.tools.tool_manager import ToolManager

provider_generator = ToolManager.list_builtin_providers()
provider_names = [provider.identity.name for provider in provider_generator]
ToolManager.clear_builtin_providers_cache()
provider_generator = ToolManager.list_builtin_providers()

@pytest.mark.parametrize('name', provider_names)
def test_tool_providers(benchmark, name):
    """
    Test that all tool providers can be loaded
    """
    
    def test(generator):
        try:
            return next(generator)
        except StopIteration:
            return None
    
    benchmark.pedantic(test, args=(provider_generator,), iterations=1, rounds=1)
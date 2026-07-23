import pytest

from core.ops.entities.config_entity import TracingProviderEnum
from core.ops.unified_trace.registry import unified_provider_config_map


def test_registry_exposes_only_implemented_providers():
    phoenix = unified_provider_config_map[TracingProviderEnum.PHOENIX]
    langsmith = unified_provider_config_map[TracingProviderEnum.LANGSMITH]

    assert phoenix["trace_instance"].__name__ == "UnifiedPhoenixTrace"
    assert langsmith["trace_instance"].__name__ == "UnifiedLangSmithTrace"
    with pytest.raises(KeyError):
        unified_provider_config_map[TracingProviderEnum.LANGFUSE]

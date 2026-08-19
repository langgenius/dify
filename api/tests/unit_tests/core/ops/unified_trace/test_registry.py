import pytest

from core.ops.entities.config_entity import TracingProviderEnum
from core.ops.unified_trace.registry import unified_provider_config_map


def test_registry_exposes_only_implemented_providers() -> None:
    phoenix = unified_provider_config_map[TracingProviderEnum.PHOENIX]
    langsmith = unified_provider_config_map[TracingProviderEnum.LANGSMITH]
    otel = unified_provider_config_map[TracingProviderEnum.OTEL]

    assert phoenix["trace_instance"].__name__ == "UnifiedPhoenixTrace"
    assert langsmith["trace_instance"].__name__ == "UnifiedLangSmithTrace"
    assert otel["trace_instance"].__name__ == "UnifiedOTelTrace"
    assert otel["config_class"].__name__ == "OTelTracingConfig"
    with pytest.raises(KeyError):
        unified_provider_config_map[TracingProviderEnum.LANGFUSE]

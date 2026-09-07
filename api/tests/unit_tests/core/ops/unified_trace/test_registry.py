import pytest

from core.ops.entities.config_entity import TracingProviderEnum
from core.ops.unified_trace.registry import unified_provider_config_map, unified_scope_key_field


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


def test_scope_key_field_is_declared_per_provider() -> None:
    assert unified_scope_key_field(TracingProviderEnum.PHOENIX) == "project"
    assert unified_scope_key_field(TracingProviderEnum.LANGSMITH) == "project"
    assert unified_scope_key_field(TracingProviderEnum.OTEL) == "service_name"


def test_scope_key_field_is_none_for_unregistered_provider() -> None:
    # Unregistered providers must not fall back to another provider's field name
    assert unified_scope_key_field(TracingProviderEnum.LANGFUSE) is None
    assert unified_scope_key_field("not-a-provider") is None

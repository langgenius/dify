import pytest

from core.ops.entities.config_entity import TracingProviderEnum
from core.ops.unified_trace.registry import (
    is_unified_provider,
    unified_dispatch_enabled,
    unified_provider_config_map,
    unified_scope_key_field,
)
from tests.unit_tests.config_override import apply_config_overrides


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


def test_unified_dispatch_ignores_switch_for_unified_only_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    apply_config_overrides(monkeypatch, OPS_TRACE_UNIFIED_ENABLED=False)
    assert unified_dispatch_enabled(TracingProviderEnum.OTEL) is True
    assert unified_dispatch_enabled(TracingProviderEnum.PHOENIX) is False
    assert is_unified_provider(TracingProviderEnum.OTEL) is True
    assert is_unified_provider(TracingProviderEnum.PHOENIX) is False
    assert is_unified_provider(TracingProviderEnum.LANGFUSE) is False

    apply_config_overrides(monkeypatch, OPS_TRACE_UNIFIED_ENABLED=True)
    assert unified_dispatch_enabled(TracingProviderEnum.PHOENIX) is True
    assert is_unified_provider(TracingProviderEnum.PHOENIX) is True
    # Registered providers only: the switch does not turn a legacy-only provider unified
    assert is_unified_provider(TracingProviderEnum.LANGFUSE) is False


def test_scope_key_field_is_none_for_unregistered_provider() -> None:
    # Unregistered providers must not fall back to another provider's field name
    assert unified_scope_key_field(TracingProviderEnum.LANGFUSE) is None
    assert unified_scope_key_field("not-a-provider") is None

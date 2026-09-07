"""Lazy registry for providers implemented by the unified tracing path."""

import collections
from typing import TypedDict, override

from core.ops.base_trace_instance import BaseTraceInstance
from core.ops.entities.config_entity import BaseTracingConfig, TracingProviderEnum


class UnifiedProviderConfigEntry(TypedDict):
    config_class: type[BaseTracingConfig]
    trace_instance: type[BaseTraceInstance]


class UnifiedTraceProviderConfigMap(collections.UserDict[str, UnifiedProviderConfigEntry]):
    """Resolve unified providers without importing their SDKs until selected."""

    @override
    def __getitem__(self, key: str) -> UnifiedProviderConfigEntry:
        match key:
            case TracingProviderEnum.PHOENIX:
                from dify_trace_arize_phoenix.config import PhoenixConfig
                from dify_trace_arize_phoenix.unified_trace import UnifiedPhoenixTrace

                return {"config_class": PhoenixConfig, "trace_instance": UnifiedPhoenixTrace}
            case TracingProviderEnum.LANGSMITH:
                from dify_trace_langsmith.config import LangSmithConfig
                from dify_trace_langsmith.unified_trace import UnifiedLangSmithTrace

                return {"config_class": LangSmithConfig, "trace_instance": UnifiedLangSmithTrace}
            case TracingProviderEnum.OTEL:
                from core.ops.unified_trace.otel import OTelTracingConfig, UnifiedOTelTrace

                return {"config_class": OTelTracingConfig, "trace_instance": UnifiedOTelTrace}
            case _:
                raise KeyError(f"Unified tracing provider is not registered: {key}")


unified_provider_config_map = UnifiedTraceProviderConfigMap()


def unified_scope_key_field(tracing_provider: str) -> str | None:
    """Name of the config field a provider uses as its destination scope key.

    Declared here next to the provider entries so generic parent-context code does not
    have to guess the field name, and resolved without importing the provider SDK: it
    runs for the *parent* app's provider, which the current deployment may not install.
    """
    match tracing_provider:
        case TracingProviderEnum.PHOENIX | TracingProviderEnum.LANGSMITH:
            return "project"
        case TracingProviderEnum.OTEL:
            return "service_name"
        case _:
            return None

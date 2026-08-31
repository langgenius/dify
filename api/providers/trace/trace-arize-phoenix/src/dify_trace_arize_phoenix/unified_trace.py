"""Phoenix adapter for the provider-neutral unified tracing runtime."""

from typing import override
from urllib.parse import urlparse

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource

from core.ops.unified_trace.otlp_adapter import OTLPUnifiedAdapter, OTLPUnifiedTrace
from dify_trace_arize_phoenix.config import PhoenixConfig


class UnifiedPhoenixAdapter(OTLPUnifiedAdapter):
    """Translate canonical spans to isolated OpenTelemetry/OpenInference spans."""

    provider_name = "phoenix"

    def __init__(self, config: PhoenixConfig) -> None:
        super().__init__(config, endpoint=config.endpoint, scope_key=config.project or "")

    @override
    def build_headers(self, config: PhoenixConfig) -> dict[str, str]:
        return {
            "api_key": config.api_key or "",
            "authorization": f"Bearer {config.api_key or ''}",
        }

    @override
    def build_resource(self, config: PhoenixConfig) -> Resource:
        return Resource(
            attributes={
                "openinference.project.name": config.project or "",
                "model_id": config.project or "",
            }
        )

    @override
    def build_exporter(self, config: PhoenixConfig) -> OTLPSpanExporter:
        parsed = urlparse(config.endpoint)
        endpoint = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}/v1/traces"
        return OTLPSpanExporter(endpoint=endpoint, headers=self.build_headers(config), timeout=30)


class UnifiedPhoenixTrace(OTLPUnifiedTrace):
    """Fully isolated unified Phoenix trace instance selected by the new registry."""

    adapter_class = UnifiedPhoenixAdapter

    def __init__(self, config: PhoenixConfig) -> None:
        super().__init__(config)

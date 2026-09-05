"""Generic OpenTelemetry tracing provider: export unified traces to a custom OTLP collector."""

import json
import re
from typing import Any, override

from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from pydantic import field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.unified_trace.otlp_adapter import OTLPUnifiedAdapter, OTLPUnifiedTrace
from core.ops.utils import validate_url_with_path


class OTelTracingConfig(BaseTracingConfig):
    endpoint: str
    # Stored as JSON-encoded strings so structured secrets/attrs round-trip with the frontend
    headers: str = "{}"
    service_name: str = "dify"
    resource_attributes: str = "{}"

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, v: str) -> str:
        # Keep the path: users provide the full OTLP/HTTP trace URL (e.g. http://host:4318/v1/traces)
        return validate_url_with_path(v, default_url="http://localhost:4318/v1/traces")

    @field_validator("headers", mode="before")
    @classmethod
    def coerce_headers(cls, v: Any) -> Any:
        # Accept a dict from the frontend or API payload; keep strings (possibly masked or encrypted) as-is
        if isinstance(v, dict):
            return json.dumps(v, default=str, ensure_ascii=False)
        return v

    @classmethod
    def _is_passthrough_secret(cls, v: str) -> bool:
        # Masked display values ("*" in value) and retained base64 ciphertext from
        # encrypt_tracing_config are not user JSON and must pass through untouched
        return "*" in v or bool(re.fullmatch(r"[A-Za-z0-9+/=]+", v or ""))

    @field_validator("headers")
    @classmethod
    def validate_headers(cls, v: str) -> str:
        if not cls._is_passthrough_secret(v):
            json.loads(v)
        return v

    @field_validator("resource_attributes", mode="before")
    @classmethod
    def coerce_resource_attributes(cls, v: Any) -> Any:
        # Tolerate the manager's plaintext default ("") and dict input
        if v is None:
            return "{}"
        if isinstance(v, dict):
            return json.dumps(v, default=str, ensure_ascii=False)
        return v

    @field_validator("resource_attributes")
    @classmethod
    def validate_resource_attributes(cls, v: str) -> str:
        json.loads(v)
        return v

    def parsed_headers(self) -> dict[str, str]:
        # Masked display values never reach real export (the runtime uses decrypted config)
        if "*" in self.headers:
            return {}
        return {str(k): str(v) for k, v in json.loads(self.headers).items()}

    def parsed_resource_attributes(self) -> dict[str, Any]:
        return dict(json.loads(self.resource_attributes))


class UnifiedOTelAdapter(OTLPUnifiedAdapter):
    """Export canonical traces to a user-provided OTLP/HTTP collector endpoint."""

    provider_name = "otel"

    def __init__(self, config: OTelTracingConfig) -> None:
        super().__init__(config, endpoint=config.endpoint, scope_key=config.service_name)

    @override
    def build_headers(self, config: OTelTracingConfig) -> dict[str, str]:
        return config.parsed_headers()

    @override
    def build_resource(self, config: OTelTracingConfig) -> Resource:
        attributes = {"service.name": config.service_name}
        attributes.update(config.parsed_resource_attributes())
        return Resource(attributes=attributes)

    @override
    def build_exporter(self, config: OTelTracingConfig) -> OTLPSpanExporter:
        # Pass the endpoint through untouched: users provide the full OTLP/HTTP trace URL
        return OTLPSpanExporter(endpoint=config.endpoint, headers=self.build_headers(config), timeout=30)


class UnifiedOTelTrace(OTLPUnifiedTrace):
    """Unified trace instance exporting to a custom OTel collector."""

    adapter_class = UnifiedOTelAdapter

    def __init__(self, config: OTelTracingConfig) -> None:
        super().__init__(config)

"""Generic OpenTelemetry tracing provider: export unified traces to a custom OTLP/HTTP collector."""

import json
from typing import Any, override

from opentelemetry.sdk.resources import Resource
from opentelemetry.util.types import AttributeValue
from pydantic import field_validator

from core.helper.encrypter import is_obfuscated_token
from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalTrace
from core.ops.unified_trace.otlp_adapter import OTLPUnifiedAdapter, OTLPUnifiedTrace
from core.ops.unified_trace.parent_context import ParentResolution
from core.ops.utils import validate_project_name, validate_url_with_path

DEFAULT_ENDPOINT = "http://localhost:4318/v1/traces"
DEFAULT_SERVICE_NAME = "dify"

# OpenTelemetry GenAI semantic-convention attributes emitted in addition to the shared
# OpenInference dialect, so generic backends (Jaeger, Tempo, Langfuse, ...) get model and
# token-usage fields as first-class attributes instead of inside the serialized metadata.
_GEN_AI_OPERATION_NAME: dict[CanonicalSpanKind, str] = {
    CanonicalSpanKind.LLM: "chat",
    CanonicalSpanKind.TOOL: "execute_tool",
    CanonicalSpanKind.AGENT: "invoke_agent",
}
_GEN_AI_METADATA_ATTRIBUTES: tuple[tuple[str, str], ...] = (
    ("model_provider", "gen_ai.provider.name"),
    ("model_name", "gen_ai.request.model"),
    ("prompt_tokens", "gen_ai.usage.input_tokens"),
    ("completion_tokens", "gen_ai.usage.output_tokens"),
    ("total_tokens", "gen_ai.usage.total_tokens"),
)


def _load_json_object(value: str, field_name: str) -> dict[str, Any]:
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError(f"{field_name} must be a JSON object")
    return parsed


def _gen_ai_attributes(canonical_span: CanonicalSpan, trace: CanonicalTrace) -> dict[str, AttributeValue]:
    attributes: dict[str, AttributeValue] = {}
    operation_name = _GEN_AI_OPERATION_NAME.get(canonical_span.kind)
    if operation_name:
        attributes["gen_ai.operation.name"] = operation_name
    if canonical_span.kind is CanonicalSpanKind.TOOL and canonical_span.name:
        attributes["gen_ai.tool.name"] = canonical_span.name
    if trace.session_id:
        attributes["gen_ai.conversation.id"] = trace.session_id
    for metadata_key, attribute_key in _GEN_AI_METADATA_ATTRIBUTES:
        value = canonical_span.metadata.get(metadata_key)
        if isinstance(value, bool):
            continue
        if isinstance(value, int) or (isinstance(value, str) and value):
            attributes[attribute_key] = value
    return attributes


class OTelTracingConfig(BaseTracingConfig):
    """Configuration for the generic OTLP/HTTP tracing provider.

    ``headers`` and ``resource_attributes`` are stored as JSON-encoded strings so they
    round-trip through the console form and the per-tenant secret encryption, which only
    handle string values. ``headers`` is the encrypted field: besides user JSON it may
    arrive as the masked display value or as retained ciphertext, both of which must pass
    through validation untouched.
    """

    endpoint: str
    headers: str = "{}"
    service_name: str = DEFAULT_SERVICE_NAME
    resource_attributes: str = "{}"

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, v: str) -> str:
        # Keep the path: users provide the full OTLP/HTTP trace URL (e.g. http://host:4318/v1/traces)
        return validate_url_with_path(v, default_url=DEFAULT_ENDPOINT)

    @field_validator("service_name")
    @classmethod
    def validate_service_name(cls, v: str) -> str:
        return validate_project_name(v, DEFAULT_SERVICE_NAME)

    @field_validator("headers", mode="before")
    @classmethod
    def coerce_headers(cls, v: Any) -> Any:
        if v is None or v == "":
            return "{}"
        if isinstance(v, dict):
            return json.dumps(v, default=str, ensure_ascii=False)
        return v

    @field_validator("headers")
    @classmethod
    def validate_headers(cls, v: str) -> str:
        if is_obfuscated_token(v):
            return v
        if v.lstrip().startswith("{"):
            _load_json_object(v, "headers")
        # Anything else is opaque ciphertext retained by encrypt_tracing_config
        return v

    @field_validator("resource_attributes", mode="before")
    @classmethod
    def coerce_resource_attributes(cls, v: Any) -> Any:
        # Tolerate the manager's plaintext default ("") and dict input
        if v is None or v == "":
            return "{}"
        if isinstance(v, dict):
            return json.dumps(v, default=str, ensure_ascii=False)
        return v

    @field_validator("resource_attributes")
    @classmethod
    def validate_resource_attributes(cls, v: str) -> str:
        _load_json_object(v, "resource_attributes")
        return v

    def parsed_headers(self) -> dict[str, str]:
        if is_obfuscated_token(self.headers):
            raise ValueError("headers are masked; use the decrypted tracing config")
        return {str(key): str(value) for key, value in _load_json_object(self.headers, "headers").items()}

    def parsed_resource_attributes(self) -> dict[str, Any]:
        return _load_json_object(self.resource_attributes, "resource_attributes")


class UnifiedOTelAdapter(OTLPUnifiedAdapter[OTelTracingConfig]):
    """Export canonical traces to a user-provided OTLP/HTTP collector endpoint."""

    provider_name = "otel"

    def __init__(self, config: OTelTracingConfig) -> None:
        super().__init__(config, endpoint=config.endpoint, scope_key=config.service_name)

    @override
    def build_headers(self, config: OTelTracingConfig) -> dict[str, str]:
        return config.parsed_headers()

    @override
    def build_resource(self, config: OTelTracingConfig) -> Resource:
        # Resource.create merges the SDK defaults (telemetry.sdk.*) and OTEL_RESOURCE_ATTRIBUTES
        attributes: dict[str, Any] = {"service.name": config.service_name}
        attributes.update(config.parsed_resource_attributes())
        return Resource.create(attributes)

    @override
    def attributes(
        self,
        canonical_span: CanonicalSpan,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
    ) -> dict[str, AttributeValue]:
        attributes = super().attributes(canonical_span, trace, parent)
        attributes.update(_gen_ai_attributes(canonical_span, trace))
        return attributes


class UnifiedOTelTrace(OTLPUnifiedTrace):
    """Unified trace instance exporting to a custom OTel collector."""

    adapter_class = UnifiedOTelAdapter

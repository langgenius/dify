import os
from typing import Any, override
from urllib.parse import urlsplit

from opentelemetry.sdk.trace import SpanLimits
from opentelemetry.sdk.trace.sampling import Decision, ParentBased, Sampler, StaticSampler, TraceIdRatioBased
from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig


def create_trace_sampler(sampling: dict[str, Any]) -> Sampler:
    """Construct the captured native sampler without consulting the worker environment."""
    name = sampling.get("name", "parentbased_always_on")
    root: Sampler
    if name in {"traceidratio", "parentbased_traceidratio"}:
        root = TraceIdRatioBased(sampling.get("ratio", 1.0))
    else:
        root = StaticSampler(
            Decision.DROP if name in {"always_off", "parentbased_always_off"} else Decision.RECORD_AND_SAMPLE
        )
    return ParentBased(root) if name.startswith("parentbased_") else root


def load_trace_sampling() -> dict[str, Any]:
    """Preserve native name, fallback and ratio validation when settings are captured."""
    name = os.environ.get("OTEL_TRACES_SAMPLER", "parentbased_always_on").lower()
    if name not in {
        "always_on",
        "always_off",
        "traceidratio",
        "parentbased_always_on",
        "parentbased_always_off",
        "parentbased_traceidratio",
    }:
        name = "parentbased_always_on"
    sampling: dict[str, Any] = {"name": name}
    if name in {"traceidratio", "parentbased_traceidratio"}:
        try:
            ratio = float(os.environ.get("OTEL_TRACES_SAMPLER_ARG", ""))
        except ValueError:
            ratio = 1.0
        # The SDK rejects out-of-range and non-finite numeric values.
        sampling["ratio"] = TraceIdRatioBased(ratio).rate
    return sampling


def load_span_attribute_limits() -> dict[str, int | None]:
    """Capture explicit deployment limits while retaining complete attributes by default."""
    count_configured = any(
        name in os.environ for name in ("OTEL_ATTRIBUTE_COUNT_LIMIT", "OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT")
    )
    length_configured = any(
        name in os.environ for name in ("OTEL_ATTRIBUTE_VALUE_LENGTH_LIMIT", "OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT")
    )
    if not count_configured and not length_configured:
        return {}
    limits = SpanLimits()
    return {
        "max_attributes": limits.max_span_attributes if count_configured else None,
        "max_value_length": limits.max_span_attribute_length if length_configured else None,
    }


class TencentConfig(BaseTracingConfig):
    """
    Tencent APM tracing config
    """

    token: str
    endpoint: str
    service_name: str

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("token",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        endpoint = cls.model_validate(provider_config).endpoint
        protocol = os.environ.get("OTEL_EXPORTER_OTLP_PROTOCOL", "").strip().lower()
        # The old SDK used HTTP/protobuf when an optional JSON exporter was unavailable.
        http_metrics = protocol in {"http/protobuf", "http-protobuf", "http/json", "http-json"}
        metrics_request_timeout = float(
            os.environ.get("OTEL_EXPORTER_OTLP_METRICS_TIMEOUT", os.environ.get("OTEL_EXPORTER_OTLP_TIMEOUT", "10"))
        )
        if not http_metrics and not metrics_request_timeout:
            # The gRPC exporter treats a zero signal timeout as unset.
            metrics_request_timeout = float(os.environ.get("OTEL_EXPORTER_OTLP_TIMEOUT", "10"))
        settings: dict[str, Any] = {
            "disabled": os.environ.get("OTEL_SDK_DISABLED", "").lower().strip() == "true",
            "sampling": load_trace_sampling(),
            "span_limits": load_span_attribute_limits(),
            "metrics_protocol": "http/protobuf" if http_metrics else "grpc",
            "metrics_verify": True,
            "metrics_request_timeout": str(metrics_request_timeout),
        }
        for signal, env_signal in (("trace", "TRACES"), ("metrics", "METRICS")):
            tls = {}
            if urlsplit(endpoint).scheme == "https":
                prefix = f"OTEL_EXPORTER_OTLP_{env_signal}_"
                if signal == "metrics" and http_metrics:
                    filenames = {
                        field: os.environ.get(
                            prefix + field.upper(), os.environ.get("OTEL_EXPORTER_OTLP_" + field.upper())
                        )
                        for field in ("certificate", "client_key", "client_certificate")
                    }
                    if filenames["certificate"] is None:
                        filenames["certificate"] = (
                            os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE") or None
                        )
                    if not filenames["client_certificate"]:
                        filenames["client_key"] = None
                    settings["metrics_verify"] = filenames["certificate"] != ""
                else:
                    # gRPC chooses an entire signal-specific set only when its CA is set.
                    if os.environ.get(prefix + "CERTIFICATE") is None:
                        prefix = "OTEL_EXPORTER_OTLP_"
                    filenames = (
                        {
                            field: os.environ.get(prefix + field.upper())
                            for field in ("certificate", "client_key", "client_certificate")
                        }
                        if os.environ.get(prefix + "CERTIFICATE")
                        else {}
                    )
                tls = read_tls_files(filenames, allow_ca_directory=signal == "metrics" and http_metrics)
            settings[signal + "_tls"] = tls
        return settings

    @field_validator("token")
    @classmethod
    def token_validator(cls, v, info: ValidationInfo):
        if not v or v.strip() == "":
            raise ValueError("Token cannot be empty")
        return v

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        return cls.validate_endpoint_url(v, "https://apm.tencentcloudapi.com")

    @field_validator("service_name")
    @classmethod
    def service_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "dify_app")

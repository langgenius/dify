import os
from typing import Any, override
from urllib.parse import urlsplit

from opentelemetry.sdk.trace import SpanLimits
from opentelemetry.sdk.trace.sampling import ALWAYS_OFF, ALWAYS_ON, ParentBased, Sampler, TraceIdRatioBased
from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


def create_sampler(name: str = "parentbased_always_on", ratio: float = 1.0) -> Sampler:
    root = (
        TraceIdRatioBased(ratio)
        if name in {"traceidratio", "parentbased_traceidratio"}
        else ALWAYS_OFF
        if name in {"always_off", "parentbased_always_off"}
        else ALWAYS_ON
    )
    return ParentBased(root) if name.startswith("parentbased_") else root


def load_sampling_settings() -> dict[str, Any]:
    """Capture the SDK's six built-in samplers without retaining ambient state."""
    name = os.environ.get("OTEL_TRACES_SAMPLER", "parentbased_always_on").lower()
    if name not in {
        "always_on",
        "always_off",
        "parentbased_always_on",
        "parentbased_always_off",
        "traceidratio",
        "parentbased_traceidratio",
    }:
        name = "parentbased_always_on"
    ratio = 1.0
    if name in {"traceidratio", "parentbased_traceidratio"}:
        try:
            ratio = float(os.environ.get("OTEL_TRACES_SAMPLER_ARG", ""))
        except (ValueError, TypeError):
            pass
    # Native construction rejects numeric values outside [0, 1], including NaN.
    create_sampler(name, ratio)
    return {"name": name, "ratio": ratio}


def load_span_limits() -> dict[str, int | None]:
    """Retain explicitly configured SDK limits without imposing its default count cap."""
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


class ArizeConfig(BaseTracingConfig):
    """
    Model class for Arize tracing config.
    """

    api_key: str | None = None
    space_id: str | None = None
    project: str | None = None
    endpoint: str = "https://otlp.arize.com"

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("api_key", "space_id")

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        endpoint = cls.model_validate(provider_config).endpoint
        trace_insecure = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_INSECURE")
        insecure_setting = (
            trace_insecure if trace_insecure is not None else os.environ.get("OTEL_EXPORTER_OTLP_INSECURE")
        )
        insecure = urlsplit(endpoint).scheme != "https" and (
            insecure_setting is None or insecure_setting.lower() == "true"
        )
        # The SDK selects trace credentials before HTTPS overrides its insecure flag.
        prefix = (
            "OTEL_EXPORTER_OTLP_TRACES"
            if (trace_insecure or "").lower() != "true"
            and os.environ.get("OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE") is not None
            else "OTEL_EXPORTER_OTLP"
        )
        tls = (
            read_tls_files(
                {
                    field: os.environ.get(f"{prefix}_{field.upper()}")
                    for field in ("certificate", "client_key", "client_certificate")
                }
            )
            if not insecure and os.environ.get(f"{prefix}_CERTIFICATE")
            else {}
        )
        return {
            "insecure": insecure,
            "tls": tls,
            "disabled": os.environ.get("OTEL_SDK_DISABLED", "").lower().strip() == "true",
            "sampling": load_sampling_settings(),
            "span_limits": load_span_limits(),
        }

    @field_validator("project")
    @classmethod
    def project_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "default")

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        return cls.validate_endpoint_url(v, "https://otlp.arize.com")


class PhoenixConfig(BaseTracingConfig):
    """
    Model class for Phoenix tracing config.
    """

    api_key: str | None = None
    project: str | None = None
    endpoint: str = "https://app.phoenix.arize.com"

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("api_key",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        disabled = os.environ.get("OTEL_SDK_DISABLED", "").lower().strip() == "true"
        sampling = load_sampling_settings()
        span_limits = load_span_limits()
        if urlsplit(cls.model_validate(provider_config).endpoint).scheme != "https":
            return {"tls": {}, "verify": True, "disabled": disabled, "sampling": sampling, "span_limits": span_limits}
        filenames = {
            field: os.environ.get(
                f"OTEL_EXPORTER_OTLP_TRACES_{field.upper()}", os.environ.get(f"OTEL_EXPORTER_OTLP_{field.upper()}")
            )
            for field in ("certificate", "client_key", "client_certificate")
        }
        if filenames["certificate"] is None:
            filenames["certificate"] = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE") or None
        if not filenames["client_certificate"]:
            filenames["client_key"] = None
        return {
            "tls": read_tls_files(filenames, allow_ca_directory=True),
            "verify": filenames["certificate"] != "",
            "disabled": disabled,
            "sampling": sampling,
            "span_limits": span_limits,
        }

    @field_validator("project")
    @classmethod
    def project_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "default")

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        return validate_url_with_path(v, "https://app.phoenix.arize.com")

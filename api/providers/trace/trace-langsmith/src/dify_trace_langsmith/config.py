import json
import math
import os
from pathlib import Path
from typing import Any, override
from urllib.parse import urlsplit

from opentelemetry.sdk.trace import SpanLimits
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
from pydantic import ValidationInfo, field_validator
from requests import Request, Session
from requests.utils import urldefragauth

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


def _read_environment_setting(name: str, default: str = "") -> str:
    return next(
        (
            value
            for prefix in ("LANGSMITH", "LANGCHAIN")
            if (value := os.environ.get(f"{prefix}_{name}")) and value.strip()
        ),
        default,
    )


def _load_otel_settings() -> dict[str, Any]:
    # LangSmith passes this URL explicitly to the HTTP exporter, without appending /v1/traces.
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or (
        _read_environment_setting("ENDPOINT", "https://api.smith.langchain.com")
        .strip()
        .strip('"')
        .strip("'")
        .rstrip("/")
        + "/otel"
    )
    headers_text = os.environ.get("OTEL_EXPORTER_OTLP_HEADERS")
    headers = (
        {
            key.strip(): value.strip()
            for pair in headers_text.split(",")
            if "=" in pair
            for key, value in [pair.split("=", 1)]
        }
        if headers_text
        else {"x-api-key": _read_environment_setting("API_KEY").strip().strip('"').strip("'")}
    )
    if not headers_text and (
        project := os.environ.get(
            "HOSTED_LANGSERVE_PROJECT_NAME",
            _read_environment_setting("PROJECT", _read_environment_setting("SESSION", "default")),
        )
    ):
        headers["Langsmith-Project"] = project
    with Session() as session:
        session.headers.clear()
        headers = {
            key: value.decode("latin-1") if isinstance(value, bytes) else value
            for key, value in session.prepare_request(Request("GET", endpoint, headers=headers)).headers.items()
        }
    certificate = os.environ.get(
        "OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE", os.environ.get("OTEL_EXPORTER_OTLP_CERTIFICATE")
    )
    if certificate is None:
        certificate = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")
    compression = (
        os.environ.get(
            "OTEL_EXPORTER_OTLP_TRACES_COMPRESSION", os.environ.get("OTEL_EXPORTER_OTLP_COMPRESSION", "none")
        )
        .lower()
        .strip()
    )
    if compression not in {"none", "gzip", "deflate"}:
        raise ValueError("Invalid LangSmith OTel compression")
    sampler = os.environ.get("OTEL_TRACES_SAMPLER", "parentbased_always_on").lower()
    if sampler not in {
        "always_on",
        "always_off",
        "parentbased_always_on",
        "parentbased_always_off",
        "traceidratio",
        "parentbased_traceidratio",
    }:
        sampler = "parentbased_always_on"
    ratio = 1.0
    if sampler.endswith("traceidratio"):
        try:
            ratio = float(os.environ.get("OTEL_TRACES_SAMPLER_ARG", ""))
        except ValueError:
            pass
        TraceIdRatioBased(ratio)
    limits = SpanLimits()
    return {
        "endpoint": urldefragauth(endpoint),
        "headers": {key.strip(): value.strip() for key, value in headers.items()},
        "service_name": os.environ.get("OTEL_SERVICE_NAME", "langsmith"),
        "request_timeout": str(
            float(
                os.environ.get("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", os.environ.get("OTEL_EXPORTER_OTLP_TIMEOUT", "10"))
            )
        ),
        "compression": compression,
        "disabled": os.environ.get("OTEL_SDK_DISABLED", "").lower().strip() == "true",
        "sampler": sampler,
        "sampling_ratio": ratio,
        "span_limits": {
            "max_attributes": limits.max_span_attributes,
            "max_value_length": limits.max_span_attribute_length,
        },
        "event_limits": {
            "max_events": limits.max_events,
            "max_attributes": limits.max_event_attributes,
            "max_value_length": limits.max_attribute_length,
        },
        "verify": certificate != "",
        "tls": (
            read_tls_files(
                {
                    "certificate": certificate,
                    **{
                        name: os.environ.get(
                            f"OTEL_EXPORTER_OTLP_TRACES_{suffix}", os.environ.get(f"OTEL_EXPORTER_OTLP_{suffix}")
                        )
                        for name, suffix in (("client_certificate", "CLIENT_CERTIFICATE"), ("client_key", "CLIENT_KEY"))
                    },
                },
                allow_ca_directory=True,
            )
            if urlsplit(endpoint).scheme == "https"
            else {}
        ),
    }


class LangSmithConfig(BaseTracingConfig):
    """
    Model class for Langsmith tracing config.
    """

    api_key: str
    project: str
    endpoint: str = "https://api.smith.langchain.com"

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("api_key",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        config = cls.model_validate(provider_config)
        # Requests resolves NETRC before URL userinfo and encodes Basic auth itself.
        with Session() as session:
            authorization = session.prepare_request(Request("GET", config.endpoint)).headers.get("Authorization")
        mode = _read_environment_setting("TRACING_MODE").lower() or (
            "otel"
            if _read_environment_setting("OTEL_ONLY").lower() in {"true", "1"}
            else "hybrid"
            if _read_environment_setting("OTEL_ENABLED").lower() in {"true", "1"}
            else "langsmith"
        )
        if mode not in {"langsmith", "otel", "hybrid"}:
            raise ValueError("Invalid LangSmith tracing mode")
        sampling_rate = float(_read_environment_setting("TRACING_SAMPLING_RATE", "1"))
        if sampling_rate < 0 or sampling_rate > 1:
            raise ValueError("LangSmith tracing sampling rate must be between 0 and 1")
        workspace_id = _read_environment_setting("WORKSPACE_ID") or None
        if workspace_id is None:
            path = Path(os.environ.get("LANGSMITH_CONFIG_FILE") or Path.home() / ".langsmith" / "config.json")
            try:
                profile_config = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                profile_config = {}
            if isinstance(profile_config, dict) and isinstance(profiles := profile_config.get("profiles"), dict):
                profile_name = os.environ.get("LANGSMITH_PROFILE") or profile_config.get("current_profile") or "default"
                profile = profiles.get(profile_name) if isinstance(profile_name, str) else None
                if isinstance(profile, dict) and isinstance(profile.get("workspace_id"), str):
                    workspace_id = profile["workspace_id"]
        certificate = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")
        return {
            "mode": mode,
            **({"otel": _load_otel_settings()} if mode != "langsmith" else {}),
            "authorization": authorization,
            # The SDK accepts NaN, whose sampling comparisons always drop. Keep the snapshot JSON-safe.
            "sampling_rate": 0.0 if math.isnan(sampling_rate) else sampling_rate,
            **{
                name.lower(): _read_environment_setting(name) == "true"
                for name in ("HIDE_INPUTS", "HIDE_OUTPUTS", "HIDE_METADATA")
            },
            "workspace_id": workspace_id.strip().strip('"').strip("'") if workspace_id else None,
            "tls": read_tls_files({"certificate": certificate}, allow_ca_directory=True),
        }

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # LangSmith only allows HTTPS; self-hosted deployments may sit under a path prefix
        return validate_url_with_path(v, "https://api.smith.langchain.com", allowed_schemes=("https",))

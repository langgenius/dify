import os
from typing import Any, override
from urllib.parse import urlsplit

from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig


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

import os
from typing import Any, override
from urllib.parse import urlsplit

from opentelemetry.util.re import _LIBERAL_HEADER_PATTERN, parse_env_headers
from pydantic import ValidationInfo, field_validator

from core.helper.ssl_context import read_tls_files
from core.ops.provider_config import BaseTracingConfig
from core.ops.utils import validate_url_with_path


class AliyunConfig(BaseTracingConfig):
    """
    Model class for Aliyun tracing config.
    """

    app_name: str = "dify_app"
    license_key: str
    endpoint: str

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("license_key",)

    @classmethod
    @override
    def load_runtime_settings(cls, provider_config: dict[str, Any]) -> dict[str, Any]:
        endpoint = cls.model_validate(provider_config).endpoint
        request_timeout = float(
            os.environ.get("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT", os.environ.get("OTEL_EXPORTER_OTLP_TIMEOUT", "10"))
        )
        raw_headers = os.environ.get(
            "OTEL_EXPORTER_OTLP_TRACES_HEADERS", os.environ.get("OTEL_EXPORTER_OTLP_HEADERS", "")
        )
        # The SDK logs malformed headers; filter with its grammar before parsing secrets.
        headers = ",".join(
            header for header in raw_headers.split(",") if _LIBERAL_HEADER_PATTERN.fullmatch(header.strip())
        )
        tls = {}
        verify = True
        if urlsplit(endpoint).scheme == "https":
            filenames = {
                field: os.environ.get(
                    f"OTEL_EXPORTER_OTLP_TRACES_{field.upper()}",
                    os.environ.get(f"OTEL_EXPORTER_OTLP_{field.upper()}"),
                )
                for field in ("certificate", "client_key", "client_certificate")
            }
            if filenames["certificate"] is None:
                filenames["certificate"] = (
                    os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE") or None
                )
            if not filenames["client_certificate"]:
                # The old HTTP exporter ignored a key when it had no client certificate.
                filenames["client_key"] = None
            verify = filenames["certificate"] != ""
            tls = read_tls_files(filenames, allow_ca_directory=True)
        return {
            "headers": parse_env_headers(headers, liberal=True),
            "tls": tls,
            "verify": verify,
            "request_timeout": str(request_timeout),
        }

    @field_validator("app_name")
    @classmethod
    def app_name_validator(cls, v, info: ValidationInfo):
        return cls.validate_project_field(v, "dify_app")

    @field_validator("license_key")
    @classmethod
    def license_key_validator(cls, v, info: ValidationInfo):
        if not v or v.strip() == "":
            raise ValueError("License key cannot be empty")
        return v

    @field_validator("endpoint")
    @classmethod
    def endpoint_validator(cls, v, info: ValidationInfo):
        # aliyun uses two URL formats, which may include a URL path
        return validate_url_with_path(v, "https://tracing-analysis-dc-hz.aliyuncs.com")

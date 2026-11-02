"""Aliyun destinations and a resource-only, zero-span collector access check.

GET and URL helpers are pure. Verification makes one explicit collector request;
it never constructs a tracer, creates span IDs, or exports business telemetry.
"""

import re
from collections.abc import Mapping
from typing import Literal
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from dify_trace_aliyun.config import AliyunConfig

type ConfigurationCode = Literal["invalid_endpoint", "invalid_app_name", "invalid_license_key", "verification_failed"]
_MESSAGES: dict[ConfigurationCode, str] = {
    "invalid_endpoint": "Aliyun requires an HTTP(S) base URL without credentials or a collector suffix.",
    "invalid_app_name": "Aliyun requires an application name without control characters.",
    "invalid_license_key": "Aliyun requires a nonempty license key without whitespace or control characters.",
    "verification_failed": "Aliyun tracing configuration could not be verified.",
}
_DEFAULT_ENDPOINT = "https://tracing-analysis-dc-hz.aliyuncs.com"


class AliyunConfigurationError(ValueError):
    """Diagnostics never include submitted URLs, credentials, or response bodies."""

    def __init__(self, code: ConfigurationCode) -> None:
        self.code = code
        super().__init__(_MESSAGES[code])


def _endpoint(value: object) -> str:
    if not isinstance(value, str):
        raise AliyunConfigurationError("invalid_endpoint")
    value = value.strip(" ") or _DEFAULT_ENDPOINT
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        path = parsed.path.rstrip("/")
        # Decode only the public path to detect hidden collector routes. License
        # keys are opaque values and must never be unquoted or otherwise altered.
        decoded_path = unquote(path, errors="strict")
        valid = (
            parsed.scheme in {"http", "https"}
            and host
            and parsed.username is None
            and parsed.password is None
            and "?" not in value
            and "#" not in value
            and "\\" not in value
            and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
            and not parsed.netloc.endswith(":")
            and (port is None or 1 <= port <= 65535)
            and "%" not in host
            and not re.search(r"%(?![0-9a-fA-F]{2})", path)
            and not re.search(r"%(?:2f|5c)", path, re.IGNORECASE)
            and not any(char in decoded_path for char in "\\?#%")
            and not any(ord(char) < 32 or ord(char) == 127 for char in decoded_path)
            and "//" not in parsed.path
            and not any(part in {".", ".."} or part.lower().startswith("adapt_") for part in decoded_path.split("/"))
            and not decoded_path.lower().endswith(("/v1/traces", "/api/otlp/traces"))
        )
        if not valid or host is None:
            raise AliyunConfigurationError("invalid_endpoint")
        host = host.encode("idna").decode("ascii").lower()
        authority = f"[{host}]" if ":" in host else host
        if port is not None:
            authority = f"{authority}:{port}"
        return urlunsplit((parsed.scheme, authority, path, "", ""))
    except (UnicodeError, ValueError):
        raise AliyunConfigurationError("invalid_endpoint") from None


def _license_key(value: object) -> str:
    if (
        not isinstance(value, str)
        or not value
        or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
    ):
        raise AliyunConfigurationError("invalid_license_key")
    try:
        value.encode("utf-8")
    except UnicodeError:
        raise AliyunConfigurationError("invalid_license_key") from None
    return value


def normalize_configuration(values: Mapping[str, object]) -> AliyunConfig:
    """Validate new writes without tightening the model used for historical GET.

    Masked keys survive this phase so the gateway can restore the original
    ciphertext on PATCH. Exporters reject masks after that restoration.
    """
    name = values.get("app_name", "dify_app")
    if not isinstance(name, str) or any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise AliyunConfigurationError("invalid_app_name")
    return AliyunConfig(
        app_name=name.strip() or "dify_app",
        license_key=_license_key(values.get("license_key")),
        endpoint=_endpoint(values.get("endpoint")),
    )


def ingestion_url(config: Mapping[str, object]) -> str:
    """Build one destination, encoding the raw license exactly once as a path segment."""
    normalized = normalize_configuration(config)
    if "*" in normalized.license_key:
        raise AliyunConfigurationError("invalid_license_key")
    hostname = (urlsplit(normalized.endpoint).hostname or "").removesuffix(".")
    is_sls = hostname == "log.aliyuncs.com" or hostname.endswith(".log.aliyuncs.com")
    suffix = "api/v1/traces" if is_sls else "api/otlp/traces"
    # Aliyun's documented path-form token contains literal '@'. RFC 3986 path
    # segments permit it, and this collector does not treat '%40' equivalently.
    # Preserve only that required reserved character; never unquote raw keys.
    return f"{normalized.endpoint}/adapt_{quote(normalized.license_key, safe='@')}/{suffix}"


def console_url() -> str:
    """Return the platform console, not a destination-specific project or trace link."""
    return "https://arms.console.aliyun.com/#/llm"


def verify_configuration(config: AliyunConfig) -> None:
    """Check access with one resource envelope and strictly zero scopes/spans.

    This collector distinguishes valid from invalid licenses for this request;
    HEAD 405 and a completely empty request are not verification. A successful
    acknowledgment does not establish business-span retention or queryability.
    """
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest

    from services.tracing.otlp_export import is_aliyun_http_success_ack
    from services.tracing.provider_common import request

    normalized = normalize_configuration(config.model_dump())
    url = ingestion_url(normalized.model_dump())
    payload = ExportTraceServiceRequest()
    resource = payload.resource_spans.add().resource
    resource.attributes.add(key="service.name").value.string_value = normalized.app_name
    try:
        response = request(
            "POST",
            url,
            "aliyun",
            headers={"Content-Type": "application/x-protobuf", "Accept": "application/x-protobuf"},
            content=payload.SerializeToString(),
        )
        try:
            # Only the account-tested resource-only ACK establishes this check.
            # A generic empty OTLP ACK remains valid for ordinary export, but
            # cannot be substituted as evidence that this license was checked.
            if not is_aliyun_http_success_ack(response.status_code, response.content):
                raise AliyunConfigurationError("verification_failed")
        finally:
            response.close()
    except Exception:
        # No URL, LicenseKey, vendor body, or nested transport exception escapes.
        raise AliyunConfigurationError("verification_failed") from None

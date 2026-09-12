"""Capture MLflow's separate collector route without creating an SDK tracer provider."""

import gzip
import os
import zlib
from typing import Any, override
from urllib.parse import unquote, urlsplit, urlunsplit

from opentelemetry.exporter.otlp.proto.http import _OTLP_HTTP_HEADERS
from opentelemetry.util.re import _LIBERAL_HEADER_PATTERN, parse_env_headers
from requests import Request, Session
from requests.structures import CaseInsensitiveDict
from requests.utils import urldefragauth

from core.helper.ssl_context import create_grpc_credentials, read_tls_files
from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import TraceExportError
from dify_trace_mlflow.otlp_auth import capture_credential_provider, load_credential_provider, send_collector_request
from dify_trace_mlflow.request_auth import capture_netrc_auth


def _read_boolean(name: str, default: bool) -> bool:
    value = os.environ.get(name, str(default)).lower()
    if value not in {"true", "false", "1", "0"}:
        raise ValueError(f"Invalid {name} setting")
    return value in {"true", "1"}


def _capture_resource_attributes() -> dict[str, str]:
    # Preserve the pinned native SDK's collector resource without changing process environment.
    attributes = {
        "telemetry.sdk.language": "python",
        "telemetry.sdk.name": "mlflow",
        "telemetry.sdk.version": "3.11.1",
    }
    resource_text = os.environ.get("OTEL_RESOURCE_ATTRIBUTES")
    service_name = os.environ.get("OTEL_SERVICE_NAME")
    if resource_text or service_name:
        try:
            configured = {
                key.strip(): unquote(value.strip())
                for item in (resource_text or "").split(",")
                for key, value in [item.split("=", maxsplit=1)]
            }
        except ValueError:
            configured = {}
        attributes = {**configured, **attributes}
        attributes["service.name"] = service_name or attributes.get("service.name") or "unknown_service"
    return attributes


def capture_otlp_settings() -> dict[str, Any]:
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
    if not endpoint and (base_endpoint := os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")):
        endpoint = base_endpoint.rstrip("/") + "/v1/traces"
    if not endpoint or not _read_boolean("MLFLOW_ENABLE_OTLP_EXPORTER", True):
        return {}
    protocol = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL") or os.environ.get(
        "OTEL_EXPORTER_OTLP_PROTOCOL", "grpc"
    )
    if protocol not in {"grpc", "http/protobuf"}:
        raise ValueError("Invalid MLflow OTLP protocol")
    prefix = "OTEL_EXPORTER_OTLP_TRACES_"
    common_prefix = "OTEL_EXPORTER_OTLP_"
    raw_headers = os.environ.get(prefix + "HEADERS", os.environ.get(common_prefix + "HEADERS", ""))
    timeout = float(os.environ.get(prefix + "TIMEOUT", os.environ.get(common_prefix + "TIMEOUT", "10")))
    if protocol == "grpc":
        raw_headers = raw_headers or os.environ.get(common_prefix + "HEADERS", "")
        timeout = timeout or float(os.environ.get(common_prefix + "TIMEOUT", "10"))
    # Native parsing logs rejected text. Filter with its grammar before parsing credentials.
    valid_headers = ",".join(
        header for header in raw_headers.split(",") if _LIBERAL_HEADER_PATTERN.fullmatch(header.strip())
    )
    headers = parse_env_headers(valid_headers, liberal=True)
    raw_compression = os.environ.get(prefix + "COMPRESSION", os.environ.get(common_prefix + "COMPRESSION"))
    compression = raw_compression.lower().strip() if raw_compression is not None else "none"
    if (protocol == "grpc" and raw_compression is not None and compression != "gzip") or (
        protocol != "grpc" and compression not in {"none", "gzip", "deflate"}
    ):
        raise ValueError("Invalid MLflow OTLP compression")
    tls_files: dict[str, str | None] = {}
    verify = True
    credential_provider = None
    grpc_target = None
    requests_tls = {}
    requests_tls_read_failed = False
    use_requests_ca = False
    use_session_certificate = False
    if protocol == "grpc":
        parsed = urlsplit(endpoint if "://" in endpoint else "//" + endpoint)
        grpc_target = parsed.netloc or endpoint
        if parsed.scheme == "dns":
            grpc_target = endpoint
            parsed = urlsplit("//" + parsed.path.lstrip("/"))
        insecure = os.environ.get(prefix + "INSECURE", os.environ.get(common_prefix + "INSECURE"))
        secure = parsed.scheme == "https" or (
            insecure.lower() != "true" if insecure is not None else parsed.scheme != "http"
        )
        # gRPC's portless DNS targets use 443, including on insecure channels.
        netloc = parsed.netloc if parsed.port is not None else parsed.netloc + ":443"
        endpoint = urlunsplit(("https" if secure else "http", netloc, parsed.path, parsed.query, ""))
        if secure:
            tls_prefix = (
                prefix
                if os.environ.get(prefix + "CERTIFICATE") is not None
                and os.environ.get(prefix + "INSECURE", "").lower() != "true"
                else common_prefix
            )
            credential_provider = capture_credential_provider(
                os.environ.get(
                    "OTEL_PYTHON_EXPORTER_OTLP_GRPC_TRACES_CREDENTIAL_PROVIDER"
                    if tls_prefix == prefix
                    else "OTEL_PYTHON_EXPORTER_OTLP_GRPC_CREDENTIAL_PROVIDER"
                )
            )
            if credential_provider is None and os.environ.get(tls_prefix + "CERTIFICATE"):
                tls_files = {
                    field: os.environ.get(tls_prefix + field.upper())
                    for field in ("certificate", "client_certificate", "client_key")
                }
    else:
        # Requests resolves netrc and URL auth independently of MLflow tracking credentials.
        with Session() as session:
            session.trust_env = False
            session.headers.clear()
            prepared = session.prepare_request(Request("GET", endpoint, headers=headers))
            headers = {
                key: value.decode("latin-1") if isinstance(value, bytes) else value
                for key, value in prepared.headers.items()
            }
            endpoint = urldefragauth(prepared.url or endpoint)
        credential_provider = capture_credential_provider(
            os.environ.get("OTEL_PYTHON_EXPORTER_OTLP_HTTP_CREDENTIAL_PROVIDER")
            or os.environ.get("OTEL_PYTHON_EXPORTER_OTLP_HTTP_TRACES_CREDENTIAL_PROVIDER")
        )
        http_headers = CaseInsensitiveDict(_OTLP_HTTP_HEADERS, **headers)
        if compression != "none":
            http_headers["Content-Encoding"] = compression
        headers = dict(http_headers)
        tls_files = {
            field: os.environ.get(prefix + field.upper(), os.environ.get(common_prefix + field.upper()))
            for field in ("certificate", "client_certificate", "client_key")
        }
        verify = tls_files["certificate"] != ""
        use_session_certificate = tls_files["client_certificate"] is None
        if not tls_files["client_certificate"]:
            tls_files["client_key"] = None
        use_requests_ca = tls_files["certificate"] is None
        if use_requests_ca:
            try:
                requests_tls = read_tls_files(
                    {"certificate": os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("CURL_CA_BUNDLE")},
                    allow_ca_directory=True,
                )
            except ValueError:
                requests_tls_read_failed = True
    tls_read_failed = False
    try:
        tls = read_tls_files(tls_files, allow_ca_directory=protocol != "grpc")
    except ValueError:
        if protocol == "grpc":
            raise
        # HTTP redirects may eventually need TLS. Missing files cannot break a request that remains HTTP.
        tls = {}
        tls_read_failed = True
    return {
        "endpoint": endpoint,
        "protocol": protocol,
        "headers": headers,
        "request_timeout": str(timeout),
        "compression": compression,
        "tls": tls,
        "tls_read_failed": tls_read_failed,
        "requests_tls": requests_tls,
        "requests_tls_read_failed": requests_tls_read_failed,
        "use_requests_ca": use_requests_ca,
        "use_session_certificate": use_session_certificate,
        "verify": verify,
        "dual_export": _read_boolean("MLFLOW_TRACE_ENABLE_OTLP_DUAL_EXPORT", False),
        "genai_semconv": _read_boolean("MLFLOW_ENABLE_OTEL_GENAI_SEMCONV", False),
        "resource_attributes": _capture_resource_attributes(),
        "credential_provider": credential_provider,
        "netrc_auth": capture_netrc_auth() if protocol != "grpc" else {},
        "grpc_target": grpc_target,
    }


class MLflowOtlpClient(OtlpTraceClient):
    def __init__(self, settings: dict[str, Any], project_url: str):
        self.settings = settings
        self.compression = settings["compression"]
        protocol = settings["protocol"]
        grpc_credentials = None
        grpc_compression = None
        if protocol == "grpc":
            import grpc  # pyrefly: ignore[untyped-import]

            grpc_credentials = (
                load_credential_provider(provider)
                if (provider := settings.get("credential_provider"))
                else create_grpc_credentials(settings["tls"])
            )
            if grpc_credentials is not None and not isinstance(grpc_credentials, grpc.ChannelCredentials):
                raise TraceExportError("mlflow_otlp_grpc_credentials_invalid")
            if self.compression == "gzip":
                grpc_compression = grpc.Compression.Gzip
        super().__init__(
            settings["endpoint"],
            settings["headers"],
            settings["resource_attributes"],
            project_url,
            protocol=protocol,
            request_timeout=float(settings["request_timeout"]),
            grpc_credentials={"trace": grpc_credentials} if protocol == "grpc" else None,
            grpc_compression=grpc_compression,
            grpc_target=settings.get("grpc_target"),
        )
        # A signal endpoint is an exact URL; the shared HTTP owner strips trailing slashes.
        self.http.endpoint = settings["endpoint"]

    @override
    def _send(self, signal: str, serialized: bytes) -> bytes:
        if self.protocol == "grpc":
            return super()._send(signal, serialized)
        if self.compression == "gzip":
            serialized = gzip.compress(serialized)
        elif self.compression == "deflate":
            serialized = zlib.compress(serialized)
        return send_collector_request(self.http, self.settings, serialized)

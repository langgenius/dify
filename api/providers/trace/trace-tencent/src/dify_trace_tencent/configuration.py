"""Tencent configuration syntax and console navigation without exporter state.

These checks do not establish token validity or ingestion permission.
Collectors may acknowledge zero-span OTLP requests without authenticating
them, so an empty Export acknowledgment must not be presented as authentication.
"""

import re
from collections.abc import Mapping
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from dify_trace_tencent.config import TencentConfig

type ConfigurationCode = Literal[
    "invalid_endpoint", "invalid_service_name", "invalid_token", "connection_failed", "unexpected_response"
]

_MESSAGES: dict[ConfigurationCode, str] = {
    "invalid_endpoint": "Tencent APM requires an HTTP(S) collector origin with a valid host and port.",
    "invalid_service_name": (
        "Tencent APM service names must contain 1 to 63 lowercase letters, digits or hyphens, "
        "start with a letter and end with a letter or digit."
    ),
    "invalid_token": "Tencent APM requires a nonempty token.",
    "connection_failed": "Tencent APM collector protocol connection failed.",
    "unexpected_response": "Tencent APM collector returned an unexpected protocol acknowledgment.",
}
_SERVICE_NAME = re.compile(r"[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?")


class TencentConfigurationError(ValueError):
    """Fixed safe errors, without request values or credentials."""

    def __init__(self, code: ConfigurationCode) -> None:
        self.code = code
        super().__init__(_MESSAGES[code])


def _endpoint(value: object) -> str:
    if not isinstance(value, str):
        raise TencentConfigurationError("invalid_endpoint")
    value = value.strip()
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname, parsed.port
        valid = (
            parsed.scheme in {"http", "https"}
            and host
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and "?" not in value
            and "#" not in value
            and "\\" not in value
            and not any(ord(char) <= 32 or ord(char) == 127 for char in value)
            and not parsed.netloc.endswith(":")
            and (port is None or 1 <= port <= 65535)
        )
        if not valid or host is None:
            raise TencentConfigurationError("invalid_endpoint")
        host = host.encode("idna").decode("ascii").lower()
        authority = f"[{host}]" if ":" in host else host
        if port is not None:
            authority = f"{authority}:{port}"
        return urlunsplit((parsed.scheme, authority, "", "", ""))
    except (UnicodeError, ValueError):
        raise TencentConfigurationError("invalid_endpoint") from None


def normalize_configuration(values: Mapping[str, object]) -> TencentConfig:
    """Validate new writes before legacy model normalization drops URL parts.

    The permissive legacy model remains available to display existing stored
    configurations. Masked tokens are retained here so PATCH can restore the
    encrypted original through the shared configuration owner.
    """
    endpoint = _endpoint(values.get("endpoint"))
    service_name = values.get("service_name")
    if not isinstance(service_name, str) or not _SERVICE_NAME.fullmatch(service_name.strip()):
        raise TencentConfigurationError("invalid_service_name")
    token = values.get("token")
    if not isinstance(token, str) or not token.strip():
        raise TencentConfigurationError("invalid_token")
    return TencentConfig(endpoint=endpoint, service_name=service_name.strip(), token=token)


def console_url() -> str:
    """Return the console entry, not a destination-specific project link."""
    return "https://console.cloud.tencent.com/apm"


def verify_configuration(config: TencentConfig) -> TencentConfig:
    """Check syntax and one zero-span OTLP/gRPC exchange, not authentication.

    A collector may acknowledge invalid-token or unauthenticated empty
    requests. Actual credential validity and ingestion must therefore be
    assessed from a business trace, never inferred from this connection check.
    No tracer, span processor, metrics reader or global SDK state is created.
    """
    import grpc  # type: ignore[import-untyped]
    from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, attach, detach, set_value
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import TraceServiceStub

    config = normalize_configuration(config.model_dump())
    parsed = urlsplit(config.endpoint)
    host = parsed.hostname
    assert host is not None  # Validated above, before constructing a channel.
    authority = f"[{host}]" if ":" in host else host
    target = f"{authority}:{parsed.port or 4317}"
    options = (("grpc.enable_retries", 0), ("grpc.max_receive_message_length", 4 * 1024 * 1024))
    channel: grpc.Channel | None = None
    context = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
    try:
        try:
            channel = (
                grpc.insecure_channel(target, options=options)
                if parsed.scheme == "http"
                else grpc.secure_channel(target, grpc.ssl_channel_credentials(), options=options)
            )
            response = TraceServiceStub(channel).Export(
                ExportTraceServiceRequest(),
                metadata=(("authorization", f"Bearer {config.token}"),),
                timeout=10.0,
                wait_for_ready=False,
            )
            if response.partial_success.rejected_spans or response.partial_success.error_message:
                raise TencentConfigurationError("unexpected_response")
        finally:
            if channel is not None:
                channel.close()
    except TencentConfigurationError:
        raise
    except Exception:
        # gRPC errors may contain metadata or vendor details. Expose neither.
        raise TencentConfigurationError("connection_failed") from None
    finally:
        detach(context)
    return config

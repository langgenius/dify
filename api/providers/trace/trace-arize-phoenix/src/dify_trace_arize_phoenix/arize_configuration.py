"""Optional Arize Cloud project metadata, resolved only on explicit config writes.

Ingestion verification is separate from metadata reads. A key without read access
may still ingest successfully, so an unavailable project link is never a reason
to reject that configuration. Readers use only the frozen destination cache.
"""

import hashlib
import json
import re
import time
from collections.abc import Mapping
from typing import Literal
from urllib.parse import quote, urlsplit

from pydantic import JsonValue, TypeAdapter

from core.helper import ssrf_proxy
from dify_trace_arize_phoenix.config import ArizeConfig

DESTINATION_KEY = "arize_project_destination"
_API_BASE = "https://api.arize.com/v2"
_UI_BASE = "https://app.arize.com"
_BUDGET_SECONDS = 5.0
_MAX_RESPONSE_BYTES = 1024 * 1024
_PAGE_LIMIT = 100
_MAX_PAGES = 3
_JSON_OBJECT = TypeAdapter(dict[str, JsonValue])
_VERIFY_TIMEOUT_SECONDS = 5.0

type VerificationCode = Literal[
    "invalid_configuration", "authentication_failed", "permission_denied", "connection_failed", "unexpected_response"
]


class ArizeConfigurationError(ValueError):
    """Fixed diagnostics never contain credentials, vendor details or endpoints."""

    def __init__(self, code: VerificationCode) -> None:
        self.code = code
        super().__init__(f"Arize ingestion verification failed: {code}")


def verify_configuration(config: ArizeConfig) -> None:
    """Require one synchronous OTLP ACK, without creating any span or project.

    The default Arize collector was verified to authenticate this resource-only
    request for both valid and invalid credentials. It establishes this ingest
    protocol's access, not REST read permission or a project's eventual creation.
    No SDK exporter, span processor or global/environment credentials are used.
    """
    import grpc  # type: ignore[import-untyped]
    from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, attach, detach, set_value
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2_grpc import TraceServiceStub

    try:
        parsed = urlsplit(config.endpoint)
        host, port = parsed.hostname, parsed.port
        if (
            parsed.scheme not in {"http", "https"}
            or not host
            or parsed.username is not None
            or parsed.password is not None
            or (port is not None and not 1 <= port <= 65535)
        ):
            raise ArizeConfigurationError("invalid_configuration")
        for value in (config.api_key, config.space_id):
            if (
                not isinstance(value, str)
                or not value
                or "*" in value
                or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value)
            ):
                raise ArizeConfigurationError("invalid_configuration")
    except ValueError:
        raise ArizeConfigurationError("invalid_configuration") from None

    payload = ExportTraceServiceRequest()
    resource = payload.resource_spans.add().resource
    for name in ("model_id", "openinference.project.name"):
        resource.attributes.add(key=name).value.string_value = config.project or "default"
    headers = (
        ("api_key", config.api_key),
        ("space_id", config.space_id),
        ("authorization", f"Bearer {config.api_key}"),
    )
    authority = f"[{host}]" if ":" in host else host
    target = f"{authority}:{port or 443}"
    options = (("grpc.enable_retries", 0), ("grpc.max_receive_message_length", _MAX_RESPONSE_BYTES))
    channel: grpc.Channel | None = None
    context = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
    try:
        try:
            channel = (
                grpc.insecure_channel(target, options=options)
                if parsed.scheme == "http"
                else grpc.secure_channel(target, grpc.ssl_channel_credentials(), options=options)
            )
            result = TraceServiceStub(channel).Export(
                payload, metadata=headers, timeout=_VERIFY_TIMEOUT_SECONDS, wait_for_ready=False
            )
            if result.partial_success.rejected_spans or result.partial_success.error_message:
                raise ArizeConfigurationError("unexpected_response")
        finally:
            if channel is not None:
                channel.close()
    except ArizeConfigurationError:
        raise
    except grpc.RpcError as error:
        code = error.code()
        if code is grpc.StatusCode.UNAUTHENTICATED:
            raise ArizeConfigurationError("authentication_failed") from None
        if code is grpc.StatusCode.PERMISSION_DENIED:
            raise ArizeConfigurationError("permission_denied") from None
        raise ArizeConfigurationError("connection_failed") from None
    except Exception:
        raise ArizeConfigurationError("connection_failed") from None
    finally:
        detach(context)


def _opaque_id(value: object) -> bool:
    # IDs remain opaque. In particular, never derive organization IDs by
    # decoding the project or space IDs, or accept path/query metacharacters.
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9+/_=-]{1,1024}", value) is not None


def _identity(values: Mapping[str, object]) -> dict[str, str] | None:
    try:
        config = ArizeConfig.model_validate(
            {key: values[key] for key in ("endpoint", "space_id", "project") if key in values}
        )
        endpoint = urlsplit(config.endpoint)
        # These fixed API/UI hosts belong to the documented default collector.
        # Custom or other regional collectors keep ingestion support, but must
        # not send their credentials to an assumed Cloud metadata destination.
        if (
            endpoint.scheme != "https"
            or endpoint.hostname != "otlp.arize.com"
            or endpoint.port not in (None, 443)
            or endpoint.username is not None
            or endpoint.password is not None
            or not _opaque_id(config.space_id)
        ):
            return None
    except ValueError:
        return None
    assert config.space_id is not None
    return {"endpoint": config.endpoint, "space_id": config.space_id, "project": config.project or "default"}


def project_url(values: Mapping[str, object]) -> str | None:
    """Compute only a verified cached destination; never perform vendor I/O."""
    destination = values.get(DESTINATION_KEY)
    if not isinstance(destination, Mapping):
        return None
    identity = _identity(destination)
    # Legacy Arize encrypts space_id as well as api_key. Bind the public cache
    # to this exact persisted record without decrypting it on status reads.
    digest = _source_digest(values)
    if identity is None or digest is None or destination.get("source_digest") != digest:
        return None
    organization_id, project_id = destination.get("organization_id"), destination.get("project_id")
    if not _opaque_id(organization_id) or not _opaque_id(project_id):
        return None
    assert isinstance(organization_id, str)
    assert isinstance(project_id, str)
    return (
        f"{_UI_BASE}/organizations/{quote(organization_id, safe='')}"
        f"/spaces/{quote(identity['space_id'], safe='')}/projects/{quote(project_id, safe='')}"
    )


def _source_digest(values: Mapping[str, object]) -> str | None:
    parts = [values.get(key) for key in ("endpoint", "space_id", "project")]
    if not all(isinstance(part, str) for part in parts):
        return None
    return hashlib.sha256(json.dumps(parts, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


def bind_destination(values: Mapping[str, object], destination: dict[str, str]) -> dict[str, str]:
    """Bind server-resolved metadata after legacy secret encryption has finished."""
    digest = _source_digest(values)
    if digest is None:
        raise ValueError("Arize persisted destination is incomplete")
    return {**destination, "source_digest": digest}


def _get_json(
    path: str, headers: dict[str, str], deadline: float, *, params: dict[str, str | int] | None = None
) -> dict[str, JsonValue] | None:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    try:
        response = ssrf_proxy.get(
            _API_BASE + path,
            headers=headers,
            params=params,
            auth=None,
            timeout=remaining,
            max_retries=0,
            follow_redirects=False,
            stream_response=True,
        )
        try:
            if response.status_code != 200 or time.monotonic() >= deadline:
                return None
            encoding = response.headers.get("content-encoding", "identity").strip().lower()
            if encoding not in {"", "identity"}:
                return None
            content = bytearray()
            for chunk in response.iter_bytes():
                if time.monotonic() >= deadline or len(content) + len(chunk) > _MAX_RESPONSE_BYTES:
                    return None
                content.extend(chunk)
            if time.monotonic() >= deadline:
                return None
            return _JSON_OBJECT.validate_json(content, strict=True)
        finally:
            response.close()
    except Exception:
        # Metadata is optional. Do not expose request headers, response bodies,
        # credential-bearing exceptions, or turn read permission into an ingest
        # permission requirement.
        return None


def resolve_project_destination(values: Mapping[str, object]) -> dict[str, str] | None:
    """Resolve exact project/space ownership within one shared five-second budget.

    The documented name filter is a substring match. Read at most three scoped
    pages and require one exact name/space match. Missing organization IDs on
    older servers, denied reads, malformed responses and budget exhaustion all
    mean no optional link, without modifying ingestion configuration or history.
    """
    identity = _identity(values)
    key = values.get("api_key")
    if (
        identity is None
        or not isinstance(key, str)
        or not key
        or "*" in key
        or any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in key)
    ):
        return None
    deadline = time.monotonic() + _BUDGET_SECONDS
    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Cookie": "",
    }
    space = _get_json("/spaces/" + quote(identity["space_id"], safe=""), headers, deadline)
    if space is None or space.get("id") != identity["space_id"] or not _opaque_id(space.get("organization_id")):
        return None
    organization_id = space["organization_id"]
    assert isinstance(organization_id, str)
    project_ids: set[str] = set()
    seen_cursors: set[str] = set()
    params: dict[str, str | int] = {
        "space_id": identity["space_id"],
        "name": identity["project"],
        "limit": _PAGE_LIMIT,
    }
    for _ in range(_MAX_PAGES):
        page = _get_json("/projects", headers, deadline, params=params)
        if page is None:
            return None
        projects, pagination = page.get("projects"), page.get("pagination")
        if not isinstance(projects, list) or len(projects) > _PAGE_LIMIT or not isinstance(pagination, dict):
            return None
        for project in projects:
            if (
                not isinstance(project, dict)
                or not _opaque_id(project.get("id"))
                or not isinstance(project.get("name"), str)
                or project.get("space_id") != identity["space_id"]
            ):
                return None
            if project["name"] == identity["project"]:
                project_id = project["id"]
                assert isinstance(project_id, str)
                project_ids.add(project_id)
                if len(project_ids) > 1:
                    return None
        has_more = pagination.get("has_more")
        if has_more is False:
            if len(project_ids) != 1:
                return None
            return {**identity, "organization_id": organization_id, "project_id": next(iter(project_ids))}
        cursor = pagination.get("next_cursor")
        if (
            has_more is not True
            or not isinstance(cursor, str)
            or not cursor
            or len(cursor) > 4096
            or cursor in seen_cursors
        ):
            return None
        seen_cursors.add(cursor)
        params = {**params, "cursor": cursor}
    return None

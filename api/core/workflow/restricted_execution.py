"""Exact native capabilities for immutable Builder restricted executions.

These collaborators never wrap live transport or file owners. Durable evidence
is appended through the launch's shared recorder before any fixture is returned.
"""

import hashlib
import hmac
import json
import math
from collections.abc import Mapping
from typing import Any, Literal, NoReturn
from uuid import uuid4

from core.dify_builder.execution_policy import (
    BuilderExecutionContext,
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    BuilderExecutionRecorder,
    canonical_digest,
    validate_restricted_http_defaults,
)
from graphon.entities.base_node_data import BaseNodeData
from graphon.http import HttpResponse
from graphon.nodes.base.node import Node
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.http_request.entities import HttpRequestNodeConfig, HttpRequestNodeData
from graphon.nodes.http_request.node import HttpRequestNode
from graphon.nodes.start.start_node import StartNode

_AUDITED_CLASSES = {"start": StartNode, "end": EndNode, "http-request": HttpRequestNode}
_CONTENT_TYPES = frozenset(
    ("application/json", "text/plain", "application/json; charset=utf-8", "text/plain; charset=utf-8")
)
_MAX_TEXT_BYTES = 65536

# Pure configuration; no deployment/client owner is consulted for fixtures.
RESTRICTED_HTTP_CONFIG = HttpRequestNodeConfig(
    max_connect_timeout=10,
    max_read_timeout=10,
    max_write_timeout=10,
    max_binary_size=0,
    max_text_size=_MAX_TEXT_BYTES,
    ssl_verify=True,
    ssrf_default_max_retries=0,
)


def validate_restricted_raw_node(
    *, context: BuilderExecutionContext, node_id: str, node_class: type[Node], raw_node_data: Mapping[str, Any]
) -> None:
    """Check raw implementation/config binding before concrete class validation."""
    node_type = raw_node_data.get("type")
    if (
        not isinstance(node_type, str)
        or node_class is not _AUDITED_CLASSES.get(node_type)
        or raw_node_data.get("version", "1") != "1"
        or node_class.version() != "1"
    ):
        raise BuilderExecutionPolicyError("unsupported_node_implementation")
    binding = next((binding for binding in context.admitted_nodes if binding.node_id == node_id), None)
    if (
        binding is None
        or binding.implementation != f"{node_class.__module__}.{node_class.__qualname__}"
        or binding.node_version != "1"
        or binding.normalized_config_digest != canonical_digest({**raw_node_data, "version": "1"})
    ):
        raise BuilderExecutionPolicyError("execution_binding_mismatch")


def validate_restricted_node(
    *, context: BuilderExecutionContext, node_id: str, node_class: type[Node], resolved_node_data: BaseNodeData
) -> None:
    """Recheck typed text capabilities after raw binding and native validation."""
    binding = next((binding for binding in context.admitted_nodes if binding.node_id == node_id), None)
    if (
        binding is None
        or node_class is not _AUDITED_CLASSES.get(resolved_node_data.type)
        or binding.implementation != f"{node_class.__module__}.{node_class.__qualname__}"
        or binding.node_version != "1"
        or node_class.version() != "1"
        or resolved_node_data.version != "1"
    ):
        raise BuilderExecutionPolicyError("unsupported_node_implementation")
    if node_class is HttpRequestNode:
        if not isinstance(resolved_node_data, HttpRequestNodeData):
            raise BuilderExecutionPolicyError("invalid_node_configuration")
        data = resolved_node_data
        if data.authorization.type != "no-auth" or data.authorization.config is not None:
            raise BuilderExecutionPolicyError("unsupported_http_authorization")
        if data.method.upper() not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}:
            raise BuilderExecutionPolicyError("unsupported_http_method")
        if data.body is not None and (
            data.body.type not in {"none", "raw-text", "json"}
            or any(item.type != "text" or item.file for item in data.body.data)
        ):
            raise BuilderExecutionPolicyError("unsupported_http_body")
        validate_restricted_http_defaults(data.model_dump(mode="python"))


class PolicyTransportError(Exception):
    """Sanitized denial handled by the native HTTP executor's request-error path."""


class PolicyMaxRetriesExceededError(Exception):
    """Distinct protocol type; restricted adapters never raise this URL-bearing path."""


def _text(value: Any) -> bool:
    if type(value) is not str:
        return False
    try:
        return len(value.encode("utf-8")) <= _MAX_TEXT_BYTES
    except UnicodeError:
        return False


def _json_value(value: Any, *, depth: int = 0) -> bool:
    """Exact finite JSON types; transport kwargs cannot smuggle Python objects."""
    if depth > 32:
        return False
    if value is None or type(value) in (bool, int):
        return True
    if type(value) is float:
        return math.isfinite(value)
    if type(value) is str:
        return _text(value)
    if type(value) is list:
        return all(_json_value(item, depth=depth + 1) for item in value)
    if type(value) is dict:
        return all(_text(key) and _json_value(item, depth=depth + 1) for key, item in value.items())
    return False


def _valid_request(url: Any, kwargs: Mapping[str, Any]) -> bool:
    if not _text(url) or set(kwargs) - {
        "max_retries",
        "data",
        "files",
        "json",
        "content",
        "headers",
        "params",
        "timeout",
        "ssl_verify",
        "follow_redirects",
    }:
        return False
    retries = kwargs.get("max_retries", 0)
    if type(retries) is not int or retries != 0:
        return False
    files = kwargs.get("files")
    if files is not None and (type(files) is not list or files):
        return False
    if kwargs.get("data") is not None:
        return False
    content = kwargs.get("content")
    if content is not None and not _text(content):
        return False
    headers = kwargs.get("headers")
    if headers is not None and (
        type(headers) is not dict
        or len(headers) > 1
        or any(
            type(k) is not str or k.lower() != "content-type" or type(v) is not str or v not in _CONTENT_TYPES
            for k, v in headers.items()
        )
    ):
        return False
    params = kwargs.get("params")
    if params is not None and (
        type(params) is not list
        or len(params) > 128
        or any(type(pair) not in (list, tuple) or len(pair) != 2 or not all(_text(v) for v in pair) for pair in params)
    ):
        return False
    timeout = kwargs.get("timeout")
    if timeout is not None and (
        type(timeout) is not tuple
        or len(timeout) != 3
        or any(type(v) not in (int, float) or not 0 < v <= 300 or not math.isfinite(v) for v in timeout)
    ):
        return False
    if any(key in kwargs and type(kwargs[key]) is not bool for key in ("ssl_verify", "follow_redirects")):
        return False
    try:
        if not _json_value(kwargs.get("json")):
            return False
        canonical_digest(dict(kwargs))
        return len(json.dumps(kwargs, ensure_ascii=False, allow_nan=False).encode("utf-8")) <= _MAX_TEXT_BYTES
    except (BuilderExecutionPolicyError, ValueError, TypeError, UnicodeError, RecursionError):
        return False


class RestrictedHttpClient:
    """Full Graphon HTTP protocol, bound to one admitted node and launch recorder."""

    def __init__(
        self,
        *,
        context: BuilderExecutionContext,
        node_id: str,
        recorder: BuilderExecutionRecorder,
        request_hmac_key: bytes,
    ) -> None:
        self._context = context
        self._node_id = node_id
        self._recorder = recorder
        self._request_hmac_key = request_hmac_key
        binding = next((binding for binding in context.admitted_nodes if binding.node_id == node_id), None)
        if (
            binding is None
            or binding.implementation != "graphon.nodes.http_request.node.HttpRequestNode"
            or binding.node_version != "1"
        ):
            raise BuilderExecutionPolicyError("unsupported_node_implementation")
        if type(request_hmac_key) is not bytes or len(request_hmac_key) != 32:
            raise BuilderExecutionPolicyError("invalid_request_hmac_key")
        self._implementation_version = f"{binding.implementation}:{binding.node_version}"

    @property
    def request_error(self) -> type[Exception]:
        return PolicyTransportError

    @property
    def max_retries_exceeded_error(self) -> type[Exception]:
        return PolicyMaxRetriesExceededError

    def get(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._respond("GET", url, {"max_retries": max_retries, **kwargs})

    def head(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._respond("HEAD", url, {"max_retries": max_retries, **kwargs})

    def post(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._respond("POST", url, {"max_retries": max_retries, **kwargs})

    def put(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._respond("PUT", url, {"max_retries": max_retries, **kwargs})

    def delete(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._respond("DELETE", url, {"max_retries": max_retries, **kwargs})

    def patch(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._respond("PATCH", url, {"max_retries": max_retries, **kwargs})

    def _record(
        self,
        *,
        kind: Literal["effect_blocked", "fixture_served"],
        reason: str,
        invocation_id: str,
        request_hmac: str | None = None,
    ) -> None:
        if not self._recorder.healthy:
            raise BuilderExecutionPolicyError("execution_recorder_unhealthy")
        self._recorder.record(
            BuilderExecutionObservation(
                observation_id=str(uuid4()),
                invocation_id=invocation_id,
                request_id=self._context.request_id,
                node_id=self._node_id,
                kind=kind,
                implementation_version=self._implementation_version,
                reason_code=reason,
                fixture_digest=self._context.fixture_digest if kind == "fixture_served" else None,
                request_hmac=request_hmac,
            )
        )

    def deny_file(self) -> NoReturn:
        self._record(kind="effect_blocked", reason="http_file_capability", invocation_id=str(uuid4()))
        raise PolicyTransportError("execution_policy: http_file_capability")

    def _respond(self, method: str, url: str, kwargs: Mapping[str, Any]) -> HttpResponse:
        invocation_id = str(uuid4())
        if method not in {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"} or not _valid_request(url, kwargs):
            self._record(kind="effect_blocked", reason="http_request_arguments", invocation_id=invocation_id)
            raise PolicyTransportError("execution_policy: http_request_arguments")
        request = canonical_digest(
            {
                "method": method,
                "url": url,
                "kwargs": dict(kwargs),
                "context_digest": self._context.context_digest,
                "node_id": self._node_id,
                "invocation_id": invocation_id,
            }
        )
        request_hmac = hmac.new(self._request_hmac_key, request.encode("ascii"), hashlib.sha256).hexdigest()
        fixture = next((fixture for fixture in self._context.http_fixtures if fixture.node_id == self._node_id), None)
        if fixture is None:
            self._record(
                kind="effect_blocked",
                reason="http_fixture_missing",
                invocation_id=invocation_id,
                request_hmac=request_hmac,
            )
            raise PolicyTransportError("execution_policy: http_fixture_missing")
        self._record(
            kind="fixture_served", reason="http_fixture_served", invocation_id=invocation_id, request_hmac=request_hmac
        )
        return HttpResponse(
            status_code=fixture.status_code,
            headers={"content-type": f"{fixture.content_type}; charset=utf-8"},
            content=fixture.body.encode("utf-8"),
            url=url,
        )


class DeniedHttpFiles:
    """All native HTTP file collaborator protocols, with durable denials."""

    def __init__(self, client: RestrictedHttpClient) -> None:
        self._client = client

    def download(self, f: Any, /) -> NoReturn:
        self._client.deny_file()

    def build_from_mapping(self, *, mapping: Mapping[str, Any]) -> NoReturn:
        self._client.deny_file()

    def create_file_by_raw(self, *, file_binary: bytes, mimetype: str, filename: str | None = None) -> NoReturn:
        self._client.deny_file()

    def get_file_generator_by_tool_file_id(self, tool_file_id: str) -> NoReturn:
        self._client.deny_file()

    def __call__(self) -> NoReturn:
        self._client.deny_file()

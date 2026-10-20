"""Opt-in native HTTP physical owner, without production binding authority.

The trusted producer attests the exact immutable prepared request and owns its
input/key, secret-reference projection, credential/file identity and policy.
Object identity proves component integrity, not that an arbitrary producer is
trusted. No factory activation or production producer is supplied here.
"""

import base64
import json
import math
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import partial
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr

from core.helper import ssrf_proxy
from graphon.http import HttpResponse
from libs.sensitive_http_telemetry import (
    SensitiveHttpTelemetryUnavailable,
    assert_sensitive_http_telemetry_ready,
    sensitive_http_telemetry,
)
from runtime_contracts.builder.execution import canonical_json
from runtime_contracts.builder.native.contracts import DispatchPermit, EffectIntent, JsonValue, NativeTestContextRef
from services.dify_builder.native_testing.control import NativePolicyStop


def _pack(value: object) -> JsonValue:
    """Private typed snapshot: no coercion of booleans, bytes or containers."""
    if value is None or isinstance(value, (str, bool, int)) and type(value) in (str, bool, int):
        return [type(value).__name__, value]
    if type(value) is float and math.isfinite(value):
        return ["float", value]
    if type(value) is bytes:
        return ["bytes", base64.b64encode(value).decode("ascii")]
    if isinstance(value, (list, tuple)) and type(value) in (list, tuple):
        return [type(value).__name__, [_pack(item) for item in value]]
    if type(value) is dict and all(type(key) is str for key in value):
        return ["dict", [[key, _pack(item)] for key, item in value.items()]]
    raise ValueError("native_http_material_unsupported")


def _unpack(value: Any) -> Any:
    tag, item = value
    if tag == "bytes":
        return base64.b64decode(item, validate=True)
    if tag in ("tuple", "list"):
        items = [_unpack(part) for part in item]
        return tuple(items) if tag == "tuple" else items
    if tag == "dict":
        return {key: _unpack(part) for key, part in item}
    return item


@dataclass(frozen=True, slots=True, repr=False)
class PreparedHttpRequest:
    """Transient immutable semantic and wire snapshots; repr reveals no fields.

    material() excludes randomized multipart wire boundaries so the producer can
    match logical intent on reconstruction. arguments() returns fresh typed
    values. Neither method establishes credential or durable file identity.
    """

    method: str
    url: str
    headers: tuple[tuple[bytes, bytes], ...]
    content: bytes
    _semantic: bytes
    timeout: tuple[float | int, ...]
    ssl_verify: bool
    follow_redirects: bool

    def material(self) -> JsonValue:
        return {"method": self.method, "arguments": json.loads(self._semantic)}

    def arguments(self) -> dict[str, Any]:
        return _unpack(json.loads(self._semantic))

    def wire(self) -> httpx.Request:
        return httpx.Request(self.method, self.url, headers=list(self.headers), content=self.content)


@dataclass(frozen=True, slots=True, repr=False)
class PreparedHttpBinding:
    request: PreparedHttpRequest = field(repr=False)
    intent: EffectIntent = field(repr=False)


class ScalarCallPort(Protocol):
    """Trusted scalar owner with the existing per-operation dispatch contract."""

    def call(
        self,
        *,
        ref: NativeTestContextRef,
        intent: EffectIntent,
        dispatch: Callable[[DispatchPermit], JsonValue],
    ) -> JsonValue: ...


class NativeHttpIntentPort(Protocol):
    """Trusted preparation only: no business IO or independent authority.

    Must use existing bound input and cursor-issued key, current server-owned
    credential/file references and revision/scope. Semantic redaction and actual
    request matching belong here; no production implementation exists yet.
    """

    def prepare(
        self, *, request: PreparedHttpRequest, hop: int, previous_response: HttpResponse | None
    ) -> PreparedHttpBinding: ...


class _StoredResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    version: StrictInt
    status_code: StrictInt
    raw_headers_base64: list[list[StrictStr]]
    content_base64: StrictStr
    url: StrictStr
    reason_phrase: StrictStr
    fallback_text: StrictStr

    def raw_headers(self) -> list[tuple[bytes, bytes]]:
        # Header fields, especially Set-Cookie with Expires commas, cannot be
        # recovered by splitting the public combined mapping. Preserve exact
        # bytes and repetition in the bounded protected result instead.
        return [
            (base64.b64decode(name, validate=True), base64.b64decode(value, validate=True))
            for name, value in self.raw_headers_base64
        ]

    def response(self) -> HttpResponse:
        if self.version != 1 or not 100 <= self.status_code <= 999:
            raise ValueError("native_http_result_invalid")
        return HttpResponse(
            status_code=self.status_code,
            headers=dict(httpx.Headers(self.raw_headers())),
            content=base64.b64decode(self.content_base64, validate=True),
            url=self.url,
            reason_phrase=self.reason_phrase,
            fallback_text=self.fallback_text,
        )


def _redirect_request(
    request: PreparedHttpRequest, response: _StoredResponse, cookies: httpx.Cookies
) -> PreparedHttpRequest:
    """Locked HTTPX private helper; explicitly covered by upgrade compatibility tests.

    This client only constructs a request; no send method is invoked. Extra
    cross-origin stripping is conservative. Arbitrary credential headers still
    require trusted producer matching and are not solved by this name list.
    """
    wire = request.wire()
    reply = httpx.Response(response.status_code, headers=response.raw_headers(), request=wire)
    with httpx.Client(trust_env=False, cookies=cookies) as offline:
        offline.cookies.extract_cookies(reply)
        redirected = offline._build_redirect_request(wire, reply)
        content = redirected.read()
        cookies.clear()
        cookies.update(offline.cookies)
    old, new = wire.url, redirected.url
    if new.scheme not in ("http", "https") or new.username or new.password:
        raise ValueError("native_http_redirect_target_invalid")
    if (old.scheme, old.host, old.port) != (new.scheme, new.host, new.port):
        cookies.clear()
        for header in ("authorization", "proxy-authorization", "cookie"):
            redirected.headers.pop(header, None)
    # An explicit empty cookie prevents the SSRF pooled client's unrelated
    # cookie jar from silently adding account state after intent matching.
    if "cookie" not in redirected.headers:
        redirected.headers["Cookie"] = ""
    arguments = request.arguments()
    explicit = {name.lower() for name in arguments["headers"]}
    arguments.update(
        url=str(new),
        headers={name: value for name, value in redirected.headers.items() if name.lower() in explicit},
        params=None,
    )
    # The hop's body follows HTTPX wire semantics. Semantic original file/JSON
    # material remains available to the producer for preserved-body redirects.
    if redirected.method != wire.method and redirected.method == "GET":
        arguments.update(data=None, files=None, json=None, content=None)
    return PreparedHttpRequest(
        method=redirected.method,
        url=str(new),
        headers=tuple(redirected.headers.raw),
        content=content,
        _semantic=canonical_json(_pack(arguments)),
        timeout=request.timeout,
        ssl_verify=request.ssl_verify,
        follow_redirects=request.follow_redirects,
    )


class NativeHttpClient:
    """Graphon0.7 HttpClientProtocol, one scalar authorization per physical hop."""

    def __init__(
        self,
        *,
        ref: NativeTestContextRef,
        calls: ScalarCallPort,
        intents: NativeHttpIntentPort,
        max_redirect_hops: int,
        max_response_bytes: int,
    ) -> None:
        if type(max_redirect_hops) is not int or max_redirect_hops < 0:
            raise ValueError("native_http_redirect_budget_required")
        if type(max_response_bytes) is not int or max_response_bytes <= 0:
            raise ValueError("native_http_response_budget_required")
        self._ref = NativeTestContextRef.model_validate(ref.model_dump(warnings=False), strict=True)
        self._calls, self._intents = calls, intents
        self._max_redirect_hops, self._max_response_bytes = max_redirect_hops, max_response_bytes

    @property
    def request_error(self) -> type[Exception]:
        return ssrf_proxy.request_error

    @property
    def max_retries_exceeded_error(self) -> type[Exception]:
        return ssrf_proxy.max_retries_exceeded_error

    def _prepare(self, method: str, url: str, kwargs: dict[str, Any]) -> PreparedHttpRequest:
        if set(kwargs) - {
            "headers",
            "params",
            "data",
            "files",
            "json",
            "content",
            "timeout",
            "ssl_verify",
            "follow_redirects",
        }:
            raise ValueError("native_http_option_unsupported")
        if type(kwargs.get("ssl_verify")) is not bool or type(kwargs.get("follow_redirects")) is not bool:
            raise ValueError("native_http_options_required")
        timeout = kwargs.get("timeout")
        if (
            not isinstance(timeout, (tuple, list))
            or type(timeout) not in (tuple, list)
            or len(timeout) not in (3, 4)
            or any(type(value) not in (int, float) or not math.isfinite(value) or value <= 0 for value in timeout)
        ):
            raise ValueError("native_http_finite_timeout_required")
        headers = kwargs.get("headers")
        if type(headers) is not dict or any(
            type(key) is not str or type(value) is not str for key, value in headers.items()
        ):
            raise ValueError("native_http_headers_invalid")
        headers = dict(headers)
        if not any(name.lower() == "cookie" for name in headers):
            headers["Cookie"] = ""
        kwargs = {**kwargs, "headers": headers}
        if type(url) is not str:
            raise ValueError("native_http_url_invalid")
        parsed = httpx.URL(url)
        if parsed.scheme not in ("http", "https") or not parsed.host or parsed.username or parsed.password:
            raise ValueError("native_http_url_invalid")
        # Freeze every supported argument before constructing multipart/JSON wire
        # bytes. Copies cannot subsequently mutate the attested physical request.
        semantic = canonical_json(_pack({"url": url, **kwargs}))
        actual = _unpack(json.loads(semantic))
        wire_args = {
            key: actual[key] for key in ("headers", "params", "data", "files", "json", "content") if key in actual
        }
        wire = httpx.Request(method, url, **wire_args)
        content = wire.read()
        return PreparedHttpRequest(
            method=wire.method,
            url=str(wire.url),
            headers=tuple(wire.headers.raw),
            content=content,
            _semantic=semantic,
            timeout=tuple(timeout),
            ssl_verify=kwargs["ssl_verify"],
            follow_redirects=kwargs["follow_redirects"],
        )

    def _dispatch(self, request: PreparedHttpRequest, permit: DispatchPermit) -> JsonValue:
        del permit  # Scalar owner already consumed this exact dispatch permit.
        # Keep C02/producer/storage outside suppression. Raw transport failures
        # cross only this local guard and are contained by the scalar owner
        # before an enclosing manual tracing span can observe an exception.
        with sensitive_http_telemetry():
            return self._send_and_buffer(request)

    def _send_and_buffer(self, request: PreparedHttpRequest) -> JsonValue:
        response = ssrf_proxy.make_request(
            request.method,
            request.url,
            max_retries=0,
            stream_response=True,
            sensitive_request=True,
            follow_redirects=False,
            headers=dict(httpx.Headers(list(request.headers))),
            content=request.content,
            timeout=request.timeout,
            ssl_verify=request.ssl_verify,
        )
        try:
            if response.headers.get("content-encoding", "identity").strip().lower() not in ("", "identity"):
                raise ValueError("native_http_encoding_unsupported")
            content = bytearray()
            for chunk in response.iter_bytes():
                if len(content) + len(chunk) > self._max_response_bytes:
                    raise ValueError("native_http_response_limit")
                content.extend(chunk)
            expected = response.headers.get("content-length")
            if request.method != "HEAD" and response.status_code not in (204, 304) and expected is not None:
                if int(expected) != len(content):
                    raise ValueError("native_http_response_truncated")
            # Preserve the existing SSRF->Graphon conversion's text fallback,
            # headers, bytes, reason and HTTP status semantics, including errors.
            buffered = httpx.Response(
                response.status_code,
                headers=response.headers,
                content=bytes(content),
                request=response.request,
                extensions=response.extensions,
                default_encoding=response.default_encoding,
            )
            return _StoredResponse(
                version=1,
                status_code=response.status_code,
                raw_headers_base64=[
                    [base64.b64encode(name).decode("ascii"), base64.b64encode(value).decode("ascii")]
                    for name, value in response.headers.raw
                ],
                content_base64=base64.b64encode(content).decode("ascii"),
                url=str(response.url),
                reason_phrase=response.reason_phrase,
                fallback_text=buffered.text,
            ).model_dump(mode="json")
        finally:
            # HTTPX closes streams when iteration finishes, including before a
            # failing close returns. Never invoke close twice on owned handles.
            if not response.is_closed:
                response.close()

    def _require_telemetry(self) -> None:
        try:
            assert_sensitive_http_telemetry_ready()
        except SensitiveHttpTelemetryUnavailable:
            raise NativePolicyStop(ref=self._ref, reason_code="native_http_telemetry_unavailable") from None

    def _request(self, method: str, url: str, max_retries: int, kwargs: dict[str, Any]) -> HttpResponse:
        self._require_telemetry()
        try:
            if type(max_retries) is not int or max_retries != 0:
                raise ValueError("native_http_retry_forbidden")
            request = self._prepare(method, url, kwargs)
        except Exception:
            raise NativePolicyStop(ref=self._ref, reason_code="native_http_preparation_failed") from None
        previous = None
        cookies = httpx.Cookies()
        for hop in range(self._max_redirect_hops + 1):
            if hop:
                self._require_telemetry()
            try:
                binding = self._intents.prepare(request=request, hop=hop, previous_response=previous)
                if (
                    type(binding) is not PreparedHttpBinding
                    or binding.request is not request
                    or type(binding.intent) is not EffectIntent
                ):
                    raise ValueError("native_http_attestation_invalid")
                intent = EffectIntent.model_validate(binding.intent.model_dump(warnings=False), strict=True)
                if intent.kind != "http" or intent.key.invocation_id != self._ref.invocation_id:
                    raise ValueError("native_http_attestation_invalid")
            except Exception:
                raise NativePolicyStop(ref=self._ref, reason_code="native_http_attestation_invalid") from None
            result = self._calls.call(ref=self._ref, intent=intent, dispatch=partial(self._dispatch, request))
            try:
                stored = _StoredResponse.model_validate(result)
                previous = stored.response()
                if len(previous.content) > self._max_response_bytes:
                    raise ValueError("native_http_response_limit")
            except Exception:
                raise NativePolicyStop(ref=self._ref, reason_code="outcome_unknown") from None
            if (
                not request.follow_redirects
                or previous.status_code not in (301, 302, 303, 307, 308)
                or "location" not in previous.headers
            ):
                return previous
            if hop == self._max_redirect_hops:
                raise NativePolicyStop(ref=self._ref, reason_code="native_http_redirect_limit")
            try:
                request = _redirect_request(request, stored, cookies)
            except Exception:
                raise NativePolicyStop(ref=self._ref, reason_code="native_http_redirect_invalid") from None
        raise AssertionError("unreachable")

    def get(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("GET", url, max_retries, kwargs)

    def head(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("HEAD", url, max_retries, kwargs)

    def post(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("POST", url, max_retries, kwargs)

    def put(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("PUT", url, max_retries, kwargs)

    def delete(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("DELETE", url, max_retries, kwargs)

    def patch(self, url: str, max_retries: int = 0, **kwargs: Any) -> HttpResponse:
        return self._request("PATCH", url, max_retries, kwargs)

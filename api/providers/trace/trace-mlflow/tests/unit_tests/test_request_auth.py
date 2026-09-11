"""Exercise installed MLflow auth plugins through real Requests preparation and SSRF HTTPX transport."""

import gzip
import hashlib
import hmac
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPResponse as StandardHTTPResponse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import metadata
from io import BytesIO
from pathlib import Path
from threading import Barrier, Thread
from time import monotonic
from types import ModuleType
from typing import Any, override
from unittest.mock import Mock
from uuid import uuid4

import httpx
import pytest
import requests
from dify_trace_mlflow import request_auth
from dify_trace_mlflow.config import MLflowConfig
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from requests.adapters import HTTPAdapter
from requests.auth import AuthBase, HTTPDigestAuth
from requests.utils import parse_dict_header
from urllib3.response import HTTPResponse

from core.ops.provider_config import resolve_provider_config
from core.ops.provider_export import TraceExportError, TraceProviderHttpClient, basic_auth
from core.tools.errors import ToolSSRFError
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


@pytest.fixture
def install_plugins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Use real dist-info and EntryPoint.load without installing a dependency."""
    plugin_directory = tmp_path / "plugins"
    distribution = plugin_directory / "example_mlflow_auth-1.0.dist-info"
    distribution.mkdir(parents=True)
    (distribution / "METADATA").write_text("Metadata-Version: 2.1\nName: example-mlflow-auth\nVersion: 1.0\n")
    module = ModuleType("example_mlflow_auth")
    monkeypatch.setitem(sys.modules, module.__name__, module)
    monkeypatch.syspath_prepend(str(plugin_directory))

    def install(providers: dict[str, type], *, missing_import: bool = False) -> None:
        entries = ["[mlflow.request_auth_provider]"]
        if missing_import:
            entries.append("broken = missing_mlflow_auth_module:Provider")
        for index, (label, provider) in enumerate(providers.items()):
            class_name = f"Provider{index}"
            setattr(module, class_name, provider)
            entries.append(f"{label} = {module.__name__}:{class_name}")
        (distribution / "entry_points.txt").write_text("\n".join(entries) + "\n")
        assert bool(providers or missing_import) == any(
            entrypoint.dist is not None and entrypoint.dist.metadata["Name"] == "example-mlflow-auth"
            for entrypoint in metadata.entry_points(group="mlflow.request_auth_provider")
        )

    return install


def install_transport(monkeypatch: pytest.MonkeyPatch, respond: Any) -> list[Any]:
    ssl_contexts: list[Any] = []

    def connection(adapter: Any, request: requests.PreparedRequest, verify: Any, **kwargs: Any) -> Any:
        ssl_contexts.append(adapter.ssl_context)
        request_url = request.url
        assert request_url is not None

        def send(**arguments: Any) -> HTTPResponse:
            assert arguments["redirect"] is False
            assert arguments["retries"].total == 0
            assert arguments["preload_content"] is False
            assert arguments["decode_content"] is False
            timeout = arguments["timeout"]
            response = respond(
                httpx.Request(
                    arguments["method"],
                    request_url,
                    headers=dict(arguments["headers"]),
                    content=arguments["body"],
                    extensions={"timeout": {"connect": timeout.connect_timeout, "read": timeout.read_timeout}},
                )
            )
            content = (
                gzip.compress(response.content)
                if response.headers.get("Content-Encoding") == "gzip"
                else response.content
            )
            headers = [(key, value) for key, value in response.headers.multi_items() if key.lower() != "content-length"]
            headers.append(("Content-Length", str(len(content))))
            header_bytes = "\r\n".join(f"{key}: {value}" for key, value in headers).encode("latin1")
            socket = Mock()
            socket.makefile.return_value = BytesIO(
                f"HTTP/1.1 {response.status_code} {response.reason_phrase}\r\n".encode()
                + header_bytes
                + b"\r\n\r\n"
                + content
            )
            raw = StandardHTTPResponse(socket, method=arguments["method"])
            raw.begin()
            return HTTPResponse(
                body=raw,
                headers=dict(raw.headers.items()),
                status=raw.status,
                reason=raw.reason,
                original_response=raw,
                request_method=arguments["method"],
                preload_content=False,
                decode_content=False,
            )

        return Mock(urlopen=send)

    def create_client(*, ssl_context=None):
        ssl_contexts.append(ssl_context)
        return httpx.Client(transport=httpx.MockTransport(respond), verify=ssl_context or True, trust_env=False)

    monkeypatch.setattr("core.ops.provider_export.ssrf_proxy.create_http_client", create_client)
    monkeypatch.setattr(HTTPAdapter, "get_connection_with_tls_context", connection)
    return ssl_contexts


def test_plugin_selection_uses_declared_name_and_captures_import_identity(
    install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    auth_calls: list[str] = []

    class WrongName:
        def get_name(self):
            return "unselected"

        def get_auth(self):
            raise AssertionError("Entry-point label is not the provider name")

    class Selected:
        def get_name(self):
            return "custom"

        def get_auth(self):
            auth_calls.append("selected")
            return ("plugin-user", "plugin-secret")

    install_plugins({"custom": WrongName, "different-label": Selected}, missing_import=True)
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "custom")
    captured = resolve_provider_config("mlflow", {"tracking_uri": "https://tracker.example"})
    selected = captured["_runtime_settings"]["request_auth_provider"]
    assert selected == {
        "name": "custom",
        "entrypoint": "different-label",
        "value": "example_mlflow_auth:Provider1",
        "distribution": "example-mlflow-auth",
        "version": "1.0",
    }
    assert auth_calls == []
    assert "plugin-secret" not in json.dumps(captured)
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "unrelated")
    monkeypatch.setattr(MLflowConfig, "load_runtime_settings", Mock(side_effect=AssertionError("Selection reread")))
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    client = MLflowTraceClient("mlflow", captured)
    assert client.verify_credentials()
    assert sent[0].headers["Authorization"] == basic_auth("plugin-user", "plugin-secret")
    assert auth_calls == ["selected"]


@pytest.mark.parametrize("existing_auth", ["saved", "environment", "bearer"])
def test_auth_runs_on_each_prepared_url_body_and_existing_authentication(
    existing_auth: str, install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    config: dict[str, Any] = {"tracking_uri": "https://tracker.example/prefix"}
    if existing_auth == "saved":
        config.update(username="saved-user", password="saved-secret")
        expected_auth = basic_auth("saved-user", "saved-secret")
    elif existing_auth == "environment":
        monkeypatch.setenv("MLFLOW_TRACKING_USERNAME", "env-user")
        monkeypatch.setenv("MLFLOW_TRACKING_PASSWORD", "env-secret")
        expected_auth = basic_auth("env-user", "env-secret")
    else:
        monkeypatch.setenv("MLFLOW_TRACKING_TOKEN", "env-token")
        expected_auth = "Bearer env-token"
    auth_calls: list[int] = []

    class SignRequest(AuthBase):
        def __call__(self, request):
            assert request.headers["Authorization"] == expected_auth
            replacement = request.copy()
            if replacement.method == "PUT":
                replacement.method = "PATCH"
            if "?" in replacement.url:
                replacement.url += "&signed=yes"
            replacement.body = (request.body or b"") + b"\nplugin-suffix"
            signed = f"{replacement.method} {replacement.url}\n".encode() + replacement.body
            replacement.headers["X-Plugin-Signature"] = hmac.digest(b"signing-key", signed, "sha256").hex()
            return replacement

    class Provider:
        def get_name(self):
            return "body-signer"

        def get_auth(self):
            auth_calls.append(1)
            return SignRequest()

    install_plugins({"signer-entrypoint": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "body-signer")
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        signed = f"{request.method} {request.url}\n".encode() + request.content
        assert request.headers["X-Plugin-Signature"] == hmac.digest(b"signing-key", signed, "sha256").hex()
        assert int(request.headers["Content-Length"]) == len(request.content)
        assert request.headers["Authorization"] == expected_auth
        sent.append(request)
        return httpx.Response(200)

    install_transport(monkeypatch, respond)
    client = MLflowTraceClient("mlflow", config)
    client.http.request("POST", "api/trace", params={"query": "a + b"}, json={"prompt": "你好"})
    client.http.request("PUT", "api/trace/", content=b"trace bytes")
    assert len(auth_calls) == len(sent) == 2
    assert sent[0].url.params["query"] == "a + b"
    assert sent[1].content == b"trace bytes\nplugin-suffix"
    assert sent[1].method == "PATCH"
    assert sent[1].url.path.endswith("/api/trace/")


@pytest.mark.parametrize("compressed", [False, True])
@pytest.mark.parametrize("expire_after_challenge", [False, True])
def test_digest_challenge_cookies_tls_and_retries_use_the_same_deadline(
    compressed: bool, expire_after_challenge: bool, install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    challenges: list[bytes] = []

    class Provider:
        def get_name(self):
            return "digest"

        def get_auth(self):
            def read_challenge(response, **kwargs):
                if response.status_code == 401:
                    challenges.append(response.raw.read(decode_content=True))
                    assert response.raw.status == 401
                    assert response.raw.headers["Set-Cookie"] == "challenge-session=owned; Path=/"
                    assert response.raw._original_response.msg["Set-Cookie"] == "challenge-session=owned; Path=/"
                    assert response.raw._original_response._method == "GET"
                return response

            def authenticate(request):
                request.register_hook("response", read_challenge)
                return HTTPDigestAuth("alice", "digest-secret")(request)

            return authenticate

    install_plugins({"digest-plugin": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "digest")
    client = MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example"})
    client.http.deadline = monotonic() + 10
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        assert all(0 < value <= 10 for value in request.extensions["timeout"].values())
        if len(sent) == 1:
            assert "Authorization" not in request.headers
            if expire_after_challenge:
                client.http.deadline = monotonic() - 1
            return httpx.Response(
                401,
                headers={
                    "WWW-Authenticate": 'Digest realm="tracker", nonce="challenge", qop="auth"',
                    "Set-Cookie": "challenge-session=owned; Path=/",
                    **({"Content-Encoding": "gzip"} if compressed else {}),
                },
                content=(
                    gzip.compress(b"raw authentication challenge") if compressed else b"raw authentication challenge"
                ),
            )
        assert request.headers["Cookie"] == "challenge-session=owned"
        fields = parse_dict_header(request.headers["Authorization"].removeprefix("Digest "))
        assert fields["username"] == "alice"

        def digest(value: str) -> str:
            return hashlib.md5(value.encode()).hexdigest()

        first = digest("alice:tracker:digest-secret")
        second = digest(f"{request.method}:{fields['uri']}")
        assert fields["response"] == digest(f"{first}:challenge:{fields['nc']}:{fields['cnonce']}:auth:{second}")
        return httpx.Response(
            200,
            headers={"Content-Encoding": "gzip"} if compressed else {},
            content=gzip.compress(b"authorized") if compressed else b"authorized",
        )

    contexts = install_transport(monkeypatch, respond)
    if expire_after_challenge:
        with pytest.raises(TraceExportError, match="^export_deadline_exceeded$"):
            client.verify_credentials()
        assert len(sent) == 1
    else:
        assert client.verify_credentials()
        assert len(sent) == 2
    assert all(context is client.http.ssl_context for context in contexts)
    assert challenges == [b"raw authentication challenge"]


def test_compressed_auth_response_returns_decoded_content_once(monkeypatch: pytest.MonkeyPatch) -> None:
    content = b'{"authorized":true}'
    install_transport(
        monkeypatch,
        lambda request: httpx.Response(
            200,
            headers={"Content-Encoding": "gzip", "Content-Type": "application/json"},
            content=gzip.compress(content),
        ),
    )
    provider = Mock()
    provider.get_auth.return_value = ("user", "secret")
    response = request_auth.send_authenticated_request(
        TraceProviderHttpClient("https://tracker.example"), provider, "GET", ""
    )
    assert response.json() == {"authorized": True}
    assert response.content == content
    assert response.headers["Content-Length"] == str(len(content))
    assert "Content-Encoding" not in response.headers


@pytest.mark.parametrize("header_value", [b"ascii-token", b"caf\xc3\xa9", b"caf\xe9"])
def test_plugin_byte_headers_reach_transport_unchanged(
    header_value: bytes, install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Provider:
        def get_name(self):
            return "byte-headers"

        def get_auth(self):
            def authorize(request):
                request.headers["X-Plugin-Token"] = header_value
                return request

            return authorize

    install_plugins({"byte-header-plugin": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "byte-headers")
    received: list[bytes] = []

    def respond(request: httpx.Request) -> httpx.Response:
        received.append(next(value for key, value in request.headers.raw if key.lower() == b"x-plugin-token"))
        return httpx.Response(200)

    install_transport(monkeypatch, respond)
    assert MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example"}).verify_credentials()
    assert received == [header_value]


def test_native_auth_challenges_reuse_socket_and_close_operation_pool(
    install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    connections: list[tuple[str, int]] = []
    sockets: list[Any] = []

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            connections.append(self.client_address)
            authorization = self.headers.get("Authorization")
            if authorization != "Challenge complete":
                self.send_response(401)
                self.send_header("WWW-Authenticate", "Challenge")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            content = gzip.compress(b'{"authorized":true}')
            self.send_response(200)
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        @override
        def log_message(self, format, *args):
            pass

    class Provider:
        def get_name(self):
            return "connection-auth"

        def get_auth(self):
            def challenge(response, **kwargs):
                # Native connection-auth plugins inspect this socket before consuming
                # the challenge, then release it to the same adapter's pool for reuse.
                first_socket = response.raw._fp.fp.raw._sock
                sockets.append(first_socket)
                assert first_socket.fileno() >= 0
                assert response.content == b""
                response.raw.release_conn()
                prepared = response.request.copy()
                prepared.headers["Authorization"] = "Challenge negotiate"
                negotiate = response.connection.send(prepared, **kwargs)
                sockets.append(negotiate.raw._fp.fp.raw._sock)
                assert sockets[-1] is first_socket
                assert negotiate.content == b""
                negotiate.raw.release_conn()
                prepared = negotiate.request.copy()
                prepared.headers["Authorization"] = "Challenge complete"
                authenticated = negotiate.connection.send(prepared, **kwargs)
                authenticated.history.extend([response, negotiate])
                return authenticated

            def authenticate(request):
                request.headers["Connection"] = "Keep-Alive"
                request.register_hook("response", challenge)
                return request

            return authenticate

    install_plugins({"connection-auth-plugin": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "connection-auth")
    monkeypatch.setattr("core.helper.ssrf_requests.ssrf_proxy.get_proxy_urls", lambda: {})
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = MLflowTraceClient("mlflow", {"tracking_uri": f"http://127.0.0.1:{server.server_port}"})
        for _ in range(2):
            assert client.http.request("GET", "authenticate").json() == {"authorized": True}
        assert len(connections) == 6
        assert connections[0] == connections[1] == connections[2]
        assert connections[3] == connections[4] == connections[5]
        assert connections[0] != connections[3]
        assert sockets[0] is not sockets[2]
        assert all(socket.fileno() == -1 for socket in sockets)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


@pytest.mark.parametrize(
    ("failure", "expected_reason", "retryable"),
    [
        (requests.ConnectionError, "provider_unreachable", True),
        (requests.Timeout, "provider_unreachable", True),
        (requests.exceptions.ChunkedEncodingError, "provider_unreachable", True),
        (requests.exceptions.ContentDecodingError, "provider_unreachable", True),
        (ToolSSRFError, "provider_ssrf_blocked", False),
    ],
)
def test_native_transport_failures_keep_safe_retry_policy(
    failure: type[Exception], expected_reason: str, retryable: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(HTTPAdapter, "send", Mock(side_effect=failure("credential-that-must-not-escape")))
    provider = Mock()
    provider.get_auth.return_value = ("user", "secret")
    with pytest.raises(TraceExportError) as error:
        request_auth.send_authenticated_request(TraceProviderHttpClient("https://tracker.example"), provider, "GET", "")
    assert str(error.value) == expected_reason
    assert error.value.retryable is retryable
    assert error.value.__suppress_context__


@pytest.mark.parametrize("route", ["otlp", "artifact-v3", "artifact-v2"])
def test_concurrent_clients_keep_owned_plugins_on_tracking_otlp_and_artifact_routes(
    route: str, install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    instances: list[Any] = []

    class Provider:
        def __init__(self):
            import os

            self.token = os.environ["EXAMPLE_AUTH_TOKEN"]
            self.calls = 0
            instances.append(self)

        def get_name(self):
            return "per-attempt"

        def get_auth(self):
            self.calls += 1
            token = self.token

            def authorize(request):
                request.headers["Authorization"] = f"Bearer {token}"
                request.headers["X-Plugin-Body"] = hashlib.sha256(request.body or b"").hexdigest()
                return request

            return authorize

    install_plugins({"owned-plugin": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "per-attempt")
    traces = {owner: make_completed_trace() for owner in ("first", "second")}
    clients: dict[str, MLflowTraceClient] = {}
    for owner in traces:
        monkeypatch.setenv("EXAMPLE_AUTH_TOKEN", f"{owner}-secret")
        clients[owner] = MLflowTraceClient(
            "mlflow", {"tracking_uri": f"https://{owner}-tracker.example/prefix", "experiment_id": "7"}
        )
    monkeypatch.setenv("EXAMPLE_AUTH_TOKEN", "unrelated-secret")
    barrier = Barrier(2)
    sent: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        owner = request.url.host.split("-", 1)[0]
        assert request.headers["Authorization"] == f"Bearer {owner}-secret"
        assert request.headers["X-Plugin-Body"] == hashlib.sha256(request.content).hexdigest()
        if "artifacts" in request.url.host:
            assert request.method == "PUT"
            assert "X-Tracking-Only" not in request.headers
            assert json.loads(request.content)["spans"]
            return httpx.Response(200)
        if request.url.path.endswith("/experiments/get"):
            barrier.wait(timeout=5)
            return httpx.Response(200)
        if request.url.path.endswith("/v1/traces"):
            return httpx.Response(200 if route == "otlp" else 404)
        if "/api/3.0/mlflow/traces/" in request.url.path:
            return httpx.Response(404)
        if request.url.path.endswith("/api/3.0/mlflow/traces"):
            if route == "artifact-v2":
                return httpx.Response(404)
            info = json.loads(request.content)["trace"]["trace_info"]
            info["tags"]["mlflow.artifactLocation"] = f"https://{owner}-artifacts.example/traces/{owner}"
            return httpx.Response(200, json={"trace": {"trace_info": info}})
        if request.method == "GET":
            return httpx.Response(200, json={"traces": []})
        if request.method == "POST":
            fields = json.loads(request.content)
            return httpx.Response(
                200,
                json={
                    "trace_info": {
                        **fields,
                        "request_id": "tr-" + uuid4().hex,
                        "tags": [
                            *fields["tags"],
                            {"key": "mlflow.artifactLocation", "value": f"https://{owner}-artifacts.example/trace"},
                        ],
                    }
                },
            )
        assert request.method == "PATCH"
        return httpx.Response(200)

    install_transport(monkeypatch, respond)

    def export(owner: str) -> None:
        client = clients[owner]
        assert client.verify_credentials()
        client.http.headers["X-Tracking-Only"] = "tracking"
        client.export_trace(traces[owner])

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = [executor.submit(export, owner) for owner in traces]
        for result in results:
            result.result(timeout=10)
    assert all(client._request_auth_provider.calls > 1 for client in clients.values())
    assert clients["first"]._request_auth_provider is not clients["second"]._request_auth_provider
    assert sum(provider.calls for provider in instances) == len(sent)
    assert any("artifacts" in request.url.host for request in sent) == (route != "otlp")


@pytest.mark.parametrize("override", ["aws", "kubernetes"])
def test_native_authentication_keeps_precedence_over_custom_entrypoints(
    override: str, install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Provider:
        def __init__(self):
            raise AssertionError("Native authentication must not initialize an unused plugin")

    install_plugins({"unused-plugin": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "custom" if override == "aws" else "kubernetes")
    config = {"tracking_uri": "https://tracker.example", "username": "saved", "password": "secret"}
    if override == "aws":
        monkeypatch.setattr(
            "dify_trace_mlflow.config.resolve_aws_credentials",
            lambda **kwargs: {"access_key": "key", "secret_key": "secret", "token": None, "region": "us-east-1"},
        )
    else:
        monkeypatch.setenv("MLFLOW_TRACKING_USERNAME", "env-user")
        monkeypatch.setenv("MLFLOW_TRACKING_PASSWORD", "env-password")
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    assert MLflowTraceClient("mlflow", config).verify_credentials()
    if override == "aws":
        assert sent[0].headers["Authorization"].startswith("AWS4-HMAC-SHA256 ")
    else:
        assert sent[0].headers["Authorization"] == basic_auth("saved", "secret")


@pytest.mark.parametrize("failure", ["construct", "name", "get_auth", "apply", "hook"])
def test_plugin_failures_are_sanitized(failure: str, install_plugins: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "credential-that-must-not-escape"

    class Provider:
        def __init__(self):
            if failure == "construct":
                raise ValueError(secret)

        def get_name(self):
            if failure == "name":
                raise ValueError(secret)
            return "failing"

        def get_auth(self):
            if failure == "get_auth":
                raise ValueError(secret)

            def fail(response, **kwargs):
                raise ValueError(secret)

            def authenticate(request):
                if failure == "apply":
                    raise ValueError(secret)
                request.register_hook("response", fail)
                return request

            return authenticate

    install_plugins({"failing-plugin": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "failing")
    install_transport(monkeypatch, lambda request: httpx.Response(200))
    with pytest.raises((ValueError, TraceExportError)) as error:
        MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example"}).verify_credentials()
    assert secret not in str(error.value)
    assert error.value.__suppress_context__


def test_missing_plugin_preserves_existing_credentials_and_changed_imports_fail(
    install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_plugins({})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "missing")
    captured = resolve_provider_config(
        "mlflow", {"tracking_uri": "https://tracker.example", "username": "saved", "password": "secret"}
    )
    assert captured["_runtime_settings"]["request_auth_provider"] == {"name": "missing"}
    sent: list[httpx.Request] = []
    install_transport(monkeypatch, lambda request: sent.append(request) or httpx.Response(200))
    assert MLflowTraceClient("mlflow", captured).verify_credentials()
    assert sent[0].headers["Authorization"] == basic_auth("saved", "secret")
    with pytest.raises(TraceExportError, match="^mlflow_auth_plugin_changed$"):
        request_auth.load_request_auth_provider({"name": "missing", "entrypoint": "removed"})


def test_auth_hooks_do_not_enable_redirects_or_hide_terminal_http_failures(
    install_plugins: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Provider:
        def get_name(self):
            return "basic-plugin"

        def get_auth(self):
            return ("user", "secret")

    install_plugins({"basic-plugin": Provider})
    monkeypatch.setenv("MLFLOW_TRACKING_AUTH", "basic-plugin")
    sent: list[httpx.Request] = []
    install_transport(
        monkeypatch,
        lambda request: sent.append(request) or httpx.Response(307, headers={"Location": "https://elsewhere.example"}),
    )
    with pytest.raises(TraceExportError, match="^provider_http_307$") as error:
        MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example"}).verify_credentials()
    assert not error.value.retryable
    assert len(sent) == 1

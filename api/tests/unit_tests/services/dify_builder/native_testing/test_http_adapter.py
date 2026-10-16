"""Real Graphon/SSRF/scalar composition; C02/C03 and lower transport are stand-ins.

Loopback test alone uses real HTTP transport, inside network-none Linux runner.
No production input, credential, file identity or binding producer is qualified.
"""

import importlib
import importlib.util
import io
import logging
import threading
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import override

import httpx
import pytest
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.utils import is_instrumentation_enabled
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from core.helper import ssrf_proxy
from dify_app import DifyApp
from extensions import ext_logging
from graphon.file.file_manager import file_manager
from graphon.http import HttpResponse
from graphon.nodes.http_request.entities import HttpRequestNodeConfig, HttpRequestNodeData, HttpRequestNodeTimeout
from graphon.nodes.http_request.executor import Executor
from graphon.runtime import VariablePool
from libs.sensitive_http_telemetry import SensitiveHttpLogFilter
from services.dify_builder.execution_contracts import canonical_digest
from services.dify_builder.native_testing.call_adapter import NativeCallAdapter
from services.dify_builder.native_testing.contracts import ApprovalWait, EffectIntent, PolicyStop
from services.dify_builder.native_testing.control import NativeApprovalWait, NativePolicyStop
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import (
    INPUT,
    PATH,
    REF,
    Authorization,
    State,
)


@pytest.fixture(autouse=True)
def protected_application_logs(monkeypatch):
    """Initialize real app filters once; also protect pytest's existing sinks.

    Pytest reattaches its setup capture handlers during the call phase. Their
    test-only initialization uses the exact application filter, so readiness
    still inspects actual handlers and never a mocked readiness assertion.
    """
    root = logging.getLogger()
    old_handlers, old_level = root.handlers[:], root.level
    old_filters = {handler: handler.filters[:] for handler in old_handlers}
    for handler in old_handlers:
        handler.addFilter(SensitiveHttpLogFilter())
    root.handlers = []
    apply_config_overrides(monkeypatch, LOG_FILE=None, LOG_LEVEL="INFO", LOG_OUTPUT_FORMAT="text", LOG_TZ="")
    ext_logging.init_app(DifyApp(__name__))
    owned_handlers = root.handlers[:]
    try:
        yield
    finally:
        for handler in owned_handlers:
            handler.close()
        for handler, filters in old_filters.items():
            handler.filters = filters
        root.handlers = old_handlers
        root.setLevel(old_level)


def owner():
    name = "services.dify_builder.native_testing.http_adapter"
    assert importlib.util.find_spec(name) is not None, "native HTTP owner is not implemented"
    return importlib.import_module(name)


class IntentProducer:
    """Synthetic trusted producer; no claim of real secret/file identity matching."""

    def __init__(self, cursor):
        self.cursor = cursor
        self.requests = []
        self.change = None

    def prepare(self, *, request, hop, previous_response):
        self.requests.append((request, hop, previous_response))
        intent = EffectIntent(
            key=self.cursor.next_key(),
            kind="http",
            resource_ref="http-node",
            implementation_revision="http-v1",
            account_ref=None,
            target={"host": httpx.URL(request.url).host},
            parameters={"method": request.method, "synthetic_request_digest": canonical_digest(request.material())},
            input_digest=canonical_digest(INPUT),
            capability_digest="b" * 64,
        )
        result = owner().PreparedHttpBinding(request=request, intent=intent)
        return self.change(result) if self.change else result


class Harness:
    def __init__(self, monkeypatch, *, hops=3, response_bytes=4096):
        self.module = owner()
        self.events = []
        self.state, self.auth = State(self.events), Authorization(self.events)
        self.journal = NodeOperationJournal(state=self.state, authorization=self.auth)
        self.cursor = self.journal.open(ref=REF, occurrence_path=PATH)
        self.cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
        self.producer = IntentProducer(self.cursor)
        self.calls = NativeCallAdapter(
            state=self.state, authorization=self.auth, journal=self.journal, max_result_bytes=65536
        )
        self.client = self.module.NativeHttpClient(
            ref=REF,
            calls=self.calls,
            intents=self.producer,
            max_redirect_hops=hops,
            max_response_bytes=response_bytes,
        )
        self.sent = []
        self.responses = []
        self.reply = lambda request: httpx.Response(200, content=b"ok", request=request)
        self.lower = httpx.Client(transport=httpx.MockTransport(self.transport))
        monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _verify: self.lower)
        monkeypatch.setattr(ssrf_proxy, "_inject_trace_headers", lambda headers: headers)
        self.monkeypatch = monkeypatch

    def transport(self, request):
        self.events.append(("physical", request.method))
        self.sent.append(request)
        response = self.reply(request)
        self.responses.append(response)
        return response

    def request(self, method="post", url="https://first.example/path", **kwargs):
        args = {
            "headers": {},
            "params": None,
            "json": None,
            "data": None,
            "files": None,
            "content": None,
            "timeout": (2, 2, 2),
            "ssl_verify": True,
            "follow_redirects": True,
        }
        args.update(kwargs)
        return getattr(self.client, method)(url, max_retries=0, **args)

    def replay(self):
        self.cursor = self.journal.open(ref=REF, occurrence_path=PATH)
        self.cursor.bind_input(input_result_ref="inputs", inputs=INPUT)
        self.producer.cursor = self.cursor


@pytest.fixture
def harness(monkeypatch):
    value = Harness(monkeypatch)
    yield value
    value.lower.close()


def test_real_ssrf_scalar_roundtrip_preserves_response_and_replays_without_dispatch(harness):
    harness.reply = lambda request: httpx.Response(
        422,
        headers={"Content-Type": "text/plain; charset=iso-8859-1", "X-Case": "VALUE"},
        content=b"\xff\x00",
        request=request,
    )
    result = harness.request(json={"bool": True, "items": [1, "1", False]})
    assert isinstance(result, HttpResponse)
    assert (result.status_code, result.content, result.text, result.reason_phrase) == (
        422,
        b"\xff\x00",
        "ÿ\x00",
        "Unprocessable Entity",
    )
    assert result.headers["x-case"] == "VALUE"
    assert not result.is_success
    assert len(harness.sent) == 1
    assert harness.events.index(("claim", 0)) < harness.events.index(("physical", "POST"))
    harness.cursor.finish()
    harness.replay()
    again = harness.request(json={"bool": True, "items": [1, "1", False]})
    assert (again.content, again.text, again.status_code) == (result.content, result.text, result.status_code)
    assert len(harness.sent) == 1
    harness.cursor.finish()


@pytest.mark.parametrize("reason", ["approval", "configuration", "interaction"])
def test_wait_before_transport_is_private_and_has_no_dispatch(harness, reason):
    harness.auth.decisions[0] = ApprovalWait(pending_operation_id="pending", wait_reason=reason)
    with pytest.raises(NativeApprovalWait) as caught:
        harness.request()
    assert caught.value.wait_reason == reason
    assert harness.sent == []


@pytest.mark.parametrize("method", ["get", "head", "post", "put", "delete", "patch"])
def test_protocol_methods_use_actual_ssrf_owner_without_retry(harness, method):
    harness.request(method=method)
    assert [request.method for request in harness.sent] == [method.upper()]


@pytest.mark.parametrize("retry", [1, -1, True, None, "0"])
def test_retry_option_refused_before_preparation_or_dispatch(harness, retry):
    with pytest.raises(NativePolicyStop):
        harness.client.post("https://first.example", max_retries=retry)
    assert harness.producer.requests == []
    assert harness.sent == []


def test_native_executor_prepares_typed_json_query_and_header_before_attestation(harness):
    pool = VariablePool.from_bootstrap(system_variables=[], user_inputs={})
    pool.add(["input", "payload"], {"enabled": True, "values": [False, 2, "2"]})
    pool.add(["input", "header"], "resolved")
    executor = Executor(
        node_data=HttpRequestNodeData.model_validate(
            {
                "title": "HTTP",
                "method": "post",
                "url": "https://first.example/path",
                "authorization": {"type": "no-auth"},
                "headers": "X-Value: {{#input.header#}}",
                "params": "q: one\nq: two",
                "body": {"type": "json", "data": [{"key": "", "type": "text", "value": "{{#input.payload#}}"}]},
            }
        ),
        timeout=HttpRequestNodeTimeout(connect=2, read=2, write=2),
        variable_pool=pool,
        http_request_config=HttpRequestNodeConfig(
            max_connect_timeout=2,
            max_read_timeout=2,
            max_write_timeout=2,
            max_binary_size=4096,
            max_text_size=4096,
            ssl_verify=True,
            ssrf_default_max_retries=0,
        ),
        max_retries=0,
        http_client=harness.client,
        file_manager=file_manager,
    )
    response = executor.invoke()
    assert response.status_code == 200
    prepared = harness.producer.requests[0][0]
    assert prepared.arguments()["json"] == {"enabled": True, "values": [False, 2, "2"]}
    assert prepared.arguments()["params"] == [("q", "one"), ("q", "two")]
    assert harness.sent[0].headers["x-value"] == "resolved"
    assert harness.sent[0].url.query == b"q=one&q=two"


def test_frozen_snapshot_and_binding_never_expose_or_mutate_secret_values(harness):
    headers = {"X-Token": "private-canary"}
    files = [("upload", ("private-canary", b"\x00\xff", "application/octet-stream"))]
    harness.request(headers=headers, files=files)
    request = harness.producer.requests[0][0]
    assert "private-canary" not in repr(request)
    assert "private-canary" not in repr(harness.module.PreparedHttpBinding(request=request, intent=None))
    headers["X-Token"] = "changed"
    extracted = request.arguments()
    extracted["headers"]["X-Token"] = "changed-again"
    assert request.arguments()["headers"] == {"X-Token": "private-canary", "Cookie": ""}
    assert request.arguments()["files"] == files
    assert files == [("upload", ("private-canary", b"\x00\xff", "application/octet-stream"))]


@pytest.mark.parametrize("change", ["request", "kind", "invocation", "bare"])
def test_attestation_substitution_and_invalid_intent_fail_before_claim(harness, change):
    def tamper(binding):
        if change == "request":
            return replace(binding, request=replace(binding.request))
        if change == "bare":
            return binding.intent
        intent = (
            binding.intent.model_copy(update={"kind": "tool"})
            if change == "kind"
            else binding.intent.model_copy(
                update={"key": binding.intent.key.model_copy(update={"invocation_id": "other"})}
            )
        )
        return replace(binding, intent=intent)

    harness.producer.change = tamper
    with pytest.raises(NativePolicyStop):
        harness.request()
    assert harness.sent == []
    assert harness.auth.claimed == set()


@pytest.mark.parametrize(("code", "expected"), [(301, "GET"), (302, "GET"), (303, "GET"), (307, "POST"), (308, "POST")])
def test_redirect_hops_have_separate_authority_and_native_method_semantics(harness, code, expected):
    harness.reply = lambda request: (
        httpx.Response(code, headers={"Location": "https://second.example/next"}, request=request)
        if len(harness.sent) == 1
        else httpx.Response(201, content=b"done", request=request)
    )
    response = harness.request(
        headers={"Authorization": "secret", "Proxy-Authorization": "secret", "Cookie": "secret"}, content=b"body"
    )
    assert response.status_code == 201
    assert [request.method for request in harness.sent] == ["POST", expected]
    assert "authorization" not in harness.sent[1].headers
    assert "proxy-authorization" not in harness.sent[1].headers
    assert harness.sent[1].headers.get("cookie", "") == ""
    assert harness.sent[1].content == (b"body" if expected == "POST" else b"")
    assert harness.auth.claimed == {0, 1}
    harness.cursor.finish()
    harness.replay()
    assert (
        harness.request(
            headers={"Authorization": "secret", "Proxy-Authorization": "secret", "Cookie": "secret"}, content=b"body"
        ).status_code
        == 201
    )
    assert len(harness.sent) == 2


def test_redirect_to_new_host_waits_after_first_response_and_replays_first_hop(harness):
    harness.reply = lambda request: httpx.Response(
        302, headers={"Location": "https://second.example/next"}, request=request
    )
    harness.auth.decisions[1] = ApprovalWait(pending_operation_id="next-host", wait_reason="approval")
    with pytest.raises(NativeApprovalWait):
        harness.request()
    assert len(harness.sent) == 1
    assert harness.auth.claimed == {0}
    harness.replay()
    with pytest.raises(NativeApprovalWait):
        harness.request()
    assert len(harness.sent) == 1


def test_redirect_budget_does_not_dispatch_extra_hop(monkeypatch):
    value = Harness(monkeypatch, hops=0)
    value.reply = lambda request: httpx.Response(302, headers={"Location": "/next"}, request=request)
    with pytest.raises(NativePolicyStop) as caught:
        value.request()
    assert caught.value.reason_code == "native_http_redirect_limit"
    assert len(value.sent) == 1
    value.lower.close()


class Stream(httpx.SyncByteStream):
    def __init__(self, mode):
        self.mode, self.closes = mode, 0

    @override
    def __iter__(self):
        yield b"one"
        if self.mode == "truncate":
            raise httpx.ReadError("private-canary")
        yield b"two"

    @override
    def close(self):
        self.closes += 1
        if self.mode == "close":
            raise RuntimeError("private-canary")


@pytest.mark.parametrize("mode", ["truncate", "close", "large", "encoding"])
def test_response_uncertainty_closes_once_stays_unknown_and_never_resends(harness, mode):
    stream = Stream(mode)
    if mode == "large":
        harness.client._max_response_bytes = 4
    harness.reply = lambda request: httpx.Response(
        200, headers={"Content-Encoding": "gzip"} if mode == "encoding" else {}, stream=stream, request=request
    )
    with pytest.raises(NativePolicyStop) as caught:
        harness.request()
    assert caught.value.reason_code == "outcome_unknown"
    assert "private-canary" not in str(caught.value)
    assert len(harness.sent) == 1
    assert stream.closes == 1
    assert harness.auth.outcomes[0] == ("unknown", None)
    harness.replay()
    with pytest.raises(NativePolicyStop):
        harness.request()
    assert len(harness.sent) == 1


def test_post_timeout_never_retries_and_retains_dispatch(harness):
    def timeout(request):
        raise httpx.ReadTimeout("private-canary", request=request)

    harness.reply = timeout
    with pytest.raises(NativePolicyStop):
        harness.request()
    assert len(harness.sent) == 1
    assert harness.auth.outcomes[0] == ("unknown", None)


def test_actual_ssrf_rejection_is_unknown_after_dispatch_and_not_retried(harness):
    harness.reply = lambda request: httpx.Response(403, headers={"Server": "squid"}, request=request)
    with pytest.raises(NativePolicyStop):
        harness.request()
    assert len(harness.sent) == 1
    assert harness.auth.outcomes[0] == ("unknown", None)


@pytest.mark.parametrize("failure", ["store", "ack"])
def test_storage_or_completion_ack_uncertainty_never_resends(harness, failure):
    if failure == "store":
        harness.state.store_error = RuntimeError("private-canary")
    else:
        harness.auth.settlement_error = RuntimeError("private-canary")
        harness.auth.settlement_commits = True
    with pytest.raises(NativePolicyStop):
        harness.request()
    assert len(harness.sent) == 1
    harness.replay()
    if failure == "store":
        with pytest.raises(NativePolicyStop):
            harness.request()
    else:
        assert harness.request().content == b"ok"
    assert len(harness.sent) == 1


def test_real_in_container_loopback_canary_counts_allowed_then_denied(harness, monkeypatch):
    counts = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            counts.append(self.path)
            self.send_response(201)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"ok")

        @override
        def log_message(self, format, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    real_client = httpx.Client(trust_env=False)
    monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _verify: real_client)
    try:
        url = f"http://127.0.0.1:{server.server_port}/canary"
        assert harness.request(url=url).status_code == 201
        assert counts == ["/canary"]
        harness.auth.decisions[1] = PolicyStop(reason_code="approval_denied")
        with pytest.raises(NativePolicyStop):
            harness.request(url=url)
        assert counts == ["/canary"]
    finally:
        real_client.close()
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_multipart_preserved_body_redirect_replay_ignores_random_wire_boundary(harness):
    harness.reply = lambda request: (
        httpx.Response(307, headers={"Location": "/upload"}, request=request)
        if len(harness.sent) == 1
        else httpx.Response(200, content=b"done", request=request)
    )
    files = [("file", ("name.bin", b"\x00\xff", "application/octet-stream"))]
    assert harness.request(files=files).content == b"done"
    harness.replay()
    assert harness.request(files=files).content == b"done"
    assert len(harness.sent) == 2


def test_ambient_pooled_client_cookie_never_enters_physical_request(harness):
    harness.lower.cookies.set("ambient", "private-canary", domain="first.example", path="/")
    harness.request()
    assert "private-canary" not in harness.sent[0].headers.get("cookie", "")


def test_same_origin_redirect_preserves_actual_set_cookie_semantics(harness):
    harness.reply = lambda request: (
        httpx.Response(302, headers={"Location": "/next", "Set-Cookie": "chain=admitted; Path=/"}, request=request)
        if len(harness.sent) == 1
        else httpx.Response(200, content=b"ok", request=request)
    )
    harness.request()
    assert harness.sent[1].headers.get("cookie") == "chain=admitted"
    assert httpx.Headers(harness.producer.requests[1][0].headers).get("cookie") == "chain=admitted"


def test_same_origin_chain_cookie_is_preserved_over_more_than_one_redirect(harness):
    harness.reply = lambda request: (
        httpx.Response(302, headers={"Location": "/second", "Set-Cookie": "chain=admitted; Path=/"}, request=request)
        if len(harness.sent) == 1
        else httpx.Response(302, headers={"Location": "/third"}, request=request)
        if len(harness.sent) == 2
        else httpx.Response(200, content=b"ok", request=request)
    )
    harness.request()
    assert [r.headers.get("cookie") for r in harness.sent[1:]] == ["chain=admitted", "chain=admitted"]
    harness.replay()
    assert harness.request().status_code == 200
    assert len(harness.sent) == 3


def test_declared_length_truncated_response_is_unknown(harness):
    harness.reply = lambda request: httpx.Response(
        200, headers={"Content-Length": "20"}, stream=Stream("ok"), request=request
    )
    with pytest.raises(NativePolicyStop) as caught:
        harness.request()
    assert caught.value.reason_code == "outcome_unknown"
    assert harness.auth.outcomes[0] == ("unknown", None)


@pytest.mark.parametrize(
    "policy",
    [
        {"retry_config": {"retry_enabled": True, "max_retries": 2, "retry_interval": 0}},
        {"error_strategy": "default-value", "default_value": [{"key": "body", "type": "string", "value": "fallback"}]},
        {"error_strategy": "fail-branch"},
    ],
)
def test_actual_native_http_node_cannot_convert_wait_to_retry_default_or_fail_branch(harness, policy):
    from tests.unit_tests.core.workflow.nodes.http_request.test_http_request_node import _build_http_node

    base = _build_http_node()
    data = HttpRequestNodeData.model_validate({**base.node_data.model_dump(), **policy})
    node = type(base)(
        node_id="http-node",
        data=data,
        graph_init_params=base.graph_init_params,
        graph_runtime_state=base.graph_runtime_state,
        http_request_config=base._http_request_config,
        http_client=harness.client,
        file_manager=base._file_manager,
        file_reference_factory=base._file_reference_factory,
        tool_file_manager_factory=base._tool_file_manager_factory,
    )
    node.bind_execution_id("http-node-execution")
    harness.auth.decisions[0] = ApprovalWait(pending_operation_id="node-wait", wait_reason="approval")
    with pytest.raises(NativeApprovalWait):
        list(node.run())
    assert harness.sent == []


@pytest.mark.parametrize(
    ("option", "value"),
    [
        ("max_redirect_hops", True),
        ("max_redirect_hops", -1),
        ("max_redirect_hops", "2"),
        ("max_response_bytes", 0),
        ("max_response_bytes", True),
        ("max_response_bytes", None),
    ],
)
def test_admitted_budgets_require_exact_finite_integers(harness, option, value):
    budgets = {"max_redirect_hops": 2, "max_response_bytes": 4096, option: value}
    with pytest.raises(ValueError):
        harness.module.NativeHttpClient(ref=REF, calls=harness.calls, intents=harness.producer, **budgets)


@pytest.mark.parametrize(
    ("option", "value"),
    [
        ("timeout", (1, None, 2)),
        ("timeout", (1, float("inf"), 2)),
        ("timeout", (1, True, 2)),
        ("ssl_verify", "true"),
        ("headers", {"X": True}),
        ("auth", ("user", "secret")),
        ("json", float("nan")),
        ("content", iter([b"stream"])),
    ],
)
def test_unadmitted_or_nonfinite_material_refused_before_intent(harness, option, value):
    with pytest.raises(NativePolicyStop):
        harness.request(**{option: value})
    assert harness.sent == []
    assert harness.producer.requests == []


def test_cross_origin_domain_cookie_does_not_forward_or_reappear_from_pool(harness):
    harness.reply = lambda request: (
        httpx.Response(
            302,
            headers={
                "Location": "https://other.first.example/next",
                "Set-Cookie": "chain=private-canary; Domain=first.example; Path=/",
            },
            request=request,
        )
        if len(harness.sent) == 1
        else httpx.Response(200, content=b"ok", request=request)
    )
    harness.request()
    assert harness.sent[1].headers.get("cookie", "") == ""
    assert httpx.Headers(harness.producer.requests[1][0].headers).get("cookie") == ""


def test_actual_ssrf_request_error_diagnostics_do_not_emit_request_secrets(harness, caplog):
    def timeout(request):
        raise httpx.ReadTimeout("private-canary-error", request=request)

    harness.reply = timeout
    with pytest.raises(NativePolicyStop):
        harness.request(url="https://first.example/private-canary-url?token=private-canary-query")
    assert "private-canary" not in caplog.text


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
@pytest.mark.parametrize("method", ["post", "get", "head"])
def test_redirect_compatibility_with_actual_locked_httpx(harness, code, method):
    baseline = []

    def baseline_transport(request):
        baseline.append(request)
        return (
            httpx.Response(code, headers={"Location": "/next?new=2"}, request=request)
            if len(baseline) == 1
            else httpx.Response(200, request=request)
        )

    with httpx.Client(transport=httpx.MockTransport(baseline_transport), trust_env=False) as native:
        native.request(
            method,
            "https://first.example/path?old=1",
            headers={"Content-Type": "text/plain", "X-Native": "same"},
            content=b"body",
            follow_redirects=True,
        )
    harness.reply = lambda request: (
        httpx.Response(code, headers={"Location": "/next?new=2"}, request=request)
        if len(harness.sent) == 1
        else httpx.Response(200, request=request)
    )
    harness.request(
        method=method,
        url="https://first.example/path?old=1",
        headers={"Content-Type": "text/plain", "X-Native": "same"},
        content=b"body",
    )
    expected, actual = baseline[1], harness.sent[1]
    assert (actual.method, str(actual.url), actual.content) == (expected.method, str(expected.url), expected.content)
    for header in ("Content-Length", "Content-Type", "Host", "X-Native"):
        assert actual.headers.get(header) == expected.headers.get(header)


@pytest.mark.parametrize("status", [599, 600, 799])
def test_nonstandard_http_status_preserves_actual_native_response_semantics(harness, status):
    harness.reply = lambda request: httpx.Response(status, content=b"body", request=request)
    response = harness.request()
    assert response.status_code == status
    assert response.content == b"body"
    assert not response.is_success


def test_successful_owned_stream_closes_once_and_current_denial_blocks_replay(harness):
    stream = Stream("ok")
    harness.reply = lambda request: httpx.Response(200, stream=stream, request=request)
    assert harness.request().content == b"onetwo"
    assert stream.closes == 1
    harness.replay()
    harness.auth.decisions[0] = PolicyStop(reason_code="approval_denied")
    with pytest.raises(NativePolicyStop) as caught:
        harness.request()
    assert caught.value.reason_code == "approval_denied"
    assert len(harness.sent) == 1
    assert stream.closes == 1


@pytest.mark.parametrize("configuration", ["missing", "unfiltered", "removed", "direct-emitter", "no-propagation"])
def test_unready_telemetry_stops_before_metadata_claim_or_dispatch(harness, monkeypatch, configuration):
    root = logging.getLogger()
    with monkeypatch.context() as patch:
        if configuration == "missing":
            patch.setattr(root, "handlers", [])
        elif configuration == "unfiltered":
            patch.setattr(root, "handlers", [*root.handlers, logging.StreamHandler(io.StringIO())])
        elif configuration == "removed":
            patch.setattr(root.handlers[0], "filters", [])
        elif configuration == "direct-emitter":
            patch.setattr(logging.getLogger("httpx"), "handlers", [logging.StreamHandler(io.StringIO())])
        else:
            patch.setattr(logging.getLogger("httpx"), "propagate", False)
        with pytest.raises(NativePolicyStop) as caught:
            harness.request(url="https://first.example/private-canary?token=private-canary")
    assert caught.value.reason_code == "native_http_telemetry_unavailable"
    assert "private-canary" not in str(caught.value)
    assert harness.producer.requests == []
    assert harness.auth.claimed == set()
    assert harness.auth.outcomes == {}
    assert harness.sent == []


def test_ready_check_is_repeated_for_redirect_metadata_before_new_claim(harness, monkeypatch):
    harness.reply = lambda request: httpx.Response(302, headers={"Location": "/next"}, request=request)
    original_prepare = harness.producer.prepare

    def prepare(**kwargs):
        binding = original_prepare(**kwargs)
        assert kwargs["hop"] == 0
        monkeypatch.setattr(harness.state, "store_hook", lambda: logging.getLogger().handlers[0].filters.clear())
        return binding

    harness.producer.prepare = prepare
    with pytest.raises(NativePolicyStop) as caught:
        harness.request()
    assert caught.value.reason_code == "native_http_telemetry_unavailable"
    assert len(harness.producer.requests) == 1
    assert harness.auth.claimed == {0}
    assert len(harness.sent) == 1


def test_context_rechecks_after_claim_and_fails_closed_without_transport(harness):
    harness.auth.claim_hook = lambda: logging.getLogger().handlers[0].filters.clear()
    with pytest.raises(NativePolicyStop) as caught:
        harness.request()
    assert caught.value.reason_code == "outcome_unknown"
    assert harness.auth.claimed == {0}
    assert harness.auth.outcomes[0] == ("unknown", None)
    assert harness.sent == []


def test_actual_httpx_info_query_canary_suppressed_on_call_and_replay_but_ordinary_unchanged(harness, caplog):
    caplog.set_level(logging.INFO, logger="httpx")
    url = "https://first.example/private-canary-path?token=private-canary-query"
    assert harness.request(url=url).content == b"ok"
    harness.replay()
    assert harness.request(url=url).content == b"ok"
    assert len(harness.sent) == 1
    assert "private-canary" not in caplog.text
    harness.lower.get("https://first.example/ordinary-outside-context")
    assert "ordinary-outside-context" in caplog.text


@pytest.mark.parametrize("phase", ["send", "read", "close"])
def test_scalar_contains_raw_transport_exception_before_outer_manual_span(harness, caplog, phase):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer(__name__)
    stream = Stream("truncate" if phase == "read" else "close")

    def reply(request):
        if phase == "send":
            raise httpx.ReadTimeout("private-canary-exception", request=request)
        return httpx.Response(200, stream=stream, request=request)

    harness.reply = reply
    caplog.set_level(logging.INFO, logger="httpx")
    try:
        with pytest.raises(NativePolicyStop) as caught, tracer.start_as_current_span("existing-native-owner"):
            harness.request(url="https://first.example/private-canary-path?token=private-canary-query")
        assert caught.value.reason_code == "outcome_unknown"
        assert "private-canary" not in caplog.text
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        serialized = repr(
            [(span.attributes, [(event.name, event.attributes) for event in span.events]) for span in spans]
        )
        assert "private-canary" not in serialized
        assert len(harness.sent) == 1
        if phase != "send":
            assert stream.closes == 1
        logging.getLogger("httpx").info("ordinary-after-failure")
        assert "ordinary-after-failure" in caplog.text
    finally:
        provider.shutdown()


def test_http_owner_suppresses_real_global_httpx_instrumentation_only_during_physical_io(harness, monkeypatch):
    import httpcore

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    instrumentor = HTTPXClientInstrumentor()
    instrumentor.instrument(tracer_provider=provider)
    transport = httpx.HTTPTransport()
    assert isinstance(transport._pool, httpcore.ConnectionPool)
    count = []

    def handle_request(request):
        count.append(request)
        if request.url.target.startswith(b"/private-canary"):
            assert not is_instrumentation_enabled()
        return httpcore.Response(200, content=b"ok")

    transport._pool.handle_request = handle_request

    def before_authorization():
        assert is_instrumentation_enabled()

    harness.auth.before_hook = before_authorization
    original_prepare = harness.producer.prepare

    def prepare(**kwargs):
        assert is_instrumentation_enabled()
        return original_prepare(**kwargs)

    harness.producer.prepare = prepare
    try:
        with httpx.Client(transport=transport, trust_env=False) as client:
            monkeypatch.setattr(ssrf_proxy, "_get_ssrf_client", lambda _verify: client)
            assert harness.request(url="https://first.example/private-canary?token=private-canary").content == b"ok"
            client.get("https://first.example/ordinary-auto-span")
        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert "ordinary-auto-span" in repr(spans[0].attributes)
        assert "private-canary" not in repr([(span.attributes, span.events) for span in spans])
        assert len(count) == 2
    finally:
        instrumentor.uninstrument()
        provider.shutdown()


@pytest.mark.parametrize("delivery", ["first", "replay"])
@pytest.mark.parametrize("expires", [False, True])
def test_repeated_set_cookie_fields_follow_locked_httpx_on_first_call_and_protected_replay(harness, delivery, expires):
    expiry = "; Expires=Wed, 09 Jun 2038 10:18:14 GMT" if expires else ""
    headers = [
        ("Location", "/next"),
        ("Set-Cookie", f"a=one; Path=/{expiry}"),
        ("Set-Cookie", "b=two; Path=/"),
        ("X-Repeat", "alpha"),
        ("X-Repeat", "beta"),
    ]
    baseline = []

    def native_reply(request):
        baseline.append(request)
        return (
            httpx.Response(302, headers=headers, request=request)
            if len(baseline) == 1
            else httpx.Response(201, content=b"\x00\xff", request=request)
        )

    with httpx.Client(transport=httpx.MockTransport(native_reply), trust_env=False) as native:
        native_response = native.post("https://first.example/path", follow_redirects=True)
    assert baseline[1].headers.get("cookie") == "a=one; b=two"
    harness.reply = lambda request: (
        httpx.Response(302, headers=headers, request=request)
        if len(harness.sent) == 1
        else httpx.Response(201, content=b"\x00\xff", request=request)
    )
    response = harness.request()
    assert (response.status_code, response.content) == (native_response.status_code, native_response.content)
    public_previous = harness.producer.requests[1][2]
    assert dict(public_previous.headers) == dict(native_response.history[0].headers)
    assert public_previous.headers["x-repeat"] == "alpha, beta"
    if delivery == "first":
        assert harness.sent[1].headers.get("cookie", "") == baseline[1].headers["cookie"]
    else:
        harness.replay()
        response = harness.request()
        assert (response.status_code, response.content) == (201, b"\x00\xff")
        replay_request = harness.producer.requests[-1][0]
        assert httpx.Headers(replay_request.headers).get("cookie", "") == baseline[1].headers["cookie"]
    assert len(harness.sent) == 2
    assert harness.auth.claimed == {0, 1}
    harness.cursor.finish()


@pytest.mark.parametrize("delivery", ["first", "replay"])
def test_multiple_domain_cookies_are_cleared_for_cross_origin_redirect_and_replay(harness, delivery):
    headers = [
        ("Location", "https://other.first.example/next"),
        ("Set-Cookie", "a=one; Domain=first.example; Path=/; Expires=Wed, 09 Jun 2038 10:18:14 GMT"),
        ("Set-Cookie", "b=two; Domain=first.example; Path=/"),
    ]
    harness.reply = lambda request: (
        httpx.Response(302, headers=headers, request=request)
        if len(harness.sent) == 1
        else httpx.Response(200, content=b"ok", request=request)
    )
    assert harness.request().content == b"ok"
    assert harness.lower.cookies.get("a") == "one"
    assert harness.lower.cookies.get("b") == "two"
    if delivery == "replay":
        harness.replay()
        assert harness.request().content == b"ok"
    assert harness.sent[1].headers.get("cookie", "") == ""
    assert httpx.Headers(harness.producer.requests[-1][0].headers).get("cookie") == ""
    assert len(harness.sent) == 2
    assert harness.auth.claimed == {0, 1}
    harness.cursor.finish()


@pytest.mark.parametrize("invalid", ["missing", "bad-base64", "bad-pair", "conflicting-public-map"])
def test_invalid_recorded_raw_headers_stop_unknown_without_resending(harness, invalid):
    assert harness.request().content == b"ok"
    recorded = harness.state.values["result-0"]
    assert isinstance(recorded, dict)
    if invalid == "missing":
        recorded.pop("raw_headers_base64")
    elif invalid == "bad-base64":
        recorded["raw_headers_base64"] = [["not base64!", ""]]
    elif invalid == "bad-pair":
        recorded["raw_headers_base64"] = [["aA=="]]
    else:
        recorded["headers"] = {"set-cookie": "unattested=private-canary"}
    harness.replay()
    with pytest.raises(NativePolicyStop) as caught:
        harness.request()
    assert caught.value.reason_code == "outcome_unknown"
    assert len(harness.sent) == 1
    assert harness.auth.claimed == {0}
    assert harness.auth.outcomes[0] == ("completed", "result-0")

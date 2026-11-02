from collections import deque
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from typing import Never

import grpc  # type: ignore[import-untyped]
import httpx
import pytest
from dify_trace_arize_phoenix import arize_configuration as configuration
from dify_trace_arize_phoenix.arize_configuration import (
    DESTINATION_KEY,
    ArizeConfigurationError,
    bind_destination,
    project_url,
    resolve_project_destination,
    verify_configuration,
)
from dify_trace_arize_phoenix.arize_phoenix_trace import ArizePhoenixDataTrace
from dify_trace_arize_phoenix.config import ArizeConfig
from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, get_value
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
    ExportTraceServiceResponse,
)

from core.helper import ssrf_proxy
from core.ops.ops_trace_manager import OpsTraceManager
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import AppTracingConfigVerificationFailedError

pytest_plugins = ("tests.unit_tests.core.ops.test_ops_trace_manager",)

"""Arize metadata reads are optional, bounded and pinned to the exact destination."""


SPACE = "U3BhY2U6dGVzdA=="
ORG = "T3JnOnRlc3Q="
PROJECT = "UHJvamVjdDovKz0="
VALUES = {"endpoint": "https://otlp.arize.com", "space_id": SPACE, "project": "exact", "api_key": "synthetic-key"}
DESTINATION = {
    "endpoint": VALUES["endpoint"],
    "space_id": SPACE,
    "project": "exact",
    "organization_id": ORG,
    "project_id": PROJECT,
}
URL = "https://app.arize.com/organizations/T3JnOnRlc3Q%3D/spaces/U3BhY2U6dGVzdA%3D%3D/projects/UHJvamVjdDovKz0%3D"


def response(body: object, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("GET", "https://api.arize.com/v2/projects"))


def space() -> httpx.Response:
    return response({"id": SPACE, "organization_id": ORG})


def page(*projects: dict[str, str], more: bool = False, cursor: str | None = None) -> httpx.Response:
    return response({"projects": list(projects), "pagination": {"has_more": more, "next_cursor": cursor}})


def project(name: str = "exact", project_id: str = PROJECT) -> dict[str, str]:
    return {"id": project_id, "name": name, "space_id": SPACE}


class TestArizeConfigurationCases:
    @staticmethod
    @pytest.fixture
    def responses() -> deque[httpx.Response | Exception]:
        return deque()

    @staticmethod
    @pytest.fixture
    def calls(
        monkeypatch: pytest.MonkeyPatch, responses: deque[httpx.Response | Exception]
    ) -> list[tuple[str, dict[str, object]]]:
        calls: list[tuple[str, dict[str, object]]] = []

        def get(url: str, **options: object) -> httpx.Response:
            calls.append((url, options))
            assert responses, "Unplanned metadata request"
            item = responses.popleft()
            if isinstance(item, Exception):
                raise item
            return item

        monkeypatch.setattr(ssrf_proxy, "get", get)
        return calls

    @staticmethod
    def test_exact_scoped_project_and_opaque_ids_use_official_route(
        calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception]
    ) -> None:
        received = [space(), page(project("exact-substring"), more=True, cursor="next"), page(project())]
        responses.extend(received)
        assert resolve_project_destination(VALUES) == DESTINATION
        assert (
            project_url(
                {
                    **VALUES,
                    DESTINATION_KEY: bind_destination(VALUES, DESTINATION),
                    "project_url": "https://untrusted.test",
                }
            )
            == URL
        )
        assert len(calls) == 3
        assert calls[0][0] == "https://api.arize.com/v2/spaces/U3BhY2U6dGVzdA%3D%3D"
        assert calls[1][1]["params"] == {"space_id": SPACE, "name": "exact", "limit": 100}
        assert calls[2][1]["params"] == {"space_id": SPACE, "name": "exact", "limit": 100, "cursor": "next"}
        for url, options in calls:
            assert url.startswith("https://api.arize.com/v2/")
            assert options["headers"] == {
                "Authorization": "Bearer synthetic-key",
                "Accept": "application/json",
                "Accept-Encoding": "identity",
                "Cookie": "",
            }
            assert options["auth"] is None
            assert options["follow_redirects"] is False
            assert options["max_retries"] == 0
            assert options["stream_response"] is True
            timeout = options["timeout"]
            assert isinstance(timeout, float)
            assert 0 < timeout <= 5
        assert all(item.is_closed for item in received)

    @staticmethod
    @pytest.mark.parametrize("status", [301, 401, 403, 404, 429, 500])
    def test_unreadable_metadata_has_no_link_and_closes_response(
        calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], status: int
    ) -> None:
        denied = response({"error": "private-response"}, status)
        responses.append(denied)
        assert resolve_project_destination(VALUES) is None
        assert len(calls) == 1
        assert denied.is_closed

    @staticmethod
    @pytest.mark.parametrize(
        "body", [{"id": SPACE}, {"id": "other", "organization_id": ORG}, {"id": SPACE, "organization_id": "../bad"}]
    )
    def test_missing_or_mismatched_space_metadata_is_not_a_project(
        calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], body: dict[str, str]
    ) -> None:
        responses.append(response(body))
        assert resolve_project_destination(VALUES) is None
        assert len(calls) == 1

    @staticmethod
    @pytest.mark.parametrize(
        "body",
        [
            {"projects": [project("EXACT")], "pagination": {"has_more": False}},
            {"projects": [project(), project(project_id="other")], "pagination": {"has_more": False}},
            {"projects": [{**project(), "space_id": "other"}], "pagination": {"has_more": False}},
            {"projects": [{**project(), "id": "../bad"}], "pagination": {"has_more": False}},
            {"projects": [project()] * 101, "pagination": {"has_more": False}},
            {"projects": [project()], "pagination": {"has_more": True}},
            {"projects": [project()], "pagination": {"has_more": "false"}},
            {"projects": [project()]},
            {"data": [project()], "pagination": {"has_more": False}},
        ],
    )
    def test_incomplete_ambiguous_or_non_exact_projects_do_not_fabricate_links(
        calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], body: object
    ) -> None:
        responses.extend([space(), response(body)])
        assert resolve_project_destination(VALUES) is None
        assert len(calls) == 2

    @staticmethod
    @pytest.mark.parametrize("repeat", [False, True])
    def test_pagination_is_bounded_and_never_accepts_a_partial_match(
        calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], repeat: bool
    ) -> None:
        responses.append(space())
        responses.extend(page(project(), more=True, cursor="same" if repeat else str(index)) for index in range(3))
        assert resolve_project_destination(VALUES) is None
        assert len(calls) == (3 if repeat else 4)

    @staticmethod
    @pytest.mark.parametrize(
        "item",
        [
            httpx.ReadTimeout("synthetic-timeout"),
            httpx.Response(200, content=b"not-json"),
            httpx.Response(200, json=[]),
            httpx.Response(200, content=b" " * (1024 * 1024 + 1)),
            httpx.Response(200, json={}, headers={"content-encoding": "unsupported"}),
        ],
    )
    def test_transport_and_bounded_decode_failures_remain_optional(
        calls: list[tuple[str, dict[str, object]]],
        responses: deque[httpx.Response | Exception],
        item: httpx.Response | Exception,
    ) -> None:
        responses.append(item)
        assert resolve_project_destination(VALUES) is None
        assert len(calls) == 1
        if isinstance(item, httpx.Response):
            assert item.is_closed

    @staticmethod
    def test_all_pages_share_one_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
        clock = [100.0]
        calls: list[float] = []
        received = [space(), page(project(), more=True, cursor="next")]

        def get(_url: str, **options: object) -> httpx.Response:
            timeout = options["timeout"]
            assert isinstance(timeout, float)
            calls.append(timeout)
            clock[0] += 2.5
            return received[len(calls) - 1]

        monkeypatch.setattr(configuration.time, "monotonic", lambda: clock[0])
        monkeypatch.setattr(ssrf_proxy, "get", get)
        assert resolve_project_destination(VALUES) is None
        assert calls == [5.0, 2.5]
        assert all(item.is_closed for item in received)

    @staticmethod
    def test_slow_response_chunks_stop_at_the_shared_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
        clock = [100.0]
        chunks: list[int] = []
        received = httpx.Response(200)

        def stream() -> Iterator[bytes]:
            for index in range(10):
                clock[0] += 2.0
                chunks.append(index)
                yield b" "

        monkeypatch.setattr(configuration.time, "monotonic", lambda: clock[0])
        monkeypatch.setattr(received, "iter_bytes", stream)
        monkeypatch.setattr(ssrf_proxy, "get", lambda _url, **_options: received)
        assert resolve_project_destination(VALUES) is None
        assert chunks == [0, 1, 2]
        assert received.is_closed

    @staticmethod
    @pytest.mark.parametrize(
        "change",
        [
            {"endpoint": "https://custom.test"},
            {"endpoint": "https://otlp.eu-west-1a.arize.com"},
            {"endpoint": "http://otlp.arize.com"},
            {"endpoint": "https://user:secret@otlp.arize.com"},
            {"endpoint": "https://otlp.arize.com:444"},
            {"space_id": "../bad"},
            {"api_key": None},
            {"api_key": ""},
            {"api_key": "******"},
            {"api_key": "key\nheader"},
        ],
    )
    def test_unsupported_destination_or_credentials_do_not_send_to_an_assumed_host(
        calls: list[tuple[str, dict[str, object]]], change: dict[str, str | None]
    ) -> None:
        assert resolve_project_destination({**VALUES, **change}) is None
        assert calls == []

    @staticmethod
    @pytest.mark.parametrize(
        "change",
        [
            {"endpoint": "https://otlp.arize.com:443"},
            {"space_id": "other"},
            {"project": "later"},
            {DESTINATION_KEY: {**DESTINATION, "organization_id": "bad?query"}},
            {DESTINATION_KEY: {**DESTINATION, "project_id": "../bad"}},
            {DESTINATION_KEY: None},
        ],
    )
    def test_get_formatter_rejects_stale_or_forged_metadata_without_io(
        monkeypatch: pytest.MonkeyPatch, change: dict[str, object]
    ) -> None:
        def forbidden(*_args: object, **_kwargs: object) -> Never:
            raise AssertionError("GET must not call the vendor")

        monkeypatch.setattr(ssrf_proxy, "get", forbidden)
        assert project_url({**VALUES, DESTINATION_KEY: bind_destination(VALUES, DESTINATION), **change}) is None


"""A real gRPC collector must acknowledge Arize credentials before config persistence."""


class TestArizeConfigurationAckCases:
    @staticmethod
    @pytest.fixture
    def collector() -> Iterator[tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]]]:
        calls: list[tuple[bytes, dict[str, str]]] = []
        state: dict[str, object] = {"status": grpc.StatusCode.OK}
        release = Event()
        state["release"] = release

        def export(request: ExportTraceServiceRequest, context: grpc.ServicerContext) -> ExportTraceServiceResponse:
            headers = {
                key: value.decode() if isinstance(value, bytes) else value
                for key, value in context.invocation_metadata()
            }
            calls.append((request.SerializeToString(), headers))
            if headers.get("api_key") != "synthetic-good" or headers.get("space_id") != "synthetic-space":
                context.abort(grpc.StatusCode.PERMISSION_DENIED, "private-vendor-details")
            code = state["status"]
            if isinstance(code, grpc.StatusCode) and code is not grpc.StatusCode.OK:
                context.abort(code, "private-vendor-details")
            if state.get("delay"):
                release.wait(2)
            result = ExportTraceServiceResponse()
            if state.get("partial"):
                result.partial_success.rejected_spans = 1
            if state.get("message"):
                result.partial_success.error_message = "private-vendor-details"
            return result

        def dispatch(*args: object, **kwargs: object) -> ExportTraceServiceResponse:
            assert kwargs == {}
            request, context = args
            assert isinstance(request, ExportTraceServiceRequest)
            assert isinstance(context, grpc.ServicerContext)
            return export(request, context)

        handler = grpc.unary_unary_rpc_method_handler(
            dispatch,
            request_deserializer=ExportTraceServiceRequest.FromString,
            response_serializer=ExportTraceServiceResponse.SerializeToString,
        )
        with ThreadPoolExecutor(max_workers=2) as pool:
            server = grpc.server(pool)
            server.add_generic_rpc_handlers(
                (
                    grpc.method_handlers_generic_handler(
                        "opentelemetry.proto.collector.trace.v1.TraceService", {"Export": handler}
                    ),
                )
            )
            port = server.add_insecure_port("127.0.0.1:0")
            assert port > 0
            server.start()
            try:
                yield f"http://127.0.0.1:{port}", calls, state
            finally:
                release.set()
                server.stop(0).wait(2)

    @staticmethod
    def test_rejected_real_collector_ack_cannot_be_saved(
        workspace: str,
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
    ) -> None:
        endpoint, calls, _ = collector
        with pytest.raises(AppTracingConfigVerificationFailedError):
            OpsTraceManagerGateway().prepare_new_config(
                workspace_id=workspace,
                tracing_provider="arize",
                tracing_config={
                    "endpoint": endpoint,
                    "project": "synthetic-project",
                    "space_id": "synthetic-space",
                    "api_key": "synthetic-invalid",
                },
            )
        assert len(calls) == 1

    @staticmethod
    def test_synchronous_ack_is_resource_only_and_has_no_sdk_or_environment_side_effects(
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        endpoint, calls, _ = collector
        attempted: list[bool] = []

        def forbidden(*_args: object, **_kwargs: object) -> Never:
            attempted.append(True)
            raise AssertionError("Arize verification must not construct the SDK tracer")

        monkeypatch.setattr(ArizePhoenixDataTrace, "__init__", forbidden)
        monkeypatch.setenv("OTEL_EXPORTER_OTLP_HEADERS", "api_key=ambient-invalid,space_id=ambient-other")
        verify_configuration(
            ArizeConfig(
                endpoint=endpoint, api_key="synthetic-good", space_id="synthetic-space", project="synthetic-project"
            )
        )
        assert attempted == []
        assert len(calls) == 1
        payload = ExportTraceServiceRequest.FromString(calls[0][0])
        assert len(payload.resource_spans) == 1
        assert {a.key: a.value.string_value for a in payload.resource_spans[0].resource.attributes} == {
            "model_id": "synthetic-project",
            "openinference.project.name": "synthetic-project",
        }
        assert len(payload.resource_spans[0].scope_spans) == 0
        assert calls[0][1]["api_key"] == "synthetic-good"
        assert calls[0][1]["space_id"] == "synthetic-space"
        assert calls[0][1]["authorization"] == "Bearer synthetic-good"
        assert "ambient" not in str(calls)

    @staticmethod
    @pytest.mark.parametrize(
        ("code", "expected"),
        [
            (grpc.StatusCode.UNAUTHENTICATED, "authentication_failed"),
            (grpc.StatusCode.PERMISSION_DENIED, "permission_denied"),
            (grpc.StatusCode.UNAVAILABLE, "connection_failed"),
            (grpc.StatusCode.RESOURCE_EXHAUSTED, "connection_failed"),
        ],
    )
    def test_real_rpc_rejection_uses_only_safe_fixed_diagnostics(
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        code: grpc.StatusCode,
        expected: str,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        endpoint, calls, state = collector
        state["status"] = code
        with pytest.raises(ArizeConfigurationError) as caught:
            verify_configuration(ArizeConfig(endpoint=endpoint, api_key="synthetic-good", space_id="synthetic-space"))
        assert caught.value.code == expected
        assert caught.value.__suppress_context__
        assert "synthetic-good" not in str(caught.value)
        assert "private-vendor-details" not in str(caught.value)
        assert "private-vendor-details" not in caplog.text
        assert len(calls) == 1

    @staticmethod
    @pytest.mark.parametrize("partial", ["partial", "message"])
    def test_partial_or_error_ack_is_not_success(
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        partial: str,
    ) -> None:
        endpoint, calls, state = collector
        state[partial] = True
        with pytest.raises(ArizeConfigurationError, match="unexpected_response"):
            verify_configuration(ArizeConfig(endpoint=endpoint, api_key="synthetic-good", space_id="synthetic-space"))
        assert len(calls) == 1

    @staticmethod
    def test_deadline_is_finite_and_does_not_retry(
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        endpoint, calls, state = collector
        state["delay"] = True
        monkeypatch.setattr(configuration, "_VERIFY_TIMEOUT_SECONDS", 0.05)
        with pytest.raises(ArizeConfigurationError, match="connection_failed"):
            verify_configuration(ArizeConfig(endpoint=endpoint, api_key="synthetic-good", space_id="synthetic-space"))
        assert len(calls) == 1

    @staticmethod
    @pytest.mark.parametrize("reject", [False, True])
    def test_tls_channel_is_explicit_suppressed_and_closed_on_all_outcomes(
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        monkeypatch: pytest.MonkeyPatch,
        reject: bool,
    ) -> None:
        endpoint, _, state = collector
        if reject:
            state["status"] = grpc.StatusCode.PERMISSION_DENIED
        original = grpc.insecure_channel
        options_seen: list[tuple[str, object, object]] = []
        closed: list[bool] = []

        def secure(target: str, credentials: grpc.ChannelCredentials, options: object) -> grpc.Channel:
            assert isinstance(credentials, grpc.ChannelCredentials)
            options_seen.append((target, options, get_value(_SUPPRESS_INSTRUMENTATION_KEY)))
            channel = original(endpoint.removeprefix("http://"))
            close = channel.close

            def close_recording() -> None:
                closed.append(True)
                close()

            monkeypatch.setattr(channel, "close", close_recording)
            return channel

        monkeypatch.setattr(grpc, "secure_channel", secure)
        before = get_value(_SUPPRESS_INSTRUMENTATION_KEY)
        config = ArizeConfig(api_key="synthetic-good", space_id="synthetic-space")
        if reject:
            with pytest.raises(ArizeConfigurationError):
                verify_configuration(config)
        else:
            verify_configuration(config)
        assert options_seen == [
            ("otlp.arize.com:443", (("grpc.enable_retries", 0), ("grpc.max_receive_message_length", 1024 * 1024)), True)
        ]
        assert closed == [True]
        assert get_value(_SUPPRESS_INSTRUMENTATION_KEY) == before

    @staticmethod
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            ("api_key", None),
            ("api_key", ""),
            ("api_key", "******"),
            ("api_key", "key\nheader"),
            ("space_id", None),
            ("space_id", " "),
            ("space_id", "******"),
            ("endpoint", "https://user:secret@otlp.arize.com"),
            ("endpoint", "https://otlp.arize.com:0"),
        ],
    )
    def test_invalid_auth_values_never_construct_a_channel(
        monkeypatch: pytest.MonkeyPatch,
        field: str,
        value: str | None,
    ) -> None:
        attempted: list[bool] = []

        def forbidden(*_args: object, **_kwargs: object) -> Never:
            attempted.append(True)
            raise AssertionError("Invalid configuration must be rejected before transport construction")

        monkeypatch.setattr(grpc, "secure_channel", forbidden)
        monkeypatch.setattr(grpc, "insecure_channel", forbidden)
        config = ArizeConfig.model_validate({"api_key": "synthetic-good", "space_id": "synthetic-space", field: value})
        with pytest.raises(ArizeConfigurationError, match="invalid_configuration"):
            verify_configuration(config)
        assert attempted == []

    @staticmethod
    @pytest.mark.parametrize("accepted", [False, True])
    def test_legacy_api_check_also_requires_the_real_ack(
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        accepted: bool,
    ) -> None:
        endpoint, calls, _ = collector
        instance = ArizePhoenixDataTrace(
            ArizeConfig(
                endpoint=endpoint,
                api_key="synthetic-good" if accepted else "synthetic-invalid",
                space_id="synthetic-space",
            )
        )
        try:
            if accepted:
                assert instance.api_check()
            else:
                with pytest.raises(ArizeConfigurationError, match="permission_denied"):
                    instance.api_check()
        finally:
            instance.processor.shutdown()
        assert len(calls) == 1
        assert len(ExportTraceServiceRequest.FromString(calls[0][0]).resource_spans[0].scope_spans) == 0

    @staticmethod
    def test_real_ingest_ack_without_rest_read_permission_can_still_save(
        workspace: str,
        collector: tuple[str, list[tuple[bytes, dict[str, str]]], dict[str, object]],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        endpoint, rpc_calls, _ = collector
        original = grpc.insecure_channel
        reads: list[str] = []

        def secure(_target: str, _credentials: grpc.ChannelCredentials, **_options: object) -> grpc.Channel:
            return original(endpoint.removeprefix("http://"))

        def get(url: str, **_options: object) -> httpx.Response:
            reads.append(url)
            return httpx.Response(403, json={"message": "private-vendor-details"})

        monkeypatch.setattr(grpc, "secure_channel", secure)
        monkeypatch.setattr(ssrf_proxy, "get", get)
        saved = OpsTraceManagerGateway().prepare_new_config(
            workspace_id=workspace,
            tracing_provider="arize",
            tracing_config={"api_key": "synthetic-good", "space_id": "synthetic-space", "project": "not-created"},
        )
        assert len(rpc_calls) == len(reads) == 1
        assert reads[0] == "https://api.arize.com/v2/spaces/synthetic-space"
        assert "project_url" not in saved
        assert "arize_project_destination" not in saved
        assert OpsTraceManager.decrypt_tracing_config(workspace, "arize", saved)["api_key"] == "synthetic-good"
        payload = ExportTraceServiceRequest.FromString(rpc_calls[0][0])
        assert len(payload.resource_spans[0].scope_spans) == 0

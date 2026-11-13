from collections.abc import Callable, Iterator
from functools import partial
from typing import cast, override

import httpx
import pytest
from dify_agent.client import (
    Client,
    DifyAgentClientError,
    DifyAgentHTTPError,
    DifyAgentStreamError,
    DifyAgentTimeoutError,
    DifyAgentValidationError,
)
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import (
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
    RunCancelledEvent,
    RunCancelledEventData,
    RunEvent,
    RunStartedEvent,
    RunStatusResponse,
)

from clients.agent_backend import (
    AgentBackendHTTPError,
    AgentBackendModelConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendStreamError,
    AgentBackendTransportError,
    AgentBackendValidationError,
    AgentBackendWorkflowNodeRunInput,
    DifyAgentBackendRunClient,
)
from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter

_STREAM_TIMEOUT_UNSET = object()


def _request() -> CreateRunRequest:
    return AgentBackendRunRequestBuilder().build_for_workflow_node(
        AgentBackendWorkflowNodeRunInput(
            model=AgentBackendModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            execution_context=DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_from="account",
                agent_mode="workflow_run",
                invoke_from="debugger",
            ),
            backend_binding_ref="binding-ref-1",
            workflow_node_job_prompt="Do the task.",
            user_prompt="hello",
        )
    )


class _SuccessfulClient:
    stream_options: tuple[int | None, object, Callable[[], bool] | None] | None = None
    cancel_after: str | None = None

    def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
        assert isinstance(request, CreateRunRequest)
        return CreateRunResponse(run_id="run-1", status="running")

    def cancel_run_sync(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        del request
        return CancelRunResponse(run_id=run_id, status="cancelled")

    def cancel_run_and_wait_sync(
        self,
        run_id: str,
        request: CancelRunRequest | None = None,
        *,
        after: str | None = None,
    ) -> RunCancelledEvent:
        self.cancel_after = after
        request = request or CancelRunRequest()
        return RunCancelledEvent(
            id="2-0",
            run_id=run_id,
            data=RunCancelledEventData(reason=request.reason, message=request.message),
        )

    def stream_events_sync(
        self,
        run_id: str,
        *,
        after: str | None = None,
        max_reconnects: int | None = None,
        timeout_seconds: float | None = cast(float | None, _STREAM_TIMEOUT_UNSET),
        should_stop: Callable[[], bool] | None = None,
    ) -> Iterator[RunEvent]:
        del after
        self.stream_options = (max_reconnects, timeout_seconds, should_stop)
        yield RunStartedEvent(id="1-0", run_id=run_id)

    def wait_run_sync(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        del timeout_seconds
        return RunStatusResponse.model_validate(
            {
                "run_id": run_id,
                "status": "succeeded",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            }
        )


def test_dify_agent_backend_run_client_delegates_sync_methods() -> None:
    wrapped = _SuccessfulClient()
    client = DifyAgentBackendRunClient(wrapped, stream_max_reconnects=2)

    def should_stop() -> bool:
        return False

    created = client.create_run(_request())
    cancelled = client.cancel_run(created.run_id)
    cancelled_event = client.cancel_run_and_wait(
        created.run_id,
        CancelRunRequest(reason="stopped"),
        after="1-0",
    )
    events = list(client.stream_events(created.run_id, should_stop=should_stop))
    status = client.wait_run(created.run_id)

    assert created.run_id == "run-1"
    assert cancelled.status == "cancelled"
    assert cancelled_event.data.reason == "stopped"
    assert events[0].type == "run_started"
    assert status.status == "succeeded"
    assert wrapped.cancel_after == "1-0"
    assert wrapped.stream_options == (2, _STREAM_TIMEOUT_UNSET, should_stop)


def test_dify_agent_backend_run_client_maps_validation_error() -> None:
    class InvalidClient(_SuccessfulClient):
        @override
        def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
            raise DifyAgentValidationError(detail={"field": "bad"})

    with pytest.raises(AgentBackendValidationError) as exc_info:
        DifyAgentBackendRunClient(InvalidClient()).create_run(_request())

    assert exc_info.value.detail == {"field": "bad"}


def test_dify_agent_backend_run_client_maps_http_error() -> None:
    class HTTPErrorClient(_SuccessfulClient):
        @override
        def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
            raise DifyAgentHTTPError(status_code=503, detail="unavailable")

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        DifyAgentBackendRunClient(HTTPErrorClient()).create_run(_request())

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "unavailable"
    assert exc_info.value.error_code == "agent_backend_error"
    assert str(exc_info.value) == "Agent backend HTTP 503: unavailable"


def test_dify_agent_backend_run_client_maps_timeout_error() -> None:
    class TimeoutClient(_SuccessfulClient):
        @override
        def wait_run_sync(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
            raise DifyAgentTimeoutError("timeout")

    with pytest.raises(AgentBackendTransportError) as exc_info:
        DifyAgentBackendRunClient(TimeoutClient()).wait_run("run-1")

    assert str(exc_info.value) == "timeout"
    assert exc_info.value.run_id == "run-1"


def test_dify_agent_backend_run_client_maps_stream_error() -> None:
    class StreamClient(_SuccessfulClient):
        @override
        def stream_events_sync(
            self,
            run_id: str,
            *,
            after: str | None = None,
            max_reconnects: int | None = None,
            timeout_seconds: float | None = None,
            should_stop: Callable[[], bool] | None = None,
        ) -> Iterator[RunEvent]:
            del run_id, after, max_reconnects, timeout_seconds, should_stop
            raise DifyAgentStreamError("bad stream")
            yield

    with pytest.raises(AgentBackendStreamError) as exc_info:
        list(DifyAgentBackendRunClient(StreamClient()).stream_events("run-1"))

    assert str(exc_info.value) == "bad stream"
    assert exc_info.value.run_id == "run-1"


@pytest.mark.parametrize("operation", ["cancel", "cancel_and_wait", "stream", "wait"])
def test_run_operations_preserve_backend_error_and_run_id(operation: str) -> None:
    original = DifyAgentHTTPError(status_code=503, detail={"code": "backend_overloaded", "message": "queue full"})

    class FailingClient(_SuccessfulClient):
        @override
        def cancel_run_sync(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
            raise original

        @override
        def cancel_run_and_wait_sync(
            self, run_id: str, request: CancelRunRequest | None = None, *, after: str | None = None
        ) -> RunCancelledEvent:
            raise original

        @override
        def stream_events_sync(
            self,
            run_id: str,
            *,
            after: str | None = None,
            max_reconnects: int | None = None,
            timeout_seconds: float | None = None,
            should_stop: Callable[[], bool] | None = None,
        ) -> Iterator[RunEvent]:
            raise original

        @override
        def wait_run_sync(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
            raise original

    client = DifyAgentBackendRunClient(FailingClient())

    def invoke() -> None:
        match operation:
            case "cancel":
                client.cancel_run("run-1")
            case "cancel_and_wait":
                client.cancel_run_and_wait("run-1")
            case "stream":
                list(client.stream_events("run-1"))
            case "wait":
                client.wait_run("run-1")

    with pytest.raises(AgentBackendHTTPError) as raised:
        invoke()

    assert raised.value.run_id == "run-1"
    assert raised.value.status_code == 503
    assert raised.value.error_code == "backend_overloaded"
    assert str(raised.value) == "Agent backend HTTP 503: queue full"
    assert raised.value.__cause__ is original


@pytest.mark.parametrize(
    ("original", "normalized_type"),
    [
        (DifyAgentValidationError(detail=[{"field": "invalid"}], status_code=200), AgentBackendValidationError),
        (DifyAgentClientError("connection refused"), AgentBackendTransportError),
        (RuntimeError("socket failed"), AgentBackendTransportError),
    ],
)
def test_stream_protocol_failures_keep_run_id(original: Exception, normalized_type: type[Exception]) -> None:
    class FailingClient(_SuccessfulClient):
        @override
        def stream_events_sync(
            self,
            run_id: str,
            *,
            after: str | None = None,
            max_reconnects: int | None = None,
            timeout_seconds: float | None = None,
            should_stop: Callable[[], bool] | None = None,
        ) -> Iterator[RunEvent]:
            raise original

    with pytest.raises(normalized_type) as raised:
        list(DifyAgentBackendRunClient(FailingClient()).stream_events("run-1"))
    assert isinstance(raised.value, AgentBackendValidationError | AgentBackendTransportError)
    assert raised.value.run_id == "run-1"
    assert raised.value.__cause__ is original


@pytest.mark.parametrize("reconnect", [False, True])
def test_real_sdk_sse_http_failure_retains_status_code_detail_run_and_http_cause(
    monkeypatch: pytest.MonkeyPatch, reconnect: bool
) -> None:
    requests: list[httpx.Request] = []

    def overloaded(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(503, json={"detail": {"code": "backend_overloaded", "message": "try later"}})

    with (
        httpx.Client(transport=httpx.MockTransport(overloaded)) as http_client,
        Client(base_url="http://agent.test", sync_http_client=http_client) as sdk,
    ):
        monkeypatch.setattr(
            sdk,
            "stream_events_sync",
            partial(sdk.stream_events_sync, reconnect=reconnect, reconnect_delay_seconds=0),
        )
        adapter = DifyAgentBackendRunClient(sdk, stream_max_reconnects=1)
        with pytest.raises(AgentBackendHTTPError) as raised:
            list(adapter.stream_events("run-1"))

    error = raised.value
    assert len(requests) == (2 if reconnect else 1)
    assert all(request.url.path == "/runs/run-1/events/sse" for request in requests)
    assert error.status_code == 503
    assert error.error_code == "backend_overloaded"
    assert str(error) == "Agent backend HTTP 503: try later"
    assert error.run_id == "run-1"
    assert isinstance(error.__cause__, DifyAgentHTTPError)
    assert error.__cause__.detail == {"code": "backend_overloaded", "message": "try later"}
    assert AppGenerateResponseConverter._error_to_stream_response(error) == {
        "status": 503,
        "code": "backend_overloaded",
        "message": "Agent backend HTTP 503: try later",
    }


@pytest.mark.parametrize("status", [200, 422])
def test_real_sdk_distinguishes_http_rejection_from_successful_response_validation(status: int) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"detail": {"code": "invalid_run_request", "message": "invalid binding"}})

    with (
        httpx.Client(transport=httpx.MockTransport(respond)) as http_client,
        Client(base_url="http://agent.test", sync_http_client=http_client) as sdk,
    ):
        with pytest.raises(AgentBackendValidationError) as raised:
            DifyAgentBackendRunClient(sdk).cancel_run("run-1")

    error = raised.value
    assert error.run_id == "run-1"
    assert isinstance(error.__cause__, DifyAgentValidationError)
    response = AppGenerateResponseConverter._error_to_stream_response(error)
    if status == 422:
        assert error.status_code == 422
        assert error.error_code == "invalid_run_request"
        assert error.detail == {"code": "invalid_run_request", "message": "invalid binding"}
        assert response == {
            "status": 422,
            "code": "invalid_run_request",
            "message": "Agent backend HTTP 422: invalid binding",
        }
    else:
        assert error.status_code is None
        assert error.error_code is None
        assert response["status"] == 502
        assert response["code"] == "agent_backend_error"


def test_real_sdk_local_option_validation_keeps_protocol_error_without_http_status() -> None:
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(503)

    with (
        httpx.Client(transport=httpx.MockTransport(respond)) as http_client,
        Client(base_url="http://agent.test", sync_http_client=http_client) as sdk,
    ):
        with pytest.raises(AgentBackendValidationError) as raised:
            list(DifyAgentBackendRunClient(sdk, stream_max_reconnects=-1).stream_events("run-1"))

    assert not requests
    assert raised.value.detail == "max_reconnects must be non-negative"
    assert raised.value.status_code is None
    assert AppGenerateResponseConverter._error_to_stream_response(raised.value)["status"] == 502


def test_http_error_without_backend_message_does_not_echo_a_dictionary_repr() -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": {"code": "backend_overloaded"}})

    with (
        httpx.Client(transport=httpx.MockTransport(respond)) as http_client,
        Client(base_url="http://agent.test", sync_http_client=http_client) as sdk,
    ):
        with pytest.raises(AgentBackendHTTPError) as raised:
            DifyAgentBackendRunClient(sdk).cancel_run("run-1")
    assert str(raised.value) == "Agent backend HTTP 503"
    assert raised.value.error_code == "backend_overloaded"


def test_stream_reconnect_exhaustion_without_http_rejection_keeps_transport_classification() -> None:
    """An explicit cause is also the implicit context; searching both links must terminate."""

    class DisconnectedClient(_SuccessfulClient):
        @override
        def stream_events_sync(
            self,
            run_id: str,
            *,
            after: str | None = None,
            max_reconnects: int | None = None,
            timeout_seconds: float | None = None,
            should_stop: Callable[[], bool] | None = None,
        ) -> Iterator[RunEvent]:
            try:
                raise DifyAgentClientError("connection reset")
            except DifyAgentClientError as error:
                raise DifyAgentStreamError("reconnect attempts exhausted") from error

    with pytest.raises(AgentBackendStreamError) as caught:
        list(DifyAgentBackendRunClient(DisconnectedClient()).stream_events("run-1"))

    assert str(caught.value) == "reconnect attempts exhausted"
    assert caught.value.run_id == "run-1"
    sdk_error = caught.value.__cause__
    assert isinstance(sdk_error, DifyAgentStreamError)
    assert isinstance(sdk_error.__cause__, DifyAgentClientError)
    assert sdk_error.__cause__ is sdk_error.__context__

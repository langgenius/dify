import subprocess
import sys
from collections.abc import Callable, Iterator
from pathlib import Path
from textwrap import dedent
from typing import override

import pytest
from dify_agent.client import DifyAgentHTTPError, DifyAgentStreamError, DifyAgentTimeoutError, DifyAgentValidationError
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
    AgentBackendTimeoutError,
    AgentBackendValidationError,
    AgentBackendWorkflowNodeRunInput,
    DifyAgentBackendRunClient,
)


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
    stream_options: tuple[int | None, float | None, Callable[[], bool] | None] | None = None
    cancel_after: str | None = None
    cancel_timeout_seconds: float | None = None
    create_timeout_seconds: float | None = None

    def create_run_sync(self, request: CreateRunRequest, *, timeout_seconds: float | None = None) -> CreateRunResponse:
        assert isinstance(request, CreateRunRequest)
        self.create_timeout_seconds = timeout_seconds
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
        timeout_seconds: float | None = None,
    ) -> RunCancelledEvent:
        self.cancel_after = after
        self.cancel_timeout_seconds = timeout_seconds
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
        timeout_seconds: float | None = None,
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

    created = client.create_run(_request(), timeout_seconds=9.0)
    cancelled = client.cancel_run(created.run_id)
    cancelled_event = client.cancel_run_and_wait(
        created.run_id,
        CancelRunRequest(reason="stopped"),
        after="1-0",
        timeout_seconds=2.5,
    )
    events = list(client.stream_events(created.run_id, timeout_seconds=7.5, should_stop=should_stop))
    status = client.wait_run(created.run_id)

    assert created.run_id == "run-1"
    assert cancelled.status == "cancelled"
    assert cancelled_event.data.reason == "stopped"
    assert events[0].type == "run_started"
    assert status.status == "succeeded"
    assert wrapped.cancel_after == "1-0"
    assert wrapped.create_timeout_seconds == 9.0
    assert wrapped.cancel_timeout_seconds == 2.5
    assert wrapped.stream_options == (2, 7.5, should_stop)


def test_dify_agent_backend_run_client_maps_validation_error() -> None:
    class InvalidClient(_SuccessfulClient):
        @override
        def create_run_sync(
            self, request: CreateRunRequest, *, timeout_seconds: float | None = None
        ) -> CreateRunResponse:
            raise DifyAgentValidationError(detail={"field": "bad"})

    with pytest.raises(AgentBackendValidationError) as exc_info:
        DifyAgentBackendRunClient(InvalidClient()).create_run(_request())

    assert exc_info.value.detail == {"field": "bad"}


def test_dify_agent_backend_run_client_maps_http_error() -> None:
    class HTTPErrorClient(_SuccessfulClient):
        @override
        def create_run_sync(
            self, request: CreateRunRequest, *, timeout_seconds: float | None = None
        ) -> CreateRunResponse:
            raise DifyAgentHTTPError(status_code=503, detail="unavailable")

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        DifyAgentBackendRunClient(HTTPErrorClient()).create_run(_request())

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "unavailable"


def test_dify_agent_backend_run_client_maps_timeout_error() -> None:
    class TimeoutClient(_SuccessfulClient):
        @override
        def wait_run_sync(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
            raise DifyAgentTimeoutError("timeout")

    with pytest.raises(AgentBackendTimeoutError) as exc_info:
        DifyAgentBackendRunClient(TimeoutClient()).wait_run("run-1")

    assert str(exc_info.value) == "timeout"


@pytest.mark.parametrize("scenario", ["numeric", "hostname", "hostname-resolved"])
def test_gevent_cancel_deadline_with_saturated_resolver(scenario: str) -> None:
    """Exercise the real gevent resolver and TCP socket without patching the pytest process."""
    script = dedent(
        """
        import sys

        import gevent
        from gevent import monkey

        gevent.config.resolver = "thread"
        monkey.patch_all()

        import socket
        import time

        import httpx
        from dify_agent.client import Client
        from gevent import socket as gevent_socket

        from clients.agent_backend import AgentBackendTimeoutError, DifyAgentBackendRunClient

        scenario = sys.argv[1]
        budget = 0.2
        pool = gevent.get_hub().threadpool
        pool.maxsize = 1
        gate = monkey.get_original("_thread", "allocate_lock")()
        gate.acquire()
        blockers = []
        lookups = []
        connections = []
        getaddrinfo = socket.getaddrinfo
        connect = socket.socket.connect

        def hold_resolver_thread():
            with gate:
                pass

        def occupy_pool():
            blockers.append(pool.spawn(hold_resolver_thread))

        def resolve(host, *args, **kwargs):
            lookups.append(host)
            addresses = getaddrinfo(host, *args, **kwargs)
            if scenario == "hostname-resolved":
                occupy_pool()
            return addresses

        def connect_then_stall(sock, address):
            # Run gevent's real address handling before simulating a stalled connect.
            connect(sock, address)
            connections.append(address)
            timeout = sock.gettimeout()
            assert 0 < timeout <= budget, timeout
            gevent.sleep(timeout)
            raise TimeoutError("connect timed out")

        try:
            with socket.socket() as listener, httpx.Client(trust_env=False) as http_client:
                listener.bind(("127.0.0.1", 0))
                listener.listen()
                port = listener.getsockname()[1]
                host = "127.0.0.1" if scenario == "numeric" else "localhost"
                socket.getaddrinfo = gevent_socket.getaddrinfo = resolve
                socket.socket.connect = connect_then_stall
                if scenario != "hostname-resolved":
                    occupy_pool()
                sdk = Client(base_url=f"http://{host}:{port}", sync_http_client=http_client)
                client = DifyAgentBackendRunClient(sdk)

                started_at = time.monotonic()
                with gevent.Timeout(2.0):
                    try:
                        client.cancel_run_and_wait("run-1", timeout_seconds=budget)
                    except AgentBackendTimeoutError:
                        pass
                    else:
                        raise AssertionError("Expected the SDK deadline to expire")

                assert time.monotonic() - started_at < 1.0
                assert len(blockers) == 1 and not blockers[0].ready()
                assert lookups == ([] if scenario == "numeric" else ["localhost"]), lookups
                assert connections == ([] if scenario == "hostname" else [("127.0.0.1", port)]), connections
        finally:
            gate.release()
            for blocker in blockers:
                blocker.get(timeout=2.0)
        """
    )
    subprocess.run(
        [sys.executable, "-c", script, scenario],
        cwd=Path(__file__).resolve().parents[4],
        check=True,
        timeout=10,
    )


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

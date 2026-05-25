from collections.abc import Iterator

import pytest
from dify_agent.client import DifyAgentHTTPError, DifyAgentStreamError, DifyAgentTimeoutError, DifyAgentValidationError
from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig
from dify_agent.protocol import (
    CancelRunRequest,
    CancelRunResponse,
    CreateRunRequest,
    CreateRunResponse,
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


def _request():
    return AgentBackendRunRequestBuilder().build_for_workflow_node(
        AgentBackendWorkflowNodeRunInput(
            model=AgentBackendModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            execution_context=DifyExecutionContextLayerConfig(tenant_id="tenant-1", invoke_from="workflow_run"),
            workflow_node_job_prompt="Do the task.",
            user_prompt="hello",
        )
    )


class _SuccessfulClient:
    def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
        assert isinstance(request, CreateRunRequest)
        return CreateRunResponse(run_id="run-1", status="running")

    def cancel_run_sync(self, run_id: str, request: CancelRunRequest | None = None) -> CancelRunResponse:
        del request
        return CancelRunResponse(run_id=run_id, status="cancelled")

    def stream_events_sync(self, run_id: str, *, after: str | None = None) -> Iterator[RunEvent]:
        del after
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


def test_dify_agent_backend_run_client_delegates_sync_methods():
    client = DifyAgentBackendRunClient(_SuccessfulClient())

    created = client.create_run(_request())
    cancelled = client.cancel_run(created.run_id)
    events = list(client.stream_events(created.run_id))
    status = client.wait_run(created.run_id)

    assert created.run_id == "run-1"
    assert cancelled.status == "cancelled"
    assert events[0].type == "run_started"
    assert status.status == "succeeded"


def test_dify_agent_backend_run_client_maps_validation_error():
    class InvalidClient(_SuccessfulClient):
        def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
            raise DifyAgentValidationError(detail={"field": "bad"})

    with pytest.raises(AgentBackendValidationError) as exc_info:
        DifyAgentBackendRunClient(InvalidClient()).create_run(_request())

    assert exc_info.value.detail == {"field": "bad"}


def test_dify_agent_backend_run_client_maps_http_error():
    class HTTPErrorClient(_SuccessfulClient):
        def create_run_sync(self, request: CreateRunRequest) -> CreateRunResponse:
            raise DifyAgentHTTPError(status_code=503, detail="unavailable")

    with pytest.raises(AgentBackendHTTPError) as exc_info:
        DifyAgentBackendRunClient(HTTPErrorClient()).create_run(_request())

    assert exc_info.value.status_code == 503
    assert exc_info.value.detail == "unavailable"


def test_dify_agent_backend_run_client_maps_timeout_error():
    class TimeoutClient(_SuccessfulClient):
        def wait_run_sync(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
            raise DifyAgentTimeoutError("timeout")

    with pytest.raises(AgentBackendTransportError) as exc_info:
        DifyAgentBackendRunClient(TimeoutClient()).wait_run("run-1")

    assert str(exc_info.value) == "timeout"


def test_dify_agent_backend_run_client_maps_stream_error():
    class StreamClient(_SuccessfulClient):
        def stream_events_sync(self, run_id: str, *, after: str | None = None) -> Iterator[RunEvent]:
            raise DifyAgentStreamError("bad stream")
            yield

    with pytest.raises(AgentBackendStreamError) as exc_info:
        list(DifyAgentBackendRunClient(StreamClient()).stream_events("run-1"))

    assert str(exc_info.value) == "bad stream"

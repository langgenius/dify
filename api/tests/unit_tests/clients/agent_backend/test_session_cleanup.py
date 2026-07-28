from datetime import UTC, datetime

from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers.base import LifecycleState
from dify_agent.protocol import RunStatusResponse

from clients.agent_backend import (
    AgentBackendError,
    AgentBackendSessionCleanupPayload,
    FakeAgentBackendRunClient,
    RuntimeLayerSpec,
    cleanup_agent_backend_session,
)


def _payload() -> AgentBackendSessionCleanupPayload:
    return AgentBackendSessionCleanupPayload(
        session_snapshot=CompositorSessionSnapshot(
            layers=[
                LayerSessionSnapshot(
                    name="history",
                    lifecycle_state=LifecycleState.SUSPENDED,
                    runtime_state={},
                )
            ]
        ),
        runtime_layer_specs=[RuntimeLayerSpec(name="history", type="pydantic_ai.history")],
        idempotency_key="cleanup-1",
        metadata={"tenant_id": "tenant-1"},
        timeout_seconds=15.0,
    )


def test_cleanup_agent_backend_session_runs_create_and_wait_until_success():
    client = FakeAgentBackendRunClient(run_id="cleanup-run-1")

    result = cleanup_agent_backend_session(payload=_payload(), client=client)

    assert result.status == "succeeded"
    assert result.cleanup_run_id == "cleanup-run-1"
    assert client.request is not None
    assert [layer.name for layer in client.request.composition.layers] == ["history"]


def test_cleanup_agent_backend_session_skips_when_client_is_missing():
    result = cleanup_agent_backend_session(
        payload=_payload(),
        client=None,
    )

    assert result.status == "skipped"
    assert result.reason == "no_agent_backend_client"


def test_cleanup_agent_backend_session_skips_when_session_snapshot_is_missing():
    payload = _payload().model_copy(update={"session_snapshot": None})

    result = cleanup_agent_backend_session(payload=payload, client=FakeAgentBackendRunClient())

    assert result.status == "skipped"
    assert result.reason == "missing_session_snapshot"


def test_cleanup_agent_backend_session_skips_when_runtime_layer_specs_are_missing():
    payload = _payload().model_copy(update={"runtime_layer_specs": []})

    result = cleanup_agent_backend_session(payload=payload, client=FakeAgentBackendRunClient())

    assert result.status == "skipped"
    assert result.reason == "missing_runtime_layer_specs"


class _FailedStatusClient(FakeAgentBackendRunClient):
    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        del timeout_seconds
        return RunStatusResponse(
            run_id=run_id,
            status="failed",
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
            updated_at=datetime(2026, 1, 1, tzinfo=UTC),
            error="snapshot mismatch",
        )


def test_cleanup_agent_backend_session_reports_failed_terminal_status():
    client = _FailedStatusClient(run_id="cleanup-run-2")

    result = cleanup_agent_backend_session(payload=_payload(), client=client)

    assert result.status == "failed"
    assert result.reason == "snapshot mismatch"
    assert result.cleanup_run_id == "cleanup-run-2"


class _CreateRunFailureClient(FakeAgentBackendRunClient):
    def create_run(self, request):  # type: ignore[override]
        del request
        raise AgentBackendError("create run failed")


class _WaitRunFailureClient(FakeAgentBackendRunClient):
    def wait_run(self, run_id: str, *, timeout_seconds: float | None = None) -> RunStatusResponse:
        del run_id, timeout_seconds
        raise AgentBackendError("wait run failed")


def test_cleanup_agent_backend_session_returns_failed_when_create_run_raises():
    result = cleanup_agent_backend_session(payload=_payload(), client=_CreateRunFailureClient())

    assert result.status == "failed"
    assert result.reason == "create run failed"
    assert result.cleanup_run_id is None


def test_cleanup_agent_backend_session_returns_failed_with_cleanup_run_id_when_wait_run_raises():
    result = cleanup_agent_backend_session(
        payload=_payload(),
        client=_WaitRunFailureClient(run_id="cleanup-run-3"),
    )

    assert result.status == "failed"
    assert result.reason == "wait run failed"
    assert result.cleanup_run_id == "cleanup-run-3"

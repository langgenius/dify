from __future__ import annotations

from types import SimpleNamespace
from uuid import UUID

import pytest

from clients.a2a import (
    A2AAgentCard,
    A2ASendMessageResponse,
    A2AStreamResponse,
    A2ATask,
)
from core.workflow.nodes.agent_v2.external_runtime import (
    WorkflowExternalAgentRunError,
    WorkflowExternalAgentRunner,
)


def _card(*, streaming: bool = True) -> A2AAgentCard:
    return A2AAgentCard.model_validate(
        {
            "name": "Codex",
            "description": "Local coding agent",
            "supportedInterfaces": [
                {
                    "url": "http://host.docker.internal:8765",
                    "protocolBinding": "HTTP+JSON",
                    "protocolVersion": "1.0",
                }
            ],
            "version": "1.0.0",
            "capabilities": {"streaming": streaming},
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain", "application/json"],
            "skills": [],
        }
    )


class FakeConfigProvider:
    def __init__(self, *, streaming: bool = True) -> None:
        self.config = SimpleNamespace(
            endpoint="http://host.docker.internal:8765",
            decrypted_bearer_token=None,
            protocol_version="1.0",
            remote_agent_id="codex-local",
            agent_card=_card(streaming=streaming),
        )

    def get_runtime_config(
        self,
        *,
        tenant_id: str,
        agent_id: str,
        agent_config_snapshot_id: str,
    ) -> SimpleNamespace:
        del tenant_id, agent_id, agent_config_snapshot_id
        return self.config


class FakeClient:
    def __init__(
        self,
        *,
        stream_events: list[A2AStreamResponse] | None = None,
        send_response: A2ASendMessageResponse | None = None,
        polled_tasks: list[A2ATask] | None = None,
    ) -> None:
        self.stream_events = stream_events or []
        self.send_response = send_response
        self.polled_tasks = iter(polled_tasks or [])
        self.cancelled_task_ids: list[str] = []
        self.prompts: list[str] = []
        self.context_ids: list[object] = []
        self.message_ids: list[object] = []
        self.return_immediately_values: list[bool] = []
        self.stream_yield_count = 0

    def stream_message(
        self,
        *,
        text: str,
        context_id: str | None = None,
        message_id: str | None = None,
        **_: object,
    ):
        self.prompts.append(text)
        self.context_ids.append(context_id)
        self.message_ids.append(message_id)
        for event in self.stream_events:
            self.stream_yield_count += 1
            yield event

    def send_message(
        self,
        *,
        text: str,
        context_id: str | None = None,
        message_id: str | None = None,
        return_immediately: bool = False,
        **_: object,
    ) -> A2ASendMessageResponse:
        self.prompts.append(text)
        self.context_ids.append(context_id)
        self.message_ids.append(message_id)
        self.return_immediately_values.append(return_immediately)
        assert self.send_response is not None
        return self.send_response

    def get_task(self, *, task_id: str, **_: object) -> A2ATask:
        assert task_id == "task-1"
        return next(self.polled_tasks)

    def cancel_task(self, *, task_id: str, **_: object) -> A2ATask:
        self.cancelled_task_ids.append(task_id)
        return _task("TASK_STATE_CANCELED")


def _task(state: str, *, artifacts: list[dict[str, object]] | None = None) -> A2ATask:
    return A2ATask.model_validate(
        {
            "id": "task-1",
            "contextId": "context-1",
            "status": {"state": state},
            "artifacts": artifacts or [],
        }
    )


def _runner(client: FakeClient, *, streaming: bool = True) -> WorkflowExternalAgentRunner:
    return WorkflowExternalAgentRunner(
        config_provider=FakeConfigProvider(streaming=streaming),
        client_factory=lambda _endpoint, _token: client,
        poll_interval_seconds=0,
    )


def test_streaming_task_maps_text_artifact_to_default_workflow_output() -> None:
    client = FakeClient(
        stream_events=[
            A2AStreamResponse(task=_task("TASK_STATE_WORKING")),
            A2AStreamResponse.model_validate(
                {
                    "artifactUpdate": {
                        "taskId": "task-1",
                        "contextId": "context-1",
                        "artifact": {"artifactId": "answer", "parts": [{"text": "fixed"}]},
                        "lastChunk": True,
                    }
                }
            ),
            A2AStreamResponse.model_validate(
                {
                    "statusUpdate": {
                        "taskId": "task-1",
                        "contextId": "context-1",
                        "status": {"state": "TASK_STATE_COMPLETED"},
                    }
                }
            ),
        ]
    )

    result = _runner(client).run(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
        prompt="Fix the tests",
        request_metadata={"workflow_run_id": "run-1", "node_id": "node-1"},
        has_explicit_outputs=False,
        should_stop=lambda: False,
    )

    assert result.raw_output == {"text": "fixed"}
    assert result.task_id == "task-1"
    assert result.context_id == "context-1"
    assert result.event_count == 3
    assert result.metadata["status"] == "succeeded"
    assert client.prompts == ["Fix the tests"]
    assert client.context_ids == ["5354073f-1dd4-5f3a-8eae-2212e510d2c4"]
    assert UUID(str(client.message_ids[0])).version == 5


def test_exact_json_text_becomes_declared_output_object() -> None:
    client = FakeClient(
        stream_events=[
            A2AStreamResponse(
                task=_task(
                    "TASK_STATE_COMPLETED",
                    artifacts=[
                        {
                            "artifactId": "answer",
                            "parts": [{"text": '{"summary":"done","count":2}'}],
                        }
                    ],
                )
            )
        ]
    )

    result = _runner(client).run(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
        prompt="Return JSON",
        request_metadata={},
        has_explicit_outputs=True,
        should_stop=lambda: False,
    )

    assert result.raw_output == {"summary": "done", "count": 2}


def test_stream_closes_immediately_after_terminal_task() -> None:
    client = FakeClient(
        stream_events=[
            A2AStreamResponse(task=_task("TASK_STATE_COMPLETED")),
            A2AStreamResponse(task=_task("TASK_STATE_FAILED")),
        ]
    )

    _runner(client).run(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
        prompt="Work",
        request_metadata={},
        has_explicit_outputs=False,
        should_stop=lambda: False,
    )

    assert client.stream_yield_count == 1


def test_non_streaming_task_is_polled_until_complete() -> None:
    client = FakeClient(
        send_response=A2ASendMessageResponse(task=_task("TASK_STATE_WORKING")),
        polled_tasks=[
            _task(
                "TASK_STATE_COMPLETED",
                artifacts=[{"artifactId": "answer", "parts": [{"text": "done"}]}],
            )
        ],
    )

    result = _runner(client, streaming=False).run(
        tenant_id="tenant-1",
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
        prompt="Work",
        request_metadata={},
        has_explicit_outputs=False,
        should_stop=lambda: False,
    )

    assert result.raw_output == {"text": "done"}
    assert result.event_count == 2
    assert client.return_immediately_values == [True]


def test_failed_remote_task_raises_stable_workflow_error() -> None:
    client = FakeClient(stream_events=[A2AStreamResponse(task=_task("TASK_STATE_FAILED"))])

    with pytest.raises(WorkflowExternalAgentRunError) as exc_info:
        _runner(client).run(
            tenant_id="tenant-1",
            agent_id="agent-1",
            agent_config_snapshot_id="snapshot-1",
            prompt="Work",
            request_metadata={},
            has_explicit_outputs=False,
            should_stop=lambda: False,
        )

    assert exc_info.value.error_code == "external_agent_task_failed"


def test_workflow_abort_cancels_known_remote_task() -> None:
    client = FakeClient(stream_events=[A2AStreamResponse(task=_task("TASK_STATE_WORKING"))])

    with pytest.raises(WorkflowExternalAgentRunError) as exc_info:
        _runner(client).run(
            tenant_id="tenant-1",
            agent_id="agent-1",
            agent_config_snapshot_id="snapshot-1",
            prompt="Work",
            request_metadata={},
            has_explicit_outputs=False,
            should_stop=lambda: True,
        )

    assert exc_info.value.error_code == "external_agent_cancelled"
    assert client.cancelled_task_ids == ["task-1"]

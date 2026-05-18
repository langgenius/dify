from __future__ import annotations

from collections.abc import Iterator, Mapping
from enum import StrEnum
from typing import Any

from clients.agent_backend.dto import CONTRACT_VERSION, AgentBackendBaseModel, ReferenceType, ResourceRef
from clients.agent_backend.event_parser import AgentBackendEventParser
from clients.agent_backend.events import AgentBackendEvent, AgentBackendEventType
from clients.agent_backend.lifecycle import (
    AgentBackendInvokeRequest,
    AgentBackendLifecycleAck,
    AgentBackendLifecycleRequest,
    AgentLifecycleEvent,
    AgentLifecycleReason,
)


class MockAgentBackendScenario(StrEnum):
    SUCCESS_TEXT = "success_text"
    SUCCESS_FILE = "success_file"
    TOOL_CALL = "tool_call"
    PAUSE = "pause"
    ERROR = "error"
    UNKNOWN_EVENT = "unknown_event"


class MockAgentBackendClient(AgentBackendBaseModel):
    scenario: MockAgentBackendScenario = MockAgentBackendScenario.SUCCESS_TEXT

    def invoke(self, request: AgentBackendInvokeRequest) -> Iterator[AgentBackendEvent]:
        parser = AgentBackendEventParser()
        scenario = request.compositor_config.runtime_options.mock_scenario or self.scenario
        for raw_event in self._raw_events(request, MockAgentBackendScenario(scenario)):
            yield parser.parse(raw_event)

    def send_lifecycle(self, request: AgentBackendLifecycleRequest) -> AgentBackendLifecycleAck:
        return AgentBackendLifecycleAck(
            accepted=True,
            event=request.signal.event,
            reason=request.signal.reason,
            idempotency_key=request.signal.idempotency_key,
        )

    def _raw_events(
        self, request: AgentBackendInvokeRequest, scenario: MockAgentBackendScenario
    ) -> Iterator[Mapping[str, Any]]:
        match scenario:
            case MockAgentBackendScenario.SUCCESS_TEXT:
                yield self._envelope(request, 1, AgentBackendEventType.LIFECYCLE, self._lifecycle_payload())
                yield self._envelope(request, 2, AgentBackendEventType.TEXT_DELTA, {"delta": "hello "})
                yield self._envelope(request, 3, AgentBackendEventType.TEXT_DELTA, {"delta": "agent"})
                yield self._envelope(request, 4, AgentBackendEventType.TEXT_COMPLETED, {"text": "hello agent"})
                yield self._envelope(
                    request,
                    5,
                    AgentBackendEventType.OUTPUT_CREATED,
                    {"output_name": "text", "value": "hello agent"},
                )
            case MockAgentBackendScenario.SUCCESS_FILE:
                yield self._envelope(request, 1, AgentBackendEventType.LIFECYCLE, self._lifecycle_payload())
                yield self._envelope(
                    request,
                    2,
                    AgentBackendEventType.FILE_CREATED,
                    {
                        "file_ref": ResourceRef(
                            type=ReferenceType.FILE,
                            id="mock-file-1",
                            name="result.txt",
                        ).model_dump(mode="json"),
                        "output_name": "result_file",
                    },
                )
                yield self._envelope(
                    request,
                    3,
                    AgentBackendEventType.OUTPUT_CREATED,
                    {"output_name": "result_file", "value": {"file_id": "mock-file-1"}},
                )
            case MockAgentBackendScenario.TOOL_CALL:
                yield self._envelope(
                    request,
                    1,
                    AgentBackendEventType.TOOL_CALL_STARTED,
                    {"tool_call_id": "tool-call-1", "tool_name": "web_search", "input": {"query": "Dify"}},
                )
                yield self._envelope(
                    request,
                    2,
                    AgentBackendEventType.TOOL_CALL_SUCCEEDED,
                    {"tool_call_id": "tool-call-1", "output": {"result": "ok"}},
                )
                yield self._envelope(request, 3, AgentBackendEventType.TEXT_DELTA, {"delta": "done"})
                yield self._envelope(
                    request,
                    4,
                    AgentBackendEventType.OUTPUT_CREATED,
                    {"output_name": "text", "value": "done"},
                )
            case MockAgentBackendScenario.PAUSE:
                yield self._envelope(request, 1, AgentBackendEventType.TEXT_DELTA, {"delta": "waiting"})
                yield self._envelope(
                    request,
                    2,
                    AgentBackendEventType.PAUSE_REQUESTED,
                    {"reason": "human_handoff", "message": "Need human input"},
                )
            case MockAgentBackendScenario.ERROR:
                yield self._envelope(
                    request,
                    1,
                    AgentBackendEventType.ERROR,
                    {
                        "category": "mock",
                        "code": "mock_error",
                        "message": "Mock agent backend error",
                        "retryable": False,
                    },
                )
            case MockAgentBackendScenario.UNKNOWN_EVENT:
                yield self._envelope(request, 1, "unknown.event", {"value": "boom"})

    def _envelope(
        self,
        request: AgentBackendInvokeRequest,
        sequence: int,
        event_type: AgentBackendEventType | str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        return {
            "contract_version": CONTRACT_VERSION,
            "event_id": f"{request.idempotency_key}:{sequence}",
            "sequence": sequence,
            "type": str(event_type),
            "created_at": 1_800_000_000_000 + sequence,
            "execution_context": request.compositor_config.execution_context.model_dump(mode="json"),
            "payload": dict(payload),
        }

    @staticmethod
    def _lifecycle_payload() -> dict[str, str]:
        return {
            "lifecycle_event": AgentLifecycleEvent.CREATE.value,
            "lifecycle_reason": AgentLifecycleReason.WORKFLOW_RUN_START.value,
        }

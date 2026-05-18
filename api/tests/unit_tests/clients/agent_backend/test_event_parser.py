import pytest

from clients.agent_backend import (
    CONTRACT_VERSION,
    AgentBackendEventParser,
    AgentBackendEventType,
    AgentErrorEvent,
    AgentExecutionContext,
    AgentFileCreatedEvent,
    AgentInvokeFrom,
    AgentLifecycleAckEvent,
    AgentOutputCreatedEvent,
    AgentOutputDeltaEvent,
    AgentOutputValidationFailedEvent,
    AgentPauseRequestedEvent,
    AgentTextCompletedEvent,
    AgentTextDeltaEvent,
    AgentToolCallDeltaEvent,
    AgentToolCallFailedEvent,
    AgentToolCallStartedEvent,
    AgentToolCallSucceededEvent,
)
from clients.agent_backend.errors import (
    AgentBackendContractVersionError,
    AgentBackendEventParseError,
    AgentBackendUnknownEventError,
)


def _context_dict():
    return AgentExecutionContext(tenant_id="tenant-1", invoke_from=AgentInvokeFrom.WORKFLOW_RUN).model_dump(mode="json")


def _raw_event(event_type: str, payload: dict, sequence: int = 1) -> dict:
    return {
        "contract_version": CONTRACT_VERSION,
        "event_id": f"event-{sequence}",
        "sequence": sequence,
        "type": event_type,
        "created_at": 1_800_000_000_000 + sequence,
        "execution_context": _context_dict(),
        "payload": payload,
    }


@pytest.mark.parametrize(
    ("event_type", "payload", "expected_cls"),
    [
        (
            AgentBackendEventType.LIFECYCLE,
            {"lifecycle_event": "create", "lifecycle_reason": "workflow_run_start"},
            AgentLifecycleAckEvent,
        ),
        (AgentBackendEventType.TEXT_DELTA, {"delta": "hello"}, AgentTextDeltaEvent),
        (AgentBackendEventType.TEXT_COMPLETED, {"text": "hello"}, AgentTextCompletedEvent),
        (
            AgentBackendEventType.TOOL_CALL_STARTED,
            {"tool_call_id": "tool-1", "tool_name": "web_search"},
            AgentToolCallStartedEvent,
        ),
        (AgentBackendEventType.TOOL_CALL_DELTA, {"tool_call_id": "tool-1", "delta": "chunk"}, AgentToolCallDeltaEvent),
        (
            AgentBackendEventType.TOOL_CALL_SUCCEEDED,
            {"tool_call_id": "tool-1", "output": {"ok": True}},
            AgentToolCallSucceededEvent,
        ),
        (
            AgentBackendEventType.TOOL_CALL_FAILED,
            {"tool_call_id": "tool-1", "error": "failed"},
            AgentToolCallFailedEvent,
        ),
        (
            AgentBackendEventType.FILE_CREATED,
            {"file_ref": {"type": "file", "id": "file-1"}},
            AgentFileCreatedEvent,
        ),
        (AgentBackendEventType.OUTPUT_DELTA, {"output_name": "summary", "delta": "part"}, AgentOutputDeltaEvent),
        (AgentBackendEventType.OUTPUT_CREATED, {"output_name": "summary", "value": "done"}, AgentOutputCreatedEvent),
        (
            AgentBackendEventType.OUTPUT_VALIDATION_FAILED,
            {"output_name": "report", "error": "not a pdf"},
            AgentOutputValidationFailedEvent,
        ),
        (
            AgentBackendEventType.ERROR,
            {"category": "runtime", "code": "boom", "message": "failed"},
            AgentErrorEvent,
        ),
        (AgentBackendEventType.PAUSE_REQUESTED, {"reason": "human_handoff"}, AgentPauseRequestedEvent),
    ],
)
def test_event_parser_parses_all_known_event_types(event_type, payload, expected_cls):
    event = AgentBackendEventParser().parse(_raw_event(str(event_type), payload))

    assert isinstance(event, expected_cls)
    assert event.event_id == "event-1"
    assert event.execution_context.tenant_id == "tenant-1"


def test_event_parser_rejects_unknown_event_type():
    with pytest.raises(AgentBackendUnknownEventError):
        AgentBackendEventParser().parse(_raw_event("unknown.event", {"value": "boom"}))


def test_event_parser_rejects_unknown_contract_version():
    raw_event = _raw_event("text.delta", {"delta": "hello"})
    raw_event["contract_version"] = "agent-backend.v999"

    with pytest.raises(AgentBackendContractVersionError):
        AgentBackendEventParser().parse(raw_event)


def test_event_parser_rejects_invalid_payload_shape():
    with pytest.raises(AgentBackendEventParseError):
        AgentBackendEventParser().parse(_raw_event("text.delta", {"text": "wrong"}))

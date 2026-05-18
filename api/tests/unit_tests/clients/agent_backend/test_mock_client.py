import pytest

from clients.agent_backend import (
    AgentBackendInvokeRequest,
    AgentErrorEvent,
    AgentExecutionContext,
    AgentInvokeFrom,
    AgentOutputCreatedEvent,
    AgentPauseRequestedEvent,
    AgentTextDeltaEvent,
    CompositorConfig,
    MockAgentBackendClient,
    MockAgentBackendScenario,
    PromptLayerConfig,
    PromptOrigin,
    PromptRole,
)
from clients.agent_backend.errors import AgentBackendUnknownEventError


def _request(mock_scenario: str | None = None) -> AgentBackendInvokeRequest:
    config = CompositorConfig(
        execution_context=AgentExecutionContext(tenant_id="tenant-1", invoke_from=AgentInvokeFrom.WORKFLOW_RUN),
        layers=[
            PromptLayerConfig(
                id="prompt",
                origin=PromptOrigin.AGENT_SOUL,
                role=PromptRole.SYSTEM,
                content="You are a helpful agent.",
            )
        ],
    )
    if mock_scenario:
        config.runtime_options.mock_scenario = mock_scenario
    return AgentBackendInvokeRequest(compositor_config=config, idempotency_key="invoke-1")


def test_mock_client_success_text_stream_is_deterministic():
    client = MockAgentBackendClient(scenario=MockAgentBackendScenario.SUCCESS_TEXT)

    first = [event.model_dump(mode="json") for event in client.invoke(_request())]
    second = [event.model_dump(mode="json") for event in client.invoke(_request())]

    assert first == second
    assert [event["sequence"] for event in first] == [1, 2, 3, 4, 5]
    assert isinstance(next(client.invoke(_request())), object)
    assert first[-1]["type"] == "output.created"
    assert first[-1]["value"] == "hello agent"


def test_mock_client_can_select_scenario_from_request():
    events = list(MockAgentBackendClient().invoke(_request(MockAgentBackendScenario.PAUSE)))

    assert any(isinstance(event, AgentTextDeltaEvent) for event in events)
    assert isinstance(events[-1], AgentPauseRequestedEvent)


def test_mock_client_error_event_does_not_raise_transport_error():
    events = list(MockAgentBackendClient(scenario=MockAgentBackendScenario.ERROR).invoke(_request()))

    assert len(events) == 1
    assert isinstance(events[0], AgentErrorEvent)
    assert events[0].code == "mock_error"


def test_mock_client_success_file_returns_output_event():
    events = list(MockAgentBackendClient(scenario=MockAgentBackendScenario.SUCCESS_FILE).invoke(_request()))

    assert isinstance(events[-1], AgentOutputCreatedEvent)
    assert events[-1].output_name == "result_file"


def test_mock_client_unknown_event_scenario_exercises_parser_failure():
    with pytest.raises(AgentBackendUnknownEventError):
        list(MockAgentBackendClient(scenario=MockAgentBackendScenario.UNKNOWN_EVENT).invoke(_request()))

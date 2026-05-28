from dify_agent.layers.execution_context import DifyExecutionContextLayerConfig

from clients.agent_backend import (
    AgentBackendModelConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    FakeAgentBackendRunClient,
    FakeAgentBackendScenario,
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


def test_fake_client_stream_is_deterministic():
    client = FakeAgentBackendRunClient()
    request = _request()

    created = client.create_run(request)
    first = [event.model_dump(mode="json") for event in client.stream_events(created.run_id)]
    second = [event.model_dump(mode="json") for event in client.stream_events(created.run_id)]

    assert created.run_id == "fake-run-1"
    assert client.request is request
    assert first == second
    assert [event["type"] for event in first] == ["run_started", "run_succeeded"]
    assert first[-1]["data"]["output"] == {"text": "hello agent"}


def test_fake_client_stream_honors_cursor():
    events = list(FakeAgentBackendRunClient().stream_events("fake-run-1", after="1-0"))

    assert len(events) == 1
    assert events[0].type == "run_succeeded"


def test_fake_client_failed_scenario_returns_failed_status_and_event():
    client = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.FAILED)

    status = client.wait_run("fake-run-1")
    events = list(client.stream_events("fake-run-1"))

    assert status.status == "failed"
    assert status.error == "fake failure"
    assert events[-1].type == "run_failed"
    assert events[-1].data.error == "fake failure"


def test_fake_client_cancel_run_returns_cancelled_status():
    cancelled = FakeAgentBackendRunClient().cancel_run("fake-run-1")

    assert cancelled.run_id == "fake-run-1"
    assert cancelled.status == "cancelled"


def test_fake_client_paused_scenario_returns_paused_status_and_event():
    """The paused scenario exists for HITL-style flows; both ``wait_run`` and
    the event stream must report the pause so consumers can branch on it."""
    client = FakeAgentBackendRunClient(scenario=FakeAgentBackendScenario.PAUSED)

    status = client.wait_run("fake-run-1")
    events = list(client.stream_events("fake-run-1"))

    assert status.status == "paused"
    assert status.error is None
    assert events[-1].type == "run_paused"
    assert events[-1].data.reason == "human_input_required"


def test_fake_client_success_wait_run_returns_succeeded_status():
    """Covers the default SUCCESS branch of ``wait_run`` directly."""
    status = FakeAgentBackendRunClient().wait_run("fake-run-1")

    assert status.status == "succeeded"
    assert status.error is None

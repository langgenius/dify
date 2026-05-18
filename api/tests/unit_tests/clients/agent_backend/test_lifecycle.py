from clients.agent_backend import (
    AgentBackendLifecycleAck,
    AgentBackendLifecycleRequest,
    AgentBackendLifecycleSignal,
    AgentExecutionContext,
    AgentInvokeFrom,
    AgentLifecycleEvent,
    AgentLifecycleReason,
    MockAgentBackendClient,
)


def _execution_context(invoke_from: AgentInvokeFrom = AgentInvokeFrom.WORKFLOW_RUN) -> AgentExecutionContext:
    return AgentExecutionContext(tenant_id="tenant-1", invoke_from=invoke_from)


def test_lifecycle_signal_is_idempotent_shape():
    signal = AgentBackendLifecycleSignal(
        event=AgentLifecycleEvent.CREATE,
        reason=AgentLifecycleReason.WORKFLOW_RUN_START,
        execution_context=_execution_context(),
        idempotency_key="workflow-run-1:create",
    )

    dumped = signal.model_dump(mode="json")

    assert dumped == {
        "event": "create",
        "reason": "workflow_run_start",
        "execution_context": {
            "tenant_id": "tenant-1",
            "app_id": None,
            "workflow_id": None,
            "workflow_run_id": None,
            "node_id": None,
            "node_execution_id": None,
            "conversation_id": None,
            "agent_id": None,
            "agent_config_version_id": None,
            "invoke_from": "workflow_run",
            "trace_id": None,
        },
        "target_layer_ids": None,
        "idempotency_key": "workflow-run-1:create",
    }


def test_lifecycle_reason_mapping_covers_phase0_scenarios():
    expected = {
        AgentLifecycleReason.WORKFLOW_RUN_START,
        AgentLifecycleReason.WORKFLOW_RUN_FINISH,
        AgentLifecycleReason.SINGLE_STEP_START,
        AgentLifecycleReason.BABYSIT_START,
        AgentLifecycleReason.HUMAN_HANDOFF,
        AgentLifecycleReason.WORKFLOW_HANDOFF,
        AgentLifecycleReason.RESUME,
        AgentLifecycleReason.FASTEN_PREVIEW,
        AgentLifecycleReason.CANCEL,
    }

    assert set(AgentLifecycleReason) == expected


def test_mock_client_accepts_lifecycle_signal():
    client = MockAgentBackendClient()
    signal = AgentBackendLifecycleSignal(
        event=AgentLifecycleEvent.DELETE,
        reason=AgentLifecycleReason.CANCEL,
        execution_context=_execution_context(AgentInvokeFrom.BABYSIT),
        idempotency_key="babysit-1:cancel",
    )

    ack = client.send_lifecycle(AgentBackendLifecycleRequest(signal=signal))

    assert ack == AgentBackendLifecycleAck(
        accepted=True,
        event=AgentLifecycleEvent.DELETE,
        reason=AgentLifecycleReason.CANCEL,
        idempotency_key="babysit-1:cancel",
    )

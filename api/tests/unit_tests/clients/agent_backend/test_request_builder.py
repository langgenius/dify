import pytest
from agenton.layers import ExitIntent
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID
from dify_agent.layers.dify_plugin import DIFY_PLUGIN_LAYER_TYPE_ID, DIFY_PLUGIN_LLM_LAYER_TYPE_ID
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID
from dify_agent.protocol import (
    DIFY_AGENT_MODEL_LAYER_ID,
    DIFY_AGENT_OUTPUT_LAYER_ID,
    CreateRunRequest,
    ExecutionContext,
)
from pydantic import ValidationError

from clients.agent_backend import (
    AGENT_SOUL_PROMPT_LAYER_ID,
    WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
    WORKFLOW_USER_PROMPT_LAYER_ID,
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    redact_for_agent_backend_log,
)


def _run_input() -> AgentBackendWorkflowNodeRunInput:
    return AgentBackendWorkflowNodeRunInput(
        model=AgentBackendModelConfig(
            tenant_id="tenant-1",
            plugin_id="langgenius/openai",
            user_id="user-1",
            model_provider="openai",
            model="gpt-test",
            credentials={"api_key": "secret-key"},
        ),
        execution_context=ExecutionContext(
            tenant_id="tenant-1",
            workflow_id="workflow-1",
            workflow_run_id="workflow-run-1",
            node_id="node-1",
            node_execution_id="node-execution-1",
            invoke_from="workflow_run",
        ),
        idempotency_key="workflow-run-1:node-execution-1",
        agent_soul_prompt="You are a careful reviewer.",
        workflow_node_job_prompt="Review the previous node output.",
        user_prompt="Summarize the report.",
        output=AgentBackendOutputConfig(
            json_schema={
                "type": "object",
                "properties": {"summary": {"type": "string"}},
                "required": ["summary"],
            }
        ),
        metadata={"workflow_id": "workflow-1", "node_id": "node-1"},
    )


def test_request_builder_outputs_dify_agent_create_run_request():
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())

    assert isinstance(request, CreateRunRequest)
    assert [layer.name for layer in request.composition.layers] == [
        AGENT_SOUL_PROMPT_LAYER_ID,
        WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
        WORKFLOW_USER_PROMPT_LAYER_ID,
        "plugin",
        DIFY_AGENT_MODEL_LAYER_ID,
        DIFY_AGENT_OUTPUT_LAYER_ID,
    ]
    assert request.on_exit.default is ExitIntent.DELETE
    assert request.execution_context is not None
    assert request.execution_context.node_execution_id == "node-execution-1"
    assert request.idempotency_key == "workflow-run-1:node-execution-1"
    assert request.metadata == {"workflow_id": "workflow-1", "node_id": "node-1"}


def test_request_builder_separates_agent_soul_and_workflow_job_prompt():
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())
    layers = {layer.name: layer for layer in request.composition.layers}

    assert layers[AGENT_SOUL_PROMPT_LAYER_ID].type == PLAIN_PROMPT_LAYER_TYPE_ID
    assert layers[AGENT_SOUL_PROMPT_LAYER_ID].metadata["origin"] == "agent_soul"
    assert layers[WORKFLOW_NODE_JOB_PROMPT_LAYER_ID].metadata["origin"] == "workflow_node_job"
    assert layers[WORKFLOW_USER_PROMPT_LAYER_ID].metadata["origin"] == "workflow_user_prompt"

    dumped = request.model_dump(mode="json")
    assert dumped["composition"]["layers"][0]["config"]["prefix"] == "You are a careful reviewer."
    assert dumped["composition"]["layers"][1]["config"]["prefix"] == "Review the previous node output."
    assert dumped["composition"]["layers"][2]["config"]["user"] == "Summarize the report."


def test_request_builder_sets_model_and_output_layer_contract_ids():
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())
    layers = {layer.name: layer for layer in request.composition.layers}

    assert layers["plugin"].type == DIFY_PLUGIN_LAYER_TYPE_ID
    assert layers[DIFY_AGENT_MODEL_LAYER_ID].type == DIFY_PLUGIN_LLM_LAYER_TYPE_ID
    assert layers[DIFY_AGENT_MODEL_LAYER_ID].deps == {"plugin": "plugin"}
    assert layers[DIFY_AGENT_OUTPUT_LAYER_ID].type == DIFY_OUTPUT_LAYER_TYPE_ID


def test_request_builder_can_suspend_on_exit_for_resume_or_babysit_paths():
    run_input = _run_input()
    run_input.suspend_on_exit = True

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)

    assert request.on_exit.default is ExitIntent.SUSPEND


def test_request_builder_rejects_blank_prompts():
    with pytest.raises(ValidationError):
        AgentBackendWorkflowNodeRunInput(
            model=AgentBackendModelConfig(
                tenant_id="tenant-1",
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            execution_context=ExecutionContext(tenant_id="tenant-1", invoke_from="workflow_run"),
            workflow_node_job_prompt=" ",
            user_prompt="hello",
        )


def test_redact_for_agent_backend_log_hides_credentials():
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())

    redacted = redact_for_agent_backend_log(request)

    assert redacted["composition"]["layers"][4]["config"]["credentials"] == "[REDACTED]"

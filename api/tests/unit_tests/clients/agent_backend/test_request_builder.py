from typing import Any, cast

import pytest
from agenton.compositor import CompositorSessionSnapshot
from agenton.compositor.schemas import LayerSessionSnapshot
from agenton.layers import ExitIntent
from agenton.layers.base import LifecycleState
from agenton_collections.layers.plain import PLAIN_PROMPT_LAYER_TYPE_ID, PromptLayerConfig
from agenton_collections.layers.pydantic_ai import PYDANTIC_AI_HISTORY_LAYER_TYPE_ID
from dify_agent.layers.dify_plugin import (
    DIFY_PLUGIN_LLM_LAYER_TYPE_ID,
    DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID,
    DifyPluginLLMLayerConfig,
    DifyPluginToolConfig,
    DifyPluginToolsLayerConfig,
)
from dify_agent.layers.execution_context import DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID, DifyExecutionContextLayerConfig
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID
from dify_agent.protocol import (
    DIFY_AGENT_HISTORY_LAYER_ID,
    DIFY_AGENT_MODEL_LAYER_ID,
    DIFY_AGENT_OUTPUT_LAYER_ID,
    CreateRunRequest,
)
from pydantic import ValidationError

from clients.agent_backend import (
    AGENT_SOUL_PROMPT_LAYER_ID,
    DIFY_EXECUTION_CONTEXT_LAYER_ID,
    DIFY_PLUGIN_TOOLS_LAYER_ID,
    WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
    WORKFLOW_USER_PROMPT_LAYER_ID,
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    CleanupLayerSpec,
    redact_for_agent_backend_log,
)


def _run_input() -> AgentBackendWorkflowNodeRunInput:
    return AgentBackendWorkflowNodeRunInput(
        model=AgentBackendModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
            credentials={"api_key": "secret-key"},
        ),
        execution_context=DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
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
        DIFY_EXECUTION_CONTEXT_LAYER_ID,
        DIFY_AGENT_HISTORY_LAYER_ID,
        DIFY_AGENT_MODEL_LAYER_ID,
        DIFY_AGENT_OUTPUT_LAYER_ID,
    ]
    assert request.on_exit.default is ExitIntent.SUSPEND
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

    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID].type == DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID
    assert cast(DifyExecutionContextLayerConfig, layers[DIFY_EXECUTION_CONTEXT_LAYER_ID].config).user_id == "user-1"
    assert layers[DIFY_AGENT_HISTORY_LAYER_ID].type == PYDANTIC_AI_HISTORY_LAYER_TYPE_ID
    assert layers[DIFY_AGENT_MODEL_LAYER_ID].type == DIFY_PLUGIN_LLM_LAYER_TYPE_ID
    assert cast(DifyPluginLLMLayerConfig, layers[DIFY_AGENT_MODEL_LAYER_ID].config).plugin_id == "langgenius/openai"
    assert layers[DIFY_AGENT_MODEL_LAYER_ID].deps == {"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID}
    assert layers[DIFY_AGENT_OUTPUT_LAYER_ID].type == DIFY_OUTPUT_LAYER_TYPE_ID


def test_request_builder_adds_dify_plugin_tools_layer_when_configured():
    run_input = _run_input()
    run_input.tools = DifyPluginToolsLayerConfig(
        tools=[
            DifyPluginToolConfig(
                plugin_id="langgenius/time",
                provider="time",
                tool_name="current_time",
                credential_type="unauthorized",
                name="current_time",
                description="Get current time.",
                credentials={},
                runtime_parameters={},
                parameters=[],
                parameters_json_schema={"type": "object", "properties": {}, "required": []},
            )
        ]
    )

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID].type == DIFY_PLUGIN_TOOLS_LAYER_TYPE_ID
    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID].deps == {"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID}
    tools_config = cast(DifyPluginToolsLayerConfig, layers[DIFY_PLUGIN_TOOLS_LAYER_ID].config)
    assert tools_config.tools[0].tool_name == "current_time"


def test_request_builder_can_delete_on_exit_for_cleanup_paths():
    run_input = _run_input()
    run_input.suspend_on_exit = False

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)

    assert request.on_exit.default is ExitIntent.DELETE


def test_request_builder_builds_cleanup_request_replays_persisted_layer_specs():
    """The cleanup request must replay the persisted (non-plugin) layer specs
    and filter the snapshot to match so the agenton compositor's
    snapshot-vs-composition name-order validator passes."""
    session_snapshot = CompositorSessionSnapshot(
        layers=[
            LayerSessionSnapshot(name="history", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={"k": 1}),
            LayerSessionSnapshot(name="llm", lifecycle_state=LifecycleState.SUSPENDED, runtime_state={}),
        ]
    )
    specs = [CleanupLayerSpec(name="history", type="pydantic_ai.history")]

    request = AgentBackendRunRequestBuilder().build_cleanup_request(
        session_snapshot=session_snapshot,
        composition_layer_specs=specs,
        idempotency_key="run-1:node-1:binding-1:agent-session-cleanup",
        metadata={"workflow_run_id": "run-1"},
    )

    assert [layer.name for layer in request.composition.layers] == ["history"]
    assert request.session_snapshot is not None
    assert [layer.name for layer in request.session_snapshot.layers] == ["history"]
    assert request.on_exit.default is ExitIntent.DELETE
    assert request.idempotency_key == "run-1:node-1:binding-1:agent-session-cleanup"
    assert request.metadata["agent_backend_lifecycle"] == "session_cleanup"


def test_request_builder_rejects_empty_composition_layer_specs():
    """Empty specs would put us back in the original ``layers=[]`` trap that
    fails on agenton's snapshot-vs-composition validation."""
    with pytest.raises(ValueError, match="composition_layer_specs"):
        AgentBackendRunRequestBuilder().build_cleanup_request(
            session_snapshot=CompositorSessionSnapshot(layers=[]),
            composition_layer_specs=[],
        )


def test_extract_cleanup_layer_specs_drops_plugin_layers_keeps_configs():
    from dify_agent.protocol import RunComposition, RunLayerSpec

    from clients.agent_backend import extract_cleanup_layer_specs

    composition = RunComposition(
        layers=[
            RunLayerSpec(
                name="agent_soul_prompt",
                type="plain.prompt",
                config=PromptLayerConfig(prefix="hello"),
            ),
            RunLayerSpec(
                name="llm",
                type="dify.plugin.llm",
                config=None,  # protocol allows None; the redacted config is what matters
            ),
            RunLayerSpec(
                name="tools",
                type="dify.plugin.tools",
            ),
            RunLayerSpec(
                name="history",
                type="pydantic_ai.history",
            ),
        ]
    )

    specs = extract_cleanup_layer_specs(composition)

    assert [spec.name for spec in specs] == ["agent_soul_prompt", "history"]
    # Non-plugin configs are dumped as JSON-compatible dicts so the persisted
    # row can be replayed without holding live pydantic instances.
    soul_config = specs[0].config
    assert isinstance(soul_config, dict)
    assert soul_config.get("prefix") == "hello"


def test_request_builder_rejects_blank_prompts():
    with pytest.raises(ValidationError):
        AgentBackendWorkflowNodeRunInput(
            model=AgentBackendModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            execution_context=DifyExecutionContextLayerConfig(tenant_id="tenant-1", invoke_from="workflow_run"),
            workflow_node_job_prompt=" ",
            user_prompt="hello",
        )


def test_redact_for_agent_backend_log_hides_credentials():
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())

    redacted = cast(dict[str, Any], redact_for_agent_backend_log(request))

    assert redacted["composition"]["layers"][5]["config"]["credentials"] == "[REDACTED]"

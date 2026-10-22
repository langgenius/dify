import json
from typing import Any, cast
from unittest.mock import Mock

import httpx
import pytest
from dify_agent.adapters.llm.model import _get_stop_sequences, _map_model_settings_to_parameters
from dify_agent.layers.dify_core_tools import DifyCoreToolConfig, DifyCoreToolsLayerConfig
from dify_agent.layers.dify_plugin import DifyPluginLLMLayerConfig, DifyPluginToolConfig, DifyPluginToolsLayerConfig
from dify_agent.layers.execution_context import ApplicationTracingContext, DifyExecutionContextLayerConfig
from dify_agent.layers.knowledge import DifyKnowledgeBaseLayerConfig
from dify_agent.layers.knowledge_fs import DifyKnowledgeFsLayerConfig
from dify_agent.layers.prompt import Config as PromptConfig
from dify_agent.layers.shell import DifyShellEnvVarConfig, DifyShellLayerConfig
from dify_agent.layers.user_prompt import DifyUserPromptDownloadConfig, DifyUserPromptImageConfig
from dify_agent.protocol import (
    DIFY_AGENT_HISTORY_LAYER_ID,
    DIFY_AGENT_MODEL_LAYER_ID,
    DIFY_AGENT_OUTPUT_LAYER_ID,
    CreateRunRequest,
)
from dify_agent.runtime.context import Services
from dify_agent.runtime.modules import create_modules, load_modules
from pydantic import JsonValue, ValidationError

from clients.agent_backend import (
    AGENT_SOUL_PROMPT_LAYER_ID,
    DIFY_CORE_TOOLS_LAYER_ID,
    DIFY_EXECUTION_CONTEXT_LAYER_ID,
    DIFY_KNOWLEDGE_BASE_LAYER_ID,
    DIFY_PLUGIN_TOOLS_LAYER_ID,
    WORKFLOW_NODE_JOB_PROMPT_LAYER_ID,
    WORKFLOW_USER_PROMPT_LAYER_ID,
    AgentBackendAgentAppRunInput,
    AgentBackendModelConfig,
    AgentBackendOutputConfig,
    AgentBackendRunRequestBuilder,
    AgentBackendWorkflowNodeRunInput,
    redact_for_agent_backend_log,
)
from clients.agent_backend.request_builder import DIFY_SHELL_LAYER_ID
from models.agent_config_entities import AgentSoulModelSettings


def _run_input() -> AgentBackendWorkflowNodeRunInput:
    return AgentBackendWorkflowNodeRunInput(
        model=AgentBackendModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        execution_context=DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="account",
            workflow_id="workflow-1",
            workflow_run_id="workflow-run-1",
            node_id="node-1",
            node_execution_id="node-execution-1",
            agent_mode="workflow_run",
            invoke_from="debugger",
        ),
        backend_binding_ref="binding-ref-1",
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


def test_request_builder_outputs_dify_agent_create_run_request() -> None:
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())
    dumped = request.model_dump(mode="json")

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
    assert request.idempotency_key == "workflow-run-1:node-execution-1"
    assert request.metadata == {"workflow_id": "workflow-1", "node_id": "node-1"}
    assert "purpose" not in dumped


def test_request_builder_separates_agent_soul_and_workflow_job_prompt() -> None:
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())
    {layer.name: layer for layer in request.composition.layers}

    dumped = request.model_dump(mode="json")
    assert dumped["composition"]["layers"][0]["config"]["prefix"] == "You are a careful reviewer."
    workflow_job_config = dumped["composition"]["layers"][1]["config"]
    assert workflow_job_config["user"] == "Review the previous node output."
    assert not workflow_job_config.get("prefix")
    assert dumped["composition"]["layers"][2]["config"]["user"] == "Summarize the report."


def test_request_builder_forwards_plugin_specific_model_settings_via_extra_body() -> None:
    run_input = _run_input().model_copy(
        update={
            "model": AgentBackendModelConfig(
                plugin_id="langgenius/tongyi",
                model_provider="tongyi",
                model="qwen-plus-latest",
                model_settings={"temperature": 0.7, "enable_thinking": True, "thinking_budget": 4096},
            )
        }
    )

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}
    model_config = DifyPluginLLMLayerConfig.model_validate(layers[DIFY_AGENT_MODEL_LAYER_ID].config)

    assert model_config.model_settings == {
        "temperature": 0.7,
        "extra_body": {"enable_thinking": True, "thinking_budget": 4096},
    }


@pytest.mark.parametrize("builder_kind", ["agent_app", "workflow_node"])
@pytest.mark.parametrize(
    "settings",
    [
        pytest.param({}, id="default"),
        pytest.param({"response_format": None}, id="none"),
        pytest.param({"response_format": "text"}, id="plugin-text"),
        pytest.param(
            {
                "response_format": "json_schema",
                "json_schema": json.dumps(
                    {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"]}
                ),
            },
            id="plugin-json-schema",
        ),
        pytest.param({"response_format": {"type": "text"}}, id="legacy-text"),
        pytest.param(
            {
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": "response", "schema": {"type": "object"}},
                }
            },
            id="legacy-json-schema",
        ),
    ],
)
def test_response_format_reaches_plugin_parameters_through_real_request_serialization(
    builder_kind: str, settings: dict[str, JsonValue]
) -> None:
    soul_settings = AgentSoulModelSettings.model_validate(
        {**settings, "temperature": 0.2, "stop": ["END"], "enable_thinking": True}
    )
    model = AgentBackendModelConfig(
        plugin_id="langgenius/openai",
        model_provider="openai",
        model="gpt-test",
        model_settings=soul_settings.model_dump(mode="json", exclude_none=True),
    )
    builder = AgentBackendRunRequestBuilder()
    if builder_kind == "agent_app":
        request = builder.build_for_agent_app(_agent_app_input().model_copy(update={"model": model}))
    else:
        request = builder.build_for_workflow_node(_run_input().model_copy(update={"model": model}))

    request = CreateRunRequest.model_validate_json(request.model_dump_json())
    model_layer = next(layer for layer in request.composition.layers if layer.name == DIFY_AGENT_MODEL_LAYER_ID)
    model_config = DifyPluginLLMLayerConfig.model_validate(model_layer.config)
    plugin_settings = {key: value for key, value in settings.items() if value is not None}

    assert model_config.model_settings == {
        "temperature": 0.2,
        "stop_sequences": ["END"],
        "extra_body": {"enable_thinking": True, **plugin_settings},
    }
    assert _map_model_settings_to_parameters(model_config.model_settings) == {
        "temperature": 0.2,
        "enable_thinking": True,
        **plugin_settings,
    }
    assert _get_stop_sequences(model_config.model_settings) == ["END"]


@pytest.mark.parametrize("agent_config_version_kind", ["snapshot", "draft"])
def test_agent_app_request_builder_keeps_agent_soul_prompt_for_snapshot_and_draft(
    agent_config_version_kind: str,
) -> None:
    original_prompt = "  You are Iris.  \n"
    run_input = _agent_app_input().model_copy(
        update={
            "agent_config_version_kind": agent_config_version_kind,
            "agent_soul_prompt": original_prompt,
        }
    )

    request = AgentBackendRunRequestBuilder().build_for_agent_app(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    prompt_config = PromptConfig.model_validate(layers[AGENT_SOUL_PROMPT_LAYER_ID].config)
    assert prompt_config.prefix == original_prompt


def test_agent_app_request_builder_wraps_agent_soul_prompt_for_build_draft() -> None:
    original_prompt = "  You are Iris.  \n"
    run_input = _agent_app_input().model_copy(
        update={
            "agent_config_version_kind": "build_draft",
            "agent_soul_prompt": original_prompt,
        }
    )

    request = AgentBackendRunRequestBuilder().build_for_agent_app(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    prompt_config = PromptConfig.model_validate(layers[AGENT_SOUL_PROMPT_LAYER_ID].config)
    assert prompt_config.prefix != original_prompt
    assert isinstance(prompt_config.prefix, str)
    assert prompt_config.prefix.startswith("You are running in build mode.")
    assert "```text\nYou are Iris.\n```" in prompt_config.prefix


def test_agent_app_request_builder_uses_longer_fence_for_build_draft_prompt_body() -> None:
    run_input = _agent_app_input().model_copy(
        update={
            "agent_config_version_kind": "build_draft",
            "agent_soul_prompt": "Keep this snippet:\n```python\nprint('hi')\n```",
        }
    )

    request = AgentBackendRunRequestBuilder().build_for_agent_app(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    prompt_config = PromptConfig.model_validate(layers[AGENT_SOUL_PROMPT_LAYER_ID].config)
    assert "````text" in prompt_config.prefix
    assert "```python" in prompt_config.prefix


def test_request_builder_sets_model_and_output_layer_contract_ids() -> None:
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())
    layers = {layer.name: layer for layer in request.composition.layers}

    execution_context_config = DifyExecutionContextLayerConfig.model_validate(
        layers[DIFY_EXECUTION_CONTEXT_LAYER_ID].config
    )
    assert execution_context_config.user_id == "user-1"
    assert execution_context_config.user_from == "account"
    assert execution_context_config.agent_mode == "workflow_run"
    assert execution_context_config.invoke_from == "debugger"
    model_config = DifyPluginLLMLayerConfig.model_validate(layers[DIFY_AGENT_MODEL_LAYER_ID].config)
    assert model_config.plugin_id == "langgenius/openai"
    assert "credentials" not in model_config.model_dump(mode="json")
    assert layers[DIFY_AGENT_MODEL_LAYER_ID].config["execution_context"] == DIFY_EXECUTION_CONTEXT_LAYER_ID


@pytest.mark.parametrize("mode", ["agent_app", "workflow_node"])
@pytest.mark.parametrize("traced", [False, True])
def test_context_wire_contract_omits_tracing_for_legacy_runtime(mode: str, traced: bool) -> None:
    run_input = _agent_app_input() if mode == "agent_app" else _run_input()
    tracing = ApplicationTracingContext(
        run_id="00000000-0000-0000-0000-000000000001",
        invocation_id="00000000-0000-0000-0000-000000000002",
        trace_id="a" * 32,
        parent_span_id="b" * 16,
        session_id="session",
        capture_content=False,
    )
    if traced:
        run_input = run_input.model_copy(
            update={"execution_context": run_input.execution_context.model_copy(update={"tracing": tracing})}
        )
    builder = AgentBackendRunRequestBuilder()
    request = (
        builder.build_for_agent_app(run_input)
        if isinstance(run_input, AgentBackendAgentAppRunInput)
        else builder.build_for_workflow_node(run_input)
    )
    payload = next(
        layer.config for layer in request.composition.layers if layer.name == DIFY_EXECUTION_CONTEXT_LAYER_ID
    )
    if traced:
        assert payload["tracing"] == tracing.model_dump(mode="json")
    else:
        # Pre-tracing runtimes reject even a null unknown field (extra=forbid).
        assert "tracing" not in payload


def test_request_builder_adds_dify_plugin_tools_layer_when_configured() -> None:
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
                plugin_unique_identifier="langgenius/time:1.0.0@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
        ]
    )

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID].config["execution_context"] == DIFY_EXECUTION_CONTEXT_LAYER_ID
    tools_config = DifyPluginToolsLayerConfig.model_validate(layers[DIFY_PLUGIN_TOOLS_LAYER_ID].config)
    assert tools_config.tools[0].tool_name == "current_time"


def test_request_builder_adds_dify_core_tools_layer_when_configured() -> None:
    run_input = _run_input()
    run_input.core_tools = DifyCoreToolsLayerConfig(
        tools=[
            DifyCoreToolConfig(
                provider_type="builtin",
                provider_id="audio",
                tool_name="transcribe",
                name="transcribe",
                description="Transcribe audio.",
                runtime_parameters={"language": "en"},
                parameters=[],
                parameters_json_schema={"type": "object", "properties": {}, "required": []},
            )
        ]
    )

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    assert layers[DIFY_CORE_TOOLS_LAYER_ID].config["execution_context"] == DIFY_EXECUTION_CONTEXT_LAYER_ID


def test_request_builder_adds_knowledge_layer_when_configured() -> None:
    run_input = _run_input()
    run_input.knowledge = DifyKnowledgeBaseLayerConfig.model_validate(
        {
            "sets": [
                {
                    "id": "support",
                    "name": "Support KB",
                    "datasets": [{"id": "dataset-1"}],
                    "query": {"mode": "generated_query"},
                    "retrieval": {"mode": "multiple", "top_k": 4},
                }
            ],
        }
    )

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    assert DIFY_KNOWLEDGE_BASE_LAYER_ID in layers
    assert layers[DIFY_KNOWLEDGE_BASE_LAYER_ID].config["execution_context"] == DIFY_EXECUTION_CONTEXT_LAYER_ID
    knowledge_config = DifyKnowledgeBaseLayerConfig.model_validate(layers[DIFY_KNOWLEDGE_BASE_LAYER_ID].config)
    assert knowledge_config.sets[0].dataset_ids == ["dataset-1"]


def test_request_builder_rejects_blank_prompts() -> None:
    with pytest.raises(ValidationError, match="prompt must not be blank"):
        AgentBackendWorkflowNodeRunInput(
            model=AgentBackendModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            execution_context=DifyExecutionContextLayerConfig(
                tenant_id="tenant-1",
                user_from="account",
                agent_mode="workflow_run",
                invoke_from="debugger",
            ),
            backend_binding_ref="binding-ref-1",
            workflow_node_job_prompt=" ",
            user_prompt="hello",
        )


def test_agent_backend_request_does_not_contain_llm_credentials() -> None:
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())

    redacted = cast(dict[str, Any], redact_for_agent_backend_log(request))

    assert "credentials" not in redacted["composition"]["layers"][5]["config"]


def _agent_app_input(*, include_shell: bool = False) -> AgentBackendAgentAppRunInput:
    return AgentBackendAgentAppRunInput(
        model=AgentBackendModelConfig(
            plugin_id="langgenius/openai",
            model_provider="openai",
            model="gpt-test",
        ),
        execution_context=DifyExecutionContextLayerConfig(
            tenant_id="tenant-1",
            user_id="user-1",
            user_from="end-user",
            conversation_id="conv-1",
            agent_mode="agent_app",
            invoke_from="web-app",
        ),
        backend_binding_ref="binding-ref-1",
        agent_soul_prompt="You are Iris.",
        user_prompt="List files.",
        include_shell=include_shell,
        metadata={"conversation_id": "conv-1"},
    )


def test_workflow_request_builder_omits_shell_layer_by_default() -> None:
    request = AgentBackendRunRequestBuilder().build_for_workflow_node(_run_input())
    assert DIFY_SHELL_LAYER_ID not in {layer.name for layer in request.composition.layers}


def test_workflow_request_builder_adds_shell_layer_when_include_shell() -> None:
    run_input = _run_input()
    run_input.include_shell = True
    run_input.shell_config = DifyShellLayerConfig(env=[DifyShellEnvVarConfig(name="PROJECT_NAME", value="demo")])

    request = AgentBackendRunRequestBuilder().build_for_workflow_node(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    assert DIFY_SHELL_LAYER_ID in layers
    shell = layers[DIFY_SHELL_LAYER_ID]
    # The shell layer depends on execution_context so the agent server can mint
    # per-command Agent Stub env for sandbox CLI forwarding.
    assert shell.config["execution_context"] == DIFY_EXECUTION_CONTEXT_LAYER_ID
    assert shell.config["runtime"] == "runtime"
    shell_config = DifyShellLayerConfig.model_validate(shell.config)
    assert shell_config.env[0].name == "PROJECT_NAME"


def test_agent_app_request_builder_omits_shell_layer_by_default() -> None:
    request = AgentBackendRunRequestBuilder().build_for_agent_app(_agent_app_input())
    assert DIFY_SHELL_LAYER_ID not in {layer.name for layer in request.composition.layers}


def test_agent_app_request_builder_emits_multimodal_user_prompt_layer() -> None:
    run_input = _agent_app_input()
    run_input.user_files = [
        DifyUserPromptDownloadConfig(
            type="document", transfer_method="remote_url", url="https://example.com/brief.pdf"
        ),
        DifyUserPromptImageConfig(
            filename="earth.png",
            mime_type="image/png",
            format="png",
            url="https://files.example.com/earth.png?sign=secret",
            detail="high",
        ),
    ]

    request = AgentBackendRunRequestBuilder().build_for_agent_app(run_input)
    layer = next(layer for layer in request.composition.layers if layer.name == "agent_app_user_prompt")

    assert layer.config["text"] == "List files."
    assert layer.config["files"] == [f.model_dump(mode="json") for f in run_input.user_files]
    restored_request = CreateRunRequest.model_validate_json(request.model_dump_json())
    restored_layer = next(
        layer for layer in restored_request.composition.layers if layer.name == "agent_app_user_prompt"
    )
    assert restored_layer.config == layer.config
    assert "locators" not in restored_layer.config


def test_agent_backend_log_redacts_multimodal_file_transport() -> None:
    run_input = _agent_app_input()
    run_input.metadata = {"source_url": "https://example.com/docs"}
    run_input.user_files = [
        DifyUserPromptImageConfig(
            filename="earth.png",
            mime_type="image/png",
            format="png",
            url="https://files.example.com/earth.png?sign=secret",
        ),
        DifyUserPromptImageConfig(
            filename="inline.png",
            mime_type="image/png",
            format="png",
            base64_data="aW1hZ2UtYnl0ZXM=",
        ),
    ]

    redacted = cast(
        dict[str, Any],
        redact_for_agent_backend_log(AgentBackendRunRequestBuilder().build_for_agent_app(run_input)),
    )
    layer = next(item for item in redacted["composition"]["layers"] if item["name"] == "agent_app_user_prompt")

    assert layer["config"]["files"][0]["url"] == "[REDACTED]"
    assert layer["config"]["files"][1]["base64_data"] == "[REDACTED]"
    assert redacted["metadata"]["source_url"] == "https://example.com/docs"


def test_agent_app_request_builder_keeps_build_draft_prompt_when_agent_soul_prompt_is_blank() -> None:
    run_input = _agent_app_input().model_copy(
        update={"agent_soul_prompt": "   ", "agent_config_version_kind": "build_draft"}
    )

    request = AgentBackendRunRequestBuilder().build_for_agent_app(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    prompt_config = PromptConfig.model_validate(layers[AGENT_SOUL_PROMPT_LAYER_ID].config)
    assert "You are running in build mode." in prompt_config.prefix
    assert "No task prompt was provided." in prompt_config.prefix


def test_agent_app_request_builder_adds_shell_layer_when_include_shell() -> None:
    run_input = _agent_app_input(include_shell=True)
    run_input.shell_config = DifyShellLayerConfig(env=[DifyShellEnvVarConfig(name="APP_ENV", value="enabled")])

    request = AgentBackendRunRequestBuilder().build_for_agent_app(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    assert DIFY_SHELL_LAYER_ID in layers
    assert layers[DIFY_SHELL_LAYER_ID].config["execution_context"] == DIFY_EXECUTION_CONTEXT_LAYER_ID
    assert layers[DIFY_SHELL_LAYER_ID].config["runtime"] == "runtime"
    shell_config = DifyShellLayerConfig.model_validate(layers[DIFY_SHELL_LAYER_ID].config)
    assert shell_config.env[0].name == "APP_ENV"


def test_agent_app_request_builder_adds_knowledge_layer_when_configured() -> None:
    run_input = _agent_app_input()
    run_input.knowledge = DifyKnowledgeBaseLayerConfig.model_validate(
        {
            "sets": [
                {
                    "id": "support",
                    "name": "Support KB",
                    "datasets": [{"id": "dataset-1"}, {"id": "dataset-2"}],
                    "query": {"mode": "generated_query"},
                    "retrieval": {"mode": "multiple", "top_k": 2},
                }
            ],
        }
    )

    request = AgentBackendRunRequestBuilder().build_for_agent_app(run_input)
    layers = {layer.name: layer for layer in request.composition.layers}

    assert DIFY_KNOWLEDGE_BASE_LAYER_ID in layers
    assert layers[DIFY_KNOWLEDGE_BASE_LAYER_ID].config["execution_context"] == DIFY_EXECUTION_CONTEXT_LAYER_ID
    knowledge_config = DifyKnowledgeBaseLayerConfig.model_validate(layers[DIFY_KNOWLEDGE_BASE_LAYER_ID].config)
    assert knowledge_config.sets[0].dataset_ids == ["dataset-1", "dataset-2"]


@pytest.mark.parametrize("mode", ["agent_app", "workflow"])
def test_knowledge_fs_requires_shell_and_can_coexist_with_classic_knowledge(mode: str) -> None:
    config = DifyKnowledgeFsLayerConfig.model_validate(
        {"spaces": [{"id": "docs", "name": "Docs", "control_space_id": "00000000-0000-4000-8000-000000000001"}]}
    )
    run_input = _agent_app_input() if mode == "agent_app" else _run_input()
    run_input.knowledge_fs = config
    builder = AgentBackendRunRequestBuilder()

    def build() -> CreateRunRequest:
        if isinstance(run_input, AgentBackendAgentAppRunInput):
            return builder.build_for_agent_app(run_input)
        return builder.build_for_workflow_node(run_input)

    with pytest.raises(ValueError, match="requires shell"):
        build()
    run_input.include_shell = True
    layers = {layer.name: layer for layer in build().composition.layers}
    knowledge_fs = DifyKnowledgeFsLayerConfig.model_validate(layers["knowledge_fs"].config)
    assert knowledge_fs == config
    assert knowledge_fs.execution_context == DIFY_EXECUTION_CONTEXT_LAYER_ID
    assert knowledge_fs.shell == DIFY_SHELL_LAYER_ID
    assert DIFY_KNOWLEDGE_BASE_LAYER_ID not in layers
    assert not any("search" in layer.name or "retriev" in layer.name for layer in layers.values())
    run_input.knowledge = DifyKnowledgeBaseLayerConfig.model_validate(
        {
            "sets": [
                {
                    "id": "legacy",
                    "name": "Legacy",
                    "datasets": [{"id": "dataset-1"}],
                    "query": {"mode": "generated_query"},
                    "retrieval": {"mode": "multiple", "top_k": 2},
                }
            ]
        }
    )
    mixed_layers = {layer.name: layer for layer in build().composition.layers}
    assert DIFY_KNOWLEDGE_BASE_LAYER_ID in mixed_layers
    assert "knowledge_fs" in mixed_layers
    assert mixed_layers[DIFY_KNOWLEDGE_BASE_LAYER_ID].config["sets"][0]["id"] == "legacy"
    assert mixed_layers["knowledge_fs"].config["spaces"][0]["id"] == "docs"
    run_input.execution_context.app_id = "app-1"
    client = cast(httpx.AsyncClient, Mock(spec=httpx.AsyncClient))
    services = Services(
        plugin_daemon_http_client=client,
        dify_api_http_client=client,
        runtime_backend_profile=cast(Any, object()),
        knowledge_session_store=cast(Any, object()),
    )
    modules = create_modules(load_modules(build(), services, "mixed-knowledge-run"))
    assert DIFY_KNOWLEDGE_BASE_LAYER_ID in modules
    assert "knowledge_fs" in modules

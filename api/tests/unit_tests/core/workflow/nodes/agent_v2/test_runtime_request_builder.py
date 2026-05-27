from dataclasses import replace
from typing import cast

import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.dify_plugin import DifyPluginToolConfig, DifyPluginToolsLayerConfig
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID, DIFY_AGENT_MODEL_LAYER_ID

from clients.agent_backend import DIFY_EXECUTION_CONTEXT_LAYER_ID, DIFY_PLUGIN_TOOLS_LAYER_ID
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.workflow.nodes.agent_v2.plugin_tools_builder import WorkflowAgentPluginToolsBuilder
from core.workflow.nodes.agent_v2.runtime_request_builder import (
    WorkflowAgentRuntimeBuildContext,
    WorkflowAgentRuntimeRequestBuilder,
    WorkflowAgentRuntimeRequestBuildError,
)
from graphon.variables.segments import StringSegment
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import (
    AgentSoulConfig,
    AgentSoulModelConfig,
    DeclaredOutputType,
    WorkflowNodeJobConfig,
)


class FakeCredentialsProvider:
    def fetch(self, provider_name: str, model_name: str) -> dict[str, object]:
        assert provider_name == "openai"
        assert model_name == "gpt-test"
        return {"api_key": "secret-key"}


class CapturingCredentialsProvider:
    def __init__(self) -> None:
        self.provider_name: str | None = None
        self.model_name: str | None = None

    def fetch(self, provider_name: str, model_name: str) -> dict[str, object]:
        self.provider_name = provider_name
        self.model_name = model_name
        return {"api_key": "secret-key"}


class FakePluginToolsBuilder:
    def __init__(self) -> None:
        # Capture the runtime invocation source so tests can assert it was
        # threaded through from ``DifyRunContext.invoke_from`` rather than
        # hard-coded to a placeholder like ``VALIDATION``.
        self.last_invoke_from: InvokeFrom | None = None

    def build(self, *, tenant_id, app_id, user_id, tools, invoke_from):
        assert tenant_id == "tenant-1"
        assert app_id == "app-1"
        assert user_id == "user-1"
        self.last_invoke_from = invoke_from
        if not tools.dify_tools:
            return None
        return DifyPluginToolsLayerConfig(
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


class FakeVariablePool:
    def get(self, selector):
        if list(selector) == ["sys", "query"]:
            return StringSegment(value="Summarize the report.")
        if list(selector) == ["previous-node", "text"]:
            return StringSegment(value="Previous result")
        return None

    def get_by_prefix(self, prefix):
        return {}


def _context() -> WorkflowAgentRuntimeBuildContext:
    agent = Agent(id="agent-1", tenant_id="tenant-1", name="Agent")
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            prompt={"system_prompt": "You are careful."},
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
                model_settings={"temperature": 0},
            ),
        ),
    )
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "workflow_prompt": "Use the previous output.",
                "previous_node_output_refs": [{"node_id": "previous-node", "output": "text"}],
                "declared_outputs": [{"name": "summary", "type": "string"}],
            }
        ),
    )
    return WorkflowAgentRuntimeBuildContext(
        dify_context=DifyRunContext(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        node_id="agent-node",
        node_execution_id="node-exec-1",
        variable_pool=FakeVariablePool(),
        binding=binding,
        agent=agent,
        snapshot=snapshot,
    )


def test_builds_create_run_request_from_agent_soul_and_node_job():
    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(_context())

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_id"] == "agent-1"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_config_version_id"] == "snapshot-1"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["invoke_from"] == "single_step"
    assert dumped["idempotency_key"] == "run-1:node-exec-1"
    assert dumped["composition"]["layers"][0]["config"]["prefix"] == "You are careful."
    assert dumped["composition"]["layers"][1]["config"]["prefix"] == "Use the previous output."
    assert "Previous result" in dumped["composition"]["layers"][2]["config"]["user"]
    assert dumped["composition"]["layers"][-1]["config"]["json_schema"]["properties"]["summary"]["type"] == "string"
    assert DIFY_AGENT_HISTORY_LAYER_ID in layers
    assert result.redacted_request["composition"]["layers"][5]["config"]["credentials"] == "[REDACTED]"


def test_normalizes_langgenius_model_provider_for_agent_backend_transport():
    context = _context()
    context.snapshot.config_snapshot = AgentSoulConfig(
        prompt={"system_prompt": "You are careful."},
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai/openai",
            model_provider="langgenius/openai/openai",
            model="gpt-test",
        ),
    )
    credentials_provider = CapturingCredentialsProvider()

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=credentials_provider).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    model_config = layers[DIFY_AGENT_MODEL_LAYER_ID]["config"]
    assert credentials_provider.provider_name == "langgenius/openai/openai"
    assert credentials_provider.model_name == "gpt-test"
    assert model_config["plugin_id"] == "langgenius/openai"
    assert model_config["model_provider"] == "openai"


def test_builds_workflow_run_request_with_file_output_schema_and_reserved_metadata():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            prompt={"system_prompt": "You are careful."},
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
                model_settings={"temperature": 0.2},
            ),
            tools={"cli_tools": [{"name": "pytest"}]},
        ),
    )
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "declared_outputs": [
                    {"name": "report", "type": DeclaredOutputType.FILE},
                    {"name": "confidence", "type": DeclaredOutputType.NUMBER, "required": False},
                ],
            }
        ),
    )
    dify_context = context.dify_context.model_copy(update={"invoke_from": InvokeFrom.SERVICE_API})
    context = replace(context, dify_context=dify_context, workflow_run_id=None, snapshot=snapshot, binding=binding)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["invoke_from"] == "workflow_run"
    assert dumped["idempotency_key"] == "node-exec-1"
    output_schema = dumped["composition"]["layers"][-1]["config"]["json_schema"]
    assert output_schema["properties"]["report"]["properties"]["file_id"]["type"] == "string"
    assert output_schema["properties"]["confidence"]["type"] == "number"
    assert output_schema["required"] == ["report"]
    assert dumped["composition"]["layers"][5]["config"]["model_settings"] == {"temperature": 0.2}
    assert result.metadata["runtime_support"]["reserved_status"]["tools.dify_tools"] == "supported_when_config_valid"
    assert result.metadata["runtime_support"]["reserved_status"]["tools.cli_tools"] == "reserved_not_executed"
    warnings = result.metadata["runtime_support"]["unsupported_runtime_warnings"]
    assert warnings[0]["section"] == "agent_soul.tools.cli_tools"


def test_builds_workflow_run_request_with_dify_plugin_tools_layer():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(
            prompt={"system_prompt": "You are careful."},
            model=AgentSoulModelConfig(
                plugin_id="langgenius/openai",
                model_provider="openai",
                model="gpt-test",
            ),
            tools={
                "dify_tools": [
                    {
                        "provider_id": "langgenius/time/time",
                        "tool_name": "current_time",
                        "credential_type": "unauthorized",
                    }
                ]
            },
        ),
    )
    context = replace(context, snapshot=snapshot)

    plugin_tools_builder = FakePluginToolsBuilder()
    result = WorkflowAgentRuntimeRequestBuilder(
        credentials_provider=FakeCredentialsProvider(),
        plugin_tools_builder=cast(WorkflowAgentPluginToolsBuilder, plugin_tools_builder),
    ).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID]["type"] == "dify.plugin.tools"
    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID]["deps"] == {"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID}
    assert layers[DIFY_PLUGIN_TOOLS_LAYER_ID]["config"]["tools"][0]["tool_name"] == "current_time"
    assert result.metadata["agent_tools"] == {
        "dify_tool_count": 1,
        "dify_tool_names": ["current_time"],
        "cli_tool_count": 0,
    }
    # The runtime invocation source must flow from ``DifyRunContext.invoke_from``
    # into the plugin tools builder so ToolManager attributes credential
    # quotas / rate limits / audit tags to the real call site instead of a
    # hard-coded ``VALIDATION`` placeholder.
    assert plugin_tools_builder.last_invoke_from == context.dify_context.invoke_from


def test_build_passes_saved_session_snapshot_to_agent_backend_request():
    session_snapshot = CompositorSessionSnapshot(layers=[])
    context = replace(_context(), session_snapshot=session_snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert result.request.session_snapshot is session_snapshot


def test_requires_agent_soul_model_config():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig(),
    )
    context = replace(context, snapshot=snapshot)

    with pytest.raises(WorkflowAgentRuntimeRequestBuildError, match="Agent Soul model"):
        WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)


def test_missing_previous_node_output_fails_request_build():
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "previous_node_output_refs": [{"node_id": "missing-node", "output": "text"}],
            }
        ),
    )
    context = replace(context, binding=binding)

    with pytest.raises(WorkflowAgentRuntimeRequestBuildError) as exc_info:
        WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert exc_info.value.error_code == "missing_previous_node_output"


def test_invalid_previous_node_output_ref_fails_request_build():
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "previous_node_output_refs": [{"selector": ["previous-node", 1]}],
            }
        ),
    )
    context = replace(context, binding=binding)

    with pytest.raises(WorkflowAgentRuntimeRequestBuildError) as exc_info:
        WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    assert exc_info.value.error_code == "invalid_previous_node_output_ref"


def test_empty_declared_outputs_injects_prd_defaults_text_files_json():
    """Stage 4 §4.1 (D-3): empty declared_outputs → backend receives the PRD defaults
    (text / files / json) as a stable structured-output contract."""
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate({}),
    )
    context = replace(context, binding=binding)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    output_layer = dumped["composition"]["layers"][-1]["config"]
    properties = output_layer["json_schema"]["properties"]
    assert set(properties) == {"text", "files", "json"}
    assert properties["text"]["type"] == "string"
    assert properties["files"]["type"] == "array"
    # `files` defaults to array<file> → items is a file ref object.
    assert properties["files"]["items"]["properties"]["file_id"]["type"] == "string"
    assert properties["json"]["type"] == "object"
    # Defaults are all required=False so no `required:` key on the schema.
    assert "required" not in output_layer["json_schema"]


def test_array_output_emits_typed_items_per_array_item():
    context = _context()
    binding = WorkflowAgentNodeBinding(
        id="binding-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        node_id="agent-node",
        agent_id="agent-1",
        current_snapshot_id="snapshot-1",
        node_job_config=WorkflowNodeJobConfig.model_validate(
            {
                "declared_outputs": [
                    {
                        "name": "tags",
                        "type": "array",
                        "array_item": {"type": "string", "description": "topic tag"},
                        "required": True,
                    }
                ],
            }
        ),
    )
    context = replace(context, binding=binding)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    output_schema = result.request.model_dump(mode="json")["composition"]["layers"][-1]["config"]["json_schema"]
    tags_schema = output_schema["properties"]["tags"]
    assert tags_schema["type"] == "array"
    assert tags_schema["items"]["type"] == "string"
    assert tags_schema["items"]["description"] == "topic tag"
    assert output_schema["required"] == ["tags"]


def test_effective_declared_outputs_passthrough_when_user_declared():
    """effective_declared_outputs() must return user-provided outputs verbatim
    when non-empty; only empty input gets PRD defaults injected."""
    from models.agent_config_entities import DeclaredOutputConfig

    declared = [DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING)]
    effective = WorkflowAgentRuntimeRequestBuilder.effective_declared_outputs(declared)
    assert list(effective) == declared

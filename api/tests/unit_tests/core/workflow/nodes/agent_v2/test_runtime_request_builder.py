from dataclasses import replace

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
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
    assert dumped["execution_context"]["agent_id"] == "agent-1"
    assert dumped["execution_context"]["agent_config_version_id"] == "snapshot-1"
    assert dumped["execution_context"]["invoke_from"] == "single_step"
    assert dumped["idempotency_key"] == "run-1:node-exec-1"
    assert dumped["composition"]["layers"][0]["config"]["prefix"] == "You are careful."
    assert dumped["composition"]["layers"][1]["config"]["prefix"] == "Use the previous output."
    assert "Previous result" in dumped["composition"]["layers"][2]["config"]["user"]
    assert dumped["composition"]["layers"][-1]["config"]["json_schema"]["properties"]["summary"]["type"] == "string"
    assert result.redacted_request["composition"]["layers"][4]["config"]["credentials"] == "[REDACTED]"


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
    assert dumped["execution_context"]["invoke_from"] == "workflow_run"
    assert dumped["idempotency_key"] == "node-exec-1"
    output_schema = dumped["composition"]["layers"][-1]["config"]["json_schema"]
    assert output_schema["properties"]["report"]["properties"]["file_id"]["type"] == "string"
    assert output_schema["properties"]["confidence"]["type"] == "number"
    assert output_schema["required"] == ["report"]
    assert dumped["composition"]["layers"][4]["config"]["model_settings"] == {"temperature": 0.2}
    assert result.metadata["runtime_support"]["reserved_status"]["tools"] == "reserved_not_executed"
    assert result.metadata["runtime_support"]["unsupported_runtime_warnings"][0]["section"] == "agent_soul.tools"


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

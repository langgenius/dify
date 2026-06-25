from dataclasses import replace
from typing import cast

import pytest
from agenton.compositor import CompositorSessionSnapshot
from dify_agent.layers.dify_plugin import DifyPluginToolConfig, DifyPluginToolsLayerConfig
from dify_agent.protocol import DIFY_AGENT_HISTORY_LAYER_ID, DIFY_AGENT_MODEL_LAYER_ID

from clients.agent_backend import DIFY_EXECUTION_CONTEXT_LAYER_ID, DIFY_PLUGIN_TOOLS_LAYER_ID
from clients.agent_backend.request_builder import DIFY_SHELL_LAYER_ID
from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.workflow.nodes.agent_v2.plugin_tools_builder import WorkflowAgentPluginToolsBuilder
from core.workflow.nodes.agent_v2.runtime_request_builder import (
    WorkflowAgentRuntimeBuildContext,
    WorkflowAgentRuntimeRequestBuilder,
    WorkflowAgentRuntimeRequestBuildError,
    build_shell_layer_config,
)
from graphon.variables.segments import StringSegment
from models.agent import Agent, AgentConfigSnapshot, WorkflowAgentNodeBinding
from models.agent_config_entities import (
    AgentSoulConfig,
    AgentSoulModelConfig,
    DeclaredArrayItem,
    DeclaredOutputChildConfig,
    DeclaredOutputConfig,
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


def test_agent_soul_round_trip_preserves_existing_app_feature_fields():
    config = AgentSoulConfig.model_validate(
        {
            "app_features": {
                "file_upload": {
                    "enabled": True,
                    "allowed_file_upload_methods": ["local_file"],
                },
                "annotation_reply": {"enabled": True},
                "more_like_this": {"enabled": False},
            }
        }
    )

    dumped = config.model_dump(mode="json")

    assert dumped["app_features"]["file_upload"]["enabled"] is True
    assert dumped["app_features"]["file_upload"]["allowed_file_upload_methods"] == ["local_file"]
    assert dumped["app_features"]["annotation_reply"] == {"enabled": True}
    assert dumped["app_features"]["more_like_this"] == {"enabled": False}


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
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["user_from"] == "account"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_mode"] == "single_step"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["invoke_from"] == "debugger"
    assert dumped["idempotency_key"] == "run-1:node-exec-1"
    assert dumped["composition"]["layers"][0]["config"]["prefix"] == "You are careful."
    assert dumped["composition"]["layers"][1]["config"]["prefix"] == "Use the previous output."
    assert "Previous result" in dumped["composition"]["layers"][2]["config"]["user"]
    assert dumped["composition"]["layers"][-1]["config"]["json_schema"]["properties"]["summary"]["type"] == "string"
    assert DIFY_AGENT_HISTORY_LAYER_ID in layers
    redacted_layers = {layer["name"]: layer for layer in result.redacted_request["composition"]["layers"]}
    assert redacted_layers[DIFY_AGENT_MODEL_LAYER_ID]["config"]["credentials"] == "[REDACTED]"


def test_normalizes_langgenius_model_provider_for_agent_backend_transport():
    context = _context()
    context.snapshot.config_snapshot = AgentSoulConfig(
        prompt={"system_prompt": "You are careful."},
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai:0.4.2@21195ee1321849e0a7d4b3f6b2fd8c2be23ea6c7182e1b444ecc4c1711b52468",
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
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["agent_mode"] == "workflow_run"
    assert layers[DIFY_EXECUTION_CONTEXT_LAYER_ID]["config"]["invoke_from"] == "service-api"
    assert dumped["idempotency_key"] == "node-exec-1"
    output_schema = dumped["composition"]["layers"][-1]["config"]["json_schema"]
    report_schema = output_schema["properties"]["report"]
    assert len(report_schema["oneOf"]) == 4
    assert all(branch["additionalProperties"] is False for branch in report_schema["oneOf"])
    assert report_schema["oneOf"][0]["required"] == ["transfer_method", "reference"]
    assert report_schema["oneOf"][1]["required"] == ["transfer_method", "reference"]
    assert report_schema["oneOf"][2]["required"] == ["transfer_method", "reference"]
    assert report_schema["oneOf"][3]["required"] == ["transfer_method", "url"]
    assert output_schema["properties"]["confidence"]["type"] == "number"
    assert output_schema["required"] == ["report"]
    assert layers[DIFY_AGENT_MODEL_LAYER_ID]["config"]["model_settings"] == {"temperature": 0.2}
    assert result.metadata["runtime_support"]["reserved_status"]["tools.dify_tools"] == "supported_when_config_valid"
    assert result.metadata["runtime_support"]["reserved_status"]["tools.cli_tools"] == "supported_by_shell_bootstrap"
    assert result.metadata["runtime_support"]["unsupported_runtime_warnings"] == []


def test_build_maps_agent_soul_shell_settings_to_shell_layer(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_SHELL_ENABLED", True)
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
            tools={"cli_tools": [{"name": "ripgrep", "install_commands": ["apt-get install -y ripgrep"]}]},
            env={"variables": [{"name": "PROJECT_NAME", "value": "demo"}]},
            sandbox={"provider": "independent", "config": {"cpu": 2}},
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    shell_config = {layer["name"]: layer for layer in dumped["composition"]["layers"]}[DIFY_SHELL_LAYER_ID]["config"]
    assert shell_config["cli_tools"][0]["install_commands"] == ["apt-get install -y ripgrep"]
    assert shell_config["env"][0] == {"name": "PROJECT_NAME", "value": "demo"}
    assert shell_config["sandbox"] == {"provider": "independent", "config": {"cpu": 2}}
    assert result.metadata["agent_tools"] == {
        "dify_tool_count": 0,
        "dify_tool_names": [],
        "cli_tool_count": 1,
    }


def test_build_shell_layer_config_accepts_legacy_fallback_keys():
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {"label": "node", "install_command": "apt-get install -y nodejs"},
                    {"tool_name": "python", "setup_command": "pip install pytest"},
                    {"install": "apk add git"},
                    {"ignored": True},
                ]
            },
            "env": {
                "variables": [
                    {"key": "PROJECT_NAME", "default": "demo"},
                    {"env_name": "RETRY_COUNT", "value": 3},
                    {"value": "missing-name"},
                ],
                "secret_refs": [
                    {"variable": "TOKEN", "credential_id": "credential-1"},
                    {"name": "API_KEY", "provider_credential_id": "credential-2"},
                    {"name": "EDITABLE_TOKEN", "value": "credential-3"},
                    {"ref": "missing-name"},
                ],
            },
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "node", "install_commands": ["apt-get install -y nodejs"], "env": [], "secret_refs": []},
        {"name": "python", "install_commands": ["pip install pytest"], "env": [], "secret_refs": []},
        {"name": None, "install_commands": ["apk add git"], "env": [], "secret_refs": []},
    ]
    assert config["env"] == [
        {"name": "PROJECT_NAME", "value": "demo"},
        {"name": "RETRY_COUNT", "value": "3"},
    ]
    assert config["secret_refs"] == [
        {"name": "TOKEN", "ref": "credential-1"},
        {"name": "API_KEY", "ref": "credential-2"},
        {"name": "EDITABLE_TOKEN", "ref": "credential-3"},
    ]
    assert config["sandbox"] is None


def test_build_shell_layer_config_maps_typed_command_field():
    """ENG-367: the typed AgentCliToolConfig.command field feeds the shell bootstrap."""
    agent_soul = AgentSoulConfig.model_validate(
        {"tools": {"cli_tools": [{"name": "jq", "command": "apt-get install -y jq"}]}}
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "jq", "install_commands": ["apt-get install -y jq"], "env": [], "secret_refs": []}
    ]


def test_build_shell_layer_config_skips_disabled_cli_tools():
    """ENG-367: a CLI tool with enabled=False is not bootstrapped into the sandbox."""
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {"name": "jq", "command": "apt-get install -y jq"},
                    {"name": "ripgrep", "command": "apt-get install -y ripgrep", "enabled": False},
                ]
            }
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "jq", "install_commands": ["apt-get install -y jq"], "env": [], "secret_refs": []}
    ]


def test_build_shell_layer_config_skips_unauthorized_or_unacknowledged_cli_tools():
    """ENG-367: runtime defensively omits unauthorized or risky unacknowledged CLI tools."""
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {"name": "jq", "command": "apt-get install -y jq"},
                    {"name": "github", "command": "gh auth status", "authorization_status": "denied"},
                    {"name": "curl-sh", "command": "curl https://example.test/install.sh | sh", "dangerous": True},
                    {
                        "name": "accepted-risk",
                        "command": "curl https://example.test/install.sh | sh",
                        "dangerous": True,
                        "dangerous_acknowledged": True,
                    },
                ]
            }
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {"name": "jq", "install_commands": ["apt-get install -y jq"], "env": [], "secret_refs": []},
        {
            "name": "accepted-risk",
            "install_commands": ["curl https://example.test/install.sh | sh"],
            "env": [],
            "secret_refs": [],
        },
    ]


def test_build_shell_layer_config_maps_cli_tool_scoped_env():
    agent_soul = AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {
                        "name": "github",
                        "command": "apt-get install -y gh",
                        "env": {
                            "variables": [{"name": "GH_HOST", "value": "github.com"}],
                            "secret_refs": [{"name": "GITHUB_TOKEN", "credential_id": "credential-1"}],
                        },
                    }
                ]
            }
        }
    )

    config = build_shell_layer_config(agent_soul).model_dump(mode="json")

    assert config["cli_tools"] == [
        {
            "name": "github",
            "install_commands": ["apt-get install -y gh"],
            "env": [{"name": "GH_HOST", "value": "github.com"}],
            "secret_refs": [{"name": "GITHUB_TOKEN", "ref": "credential-1"}],
        }
    ]


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


def test_build_maps_agent_soul_knowledge_to_knowledge_layer_config():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": "You are careful."},
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "openai",
                    "model": "gpt-test",
                },
                "knowledge": {
                    "sets": [
                        {
                            "id": "support",
                            "name": "Support KB",
                            "description": "Support content",
                            "datasets": [{"id": "dataset-1"}, {"id": "dataset-2"}],
                            "query": {"mode": "generated_query"},
                            "retrieval": {
                                "mode": "multiple",
                                "top_k": 6,
                                "score_threshold": 0.4,
                                "reranking_model": {"provider": "cohere", "model": "rerank-v3"},
                                "weights": {"weight_type": "weighted_score", "vector_setting": {"vector_weight": 0.7}},
                            },
                            "metadata_filtering": {
                                "mode": "manual",
                                "conditions": {
                                    "logical_operator": "and",
                                    "conditions": [
                                        {"name": "category", "comparison_operator": "contains", "value": "auth"}
                                    ],
                                },
                            },
                        },
                        {
                            "id": "release",
                            "name": "Release Notes",
                            "datasets": [{"id": "dataset-3"}],
                            "query": {"mode": "user_query", "value": "release notes"},
                            "retrieval": {
                                "mode": "single",
                                "model": {
                                    "provider": "openai",
                                    "name": "gpt-4o-mini",
                                    "mode": "chat",
                                    "completion_params": {"temperature": 0.2},
                                },
                            },
                            "metadata_filtering": {
                                "mode": "automatic",
                                "model_config": {
                                    "provider": "openai",
                                    "name": "gpt-4o-mini",
                                    "mode": "chat",
                                    "completion_params": {},
                                },
                            },
                        },
                    ],
                },
            }
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    knowledge_layer = layers["knowledge"]
    assert knowledge_layer["type"] == "dify.knowledge_base"
    assert knowledge_layer["deps"] == {"execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID}
    assert knowledge_layer["config"]["sets"] == [
        {
            "id": "support",
            "name": "Support KB",
            "description": "Support content",
            "datasets": [
                {"id": "dataset-1", "name": None, "description": None},
                {"id": "dataset-2", "name": None, "description": None},
            ],
            "query": {"mode": "generated_query", "value": None},
            "retrieval": {
                "mode": "multiple",
                "top_k": 6,
                "score_threshold": 0.4,
                "reranking_mode": "reranking_model",
                "reranking_enable": True,
                "reranking_model": {"provider": "cohere", "model": "rerank-v3"},
                "weights": {"weight_type": "weighted_score", "vector_setting": {"vector_weight": 0.7}},
                "model": None,
            },
            "metadata_filtering": {
                "mode": "manual",
                "metadata_model_config": None,
                "conditions": {
                    "logical_operator": "and",
                    "conditions": [{"name": "category", "comparison_operator": "contains", "value": "auth"}],
                },
            },
        },
        {
            "id": "release",
            "name": "Release Notes",
            "description": None,
            "datasets": [{"id": "dataset-3", "name": None, "description": None}],
            "query": {"mode": "user_query", "value": "release notes"},
            "retrieval": {
                "mode": "single",
                "top_k": None,
                "score_threshold": 0.0,
                "reranking_mode": "reranking_model",
                "reranking_enable": True,
                "reranking_model": None,
                "weights": None,
                "model": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "mode": "chat",
                    "completion_params": {"temperature": 0.2},
                },
            },
            "metadata_filtering": {
                "mode": "automatic",
                "metadata_model_config": {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "mode": "chat",
                    "completion_params": {},
                },
                "conditions": None,
            },
        },
    ]
    assert knowledge_layer["config"]["max_result_content_chars"] == 2000
    assert knowledge_layer["config"]["max_observation_chars"] == 12000


def test_build_knowledge_layer_maps_disabled_score_threshold_to_zero():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": "You are careful."},
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "openai",
                    "model": "gpt-test",
                },
                "knowledge": {
                    "sets": [
                        {
                            "id": "support",
                            "name": "Support KB",
                            "datasets": [{"id": "dataset-1"}],
                            "query": {"mode": "generated_query"},
                            "retrieval": {
                                "mode": "multiple",
                                "top_k": 4,
                                "score_threshold": None,
                            },
                        }
                    ],
                },
            }
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    knowledge_layer = next(layer for layer in dumped["composition"]["layers"] if layer["name"] == "knowledge")
    assert knowledge_layer["config"]["sets"][0]["retrieval"]["score_threshold"] == 0.0


def test_build_skips_knowledge_layer_when_agent_soul_has_no_sets():
    context = _context()
    snapshot = AgentConfigSnapshot(
        id="snapshot-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        version=1,
        config_snapshot=AgentSoulConfig.model_validate(
            {
                "prompt": {"system_prompt": "You are careful."},
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "openai",
                    "model": "gpt-test",
                },
                "knowledge": {"sets": []},
            }
        ),
    )
    context = replace(context, snapshot=snapshot)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    assert all(layer["name"] != "knowledge" for layer in dumped["composition"]["layers"])


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
    assert len(properties["files"]["items"]["oneOf"]) == 4
    assert all(branch["additionalProperties"] is False for branch in properties["files"]["items"]["oneOf"])
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


def test_nested_declared_output_emits_object_and_array_child_schema():
    profile_output = DeclaredOutputConfig(
        name="profile",
        type=DeclaredOutputType.OBJECT,
        children=[
            DeclaredOutputChildConfig(name="email", type=DeclaredOutputType.STRING),
            DeclaredOutputChildConfig(
                name="nickname",
                type=DeclaredOutputType.STRING,
                required=False,
                description="Optional display name",
            ),
            DeclaredOutputChildConfig(
                name="addresses",
                type=DeclaredOutputType.ARRAY,
                array_item=DeclaredArrayItem(
                    type=DeclaredOutputType.OBJECT,
                    description="Address item",
                    children=[DeclaredOutputChildConfig(name="city", type=DeclaredOutputType.STRING)],
                ),
            ),
        ],
    )

    schema = WorkflowAgentRuntimeRequestBuilder._schema_for_declared_output(profile_output)

    assert schema["properties"]["email"] == {"type": "string"}
    assert schema["properties"]["nickname"] == {"type": "string", "description": "Optional display name"}
    assert schema["properties"]["addresses"]["items"]["properties"]["city"] == {"type": "string"}
    assert schema["properties"]["addresses"]["items"]["description"] == "Address item"
    assert schema["properties"]["addresses"]["items"]["required"] == ["city"]
    assert schema["required"] == ["email", "addresses"]


def test_effective_declared_outputs_passthrough_when_user_declared():
    """effective_declared_outputs() must return user-provided outputs verbatim
    when non-empty; only empty input gets PRD defaults injected."""
    from models.agent_config_entities import DeclaredOutputConfig

    declared = [DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING)]
    effective = WorkflowAgentRuntimeRequestBuilder.effective_declared_outputs(declared)
    assert list(effective) == declared


def test_mentions_expand_in_soul_and_job_prompts_without_token_leak():
    """ENG-616: slash-menu mention tokens expand to canonical names; node_output
    mentions expand to the reference name only (the value stays in the Workflow
    context user prompt), and no ``[§…§]`` marker leaks into the request."""
    import json

    context = _context()
    context.snapshot.config_snapshot = AgentSoulConfig(
        prompt={"system_prompt": "Careful. Ask [§human:c-1:EMAIL · DAVE§] when unsure."},
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
        human={"contacts": [{"id": "c-1", "name": "David Hayes", "channel": "email"}]},
    )
    context.binding.node_job_config = WorkflowNodeJobConfig.model_validate(
        {
            "workflow_prompt": (
                "Read [§node_output:previous-node.text:PREV/text§] and produce [§output:summary§]. "
                "Unknown [§knowledge:gone:旧手册§] degrades."
            ),
            "previous_node_output_refs": [
                {"selector": ["previous-node", "text"], "name": "PREV/text"},
            ],
            "declared_outputs": [{"name": "summary", "type": "string"}],
        }
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    assert dumped["composition"]["layers"][0]["config"]["prefix"] == ("Careful. Ask EMAIL · David Hayes when unsure.")
    assert dumped["composition"]["layers"][1]["config"]["prefix"] == (
        "Read PREV/text and produce summary (string). Unknown 旧手册 degrades."
    )
    # the value still rides the Workflow context block, not the job prompt
    assert "Previous result" in dumped["composition"]["layers"][2]["config"]["user"]
    assert "[§" not in json.dumps(dumped["composition"]["layers"][:3])


# ── ENG-623: dify.drive declaration layer ─────────────────────────────────────


def _soul_with_drive_skill() -> AgentSoulConfig:
    return AgentSoulConfig(
        prompt={
            "system_prompt": (
                "You are careful. Use [§skill:tender-analyzer%2FSKILL.md:Tender Analyzer§] "
                "and [§file:files%2Fsample.pdf:sample.pdf§]."
            )
        },
        files={
            "skills": [
                {
                    "id": "tender-analyzer",
                    "name": "Tender Analyzer",
                    "description": "Parses RFPs.",
                    "path": "tender-analyzer",
                    "skill_md_key": "tender-analyzer/SKILL.md",
                    "full_archive_key": "tender-analyzer/.DIFY-SKILL-FULL.zip",
                }
            ],
            "files": [{"id": "files/sample.pdf", "name": "sample.pdf", "drive_key": "files/sample.pdf"}],
        },
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
    )


def _mock_drive_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    return None


def _mock_empty_drive_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    return None


def test_build_drive_layer_config_catalogs_drive_skills_and_mentions(monkeypatch: pytest.MonkeyPatch):
    from core.workflow.nodes.agent_v2.runtime_request_builder import build_drive_layer_config

    _mock_drive_catalog(monkeypatch)
    config, warnings = build_drive_layer_config(_soul_with_drive_skill(), tenant_id="tenant-1", agent_id="agent-1")

    assert config is not None
    assert config.drive_ref == "agent-agent-1"
    assert [skill.skill_md_key for skill in config.skills] == ["tender-analyzer/SKILL.md"]
    assert config.skills[0].archive_key == "tender-analyzer/.DIFY-SKILL-FULL.zip"
    assert config.mentioned_skill_keys == ["tender-analyzer/SKILL.md"]
    assert config.mentioned_file_keys == ["files/sample.pdf"]
    assert warnings == []


def test_build_drive_layer_config_emits_drive_ref_when_catalog_is_empty(monkeypatch: pytest.MonkeyPatch):
    from core.workflow.nodes.agent_v2.runtime_request_builder import build_drive_layer_config

    _mock_empty_drive_catalog(monkeypatch)
    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test")
    )
    config, warnings = build_drive_layer_config(soul, tenant_id="tenant-1", agent_id="agent-1")

    assert config is not None
    assert config.drive_ref == "agent-agent-1"
    assert config.skills == []
    assert config.mentioned_skill_keys == []
    assert config.mentioned_file_keys == []
    assert warnings == []


def test_workflow_run_request_contains_drive_layer_with_empty_catalog(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_DRIVE_MANIFEST_ENABLED", True
    )
    monkeypatch.setattr("core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_SHELL_ENABLED", True)
    _mock_empty_drive_catalog(monkeypatch)

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(_context())

    dumped = result.request.model_dump(mode="json")
    layers = {layer["name"]: layer for layer in dumped["composition"]["layers"]}
    assert layers["drive"]["config"] == {
        "drive_ref": "agent-agent-1",
        "skills": [],
        "mentioned_skill_keys": [],
        "mentioned_file_keys": [],
    }
    assert layers[DIFY_SHELL_LAYER_ID]["deps"] == {
        "execution_context": DIFY_EXECUTION_CONTEXT_LAYER_ID,
        "drive": "drive",
    }


def test_build_drive_layer_config_requires_agent_identity():
    from core.workflow.nodes.agent_v2.runtime_request_builder import build_drive_layer_config

    config, warnings = build_drive_layer_config(_soul_with_drive_skill(), tenant_id="tenant-1", agent_id=None)

    assert config is None
    assert [w["code"] for w in warnings] == ["drive_ref_dangling"]


def test_workflow_run_request_contains_drive_layer_when_flag_enabled(monkeypatch: pytest.MonkeyPatch):
    """Contract test: locks the dify.drive composition shape against cross-package drift."""
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_DRIVE_MANIFEST_ENABLED", True
    )
    _mock_drive_catalog(monkeypatch)
    context = _context()
    context.snapshot.config_snapshot = _soul_with_drive_skill()

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    layer_names = [layer["name"] for layer in dumped["composition"]["layers"]]
    assert "drive" in layer_names
    # injected right after execution_context, before history/llm
    assert layer_names.index("drive") == layer_names.index("execution_context") + 1
    drive = next(layer for layer in dumped["composition"]["layers"] if layer["name"] == "drive")
    assert drive["type"] == "dify.drive"
    assert drive["deps"] == {"execution_context": "execution_context"}
    assert drive["config"]["drive_ref"] == "agent-agent-1"
    assert drive["config"]["skills"] == [
        {
            "path": "tender-analyzer",
            "name": "Tender Analyzer",
            "description": "Parses RFPs.",
            "skill_md_key": "tender-analyzer/SKILL.md",
            "archive_key": "tender-analyzer/.DIFY-SKILL-FULL.zip",
        }
    ]
    assert drive["config"]["mentioned_skill_keys"] == ["tender-analyzer/SKILL.md"]
    assert drive["config"]["mentioned_file_keys"] == ["files/sample.pdf"]
    warnings = result.metadata["runtime_support"]["unsupported_runtime_warnings"]
    assert warnings == []
    # the drive layer is non-sensitive and must survive into persistable specs
    from dify_agent.protocol import extract_runtime_layer_specs

    specs = extract_runtime_layer_specs(result.request.composition)
    assert any(spec.name == "drive" and spec.type == "dify.drive" for spec in specs)


def test_workflow_runtime_expands_drive_mentions_in_agent_soul_prompt(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_DRIVE_MANIFEST_ENABLED", True
    )
    _mock_drive_catalog(monkeypatch)
    context = _context()
    context.snapshot.config_snapshot = _soul_with_drive_skill()

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    soul_prompt = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
    assert soul_prompt.config.prefix == "You are careful. Use Tender Analyzer and sample.pdf."
    assert "[§" not in soul_prompt.config.prefix


def test_workflow_runtime_missing_drive_mentions_fall_back_to_label_then_decoded_key(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_DRIVE_MANIFEST_ENABLED", True
    )
    context = _context()
    context.snapshot.config_snapshot = AgentSoulConfig(
        prompt={
            "system_prompt": (
                "Use [§skill:ghost%2FSKILL.md:Ghost Skill§], [§file:files%2Fghost.txt:Ghost File§], "
                "and [§file:files%2Fno-label.txt§]."
            )
        },
        files={"files": [{"id": "files/no-label.txt", "name": "no-label.txt", "drive_key": "files/no-label.txt"}]},
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
    )

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    soul_prompt = next(layer for layer in result.request.composition.layers if layer.name == "agent_soul_prompt")
    assert soul_prompt.config.prefix == "Use Ghost Skill, Ghost File, and no-label.txt."
    assert "[§" not in soul_prompt.config.prefix


def test_workflow_run_request_has_no_drive_layer_when_flag_disabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        "core.workflow.nodes.agent_v2.runtime_request_builder.dify_config.AGENT_DRIVE_MANIFEST_ENABLED", False
    )
    context = _context()
    context.snapshot.config_snapshot = _soul_with_drive_skill()

    result = WorkflowAgentRuntimeRequestBuilder(credentials_provider=FakeCredentialsProvider()).build(context)

    dumped = result.request.model_dump(mode="json")
    assert all(layer["name"] != "drive" for layer in dumped["composition"]["layers"])
    assert result.metadata["runtime_support"]["unsupported_runtime_warnings"] == []


def test_build_drive_layer_config_missing_mentions_warn_but_keep_skill_catalog(monkeypatch: pytest.MonkeyPatch):
    from core.workflow.nodes.agent_v2.runtime_request_builder import build_drive_layer_config

    _mock_drive_catalog(monkeypatch)
    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(plugin_id="langgenius/openai", model_provider="openai", model="gpt-test"),
        prompt={"system_prompt": "Use [§skill:ghost%2FSKILL.md:Ghost§]"},
    )
    config, warnings = build_drive_layer_config(soul, tenant_id="tenant-1", agent_id="agent-1")
    assert config is not None
    assert [w["code"] for w in warnings] == ["mention_target_missing"]


# ── ENG-635: ask_human layer gating + feature manifest ───────────────────────


def test_build_ask_human_layer_config_gated_on_human_contacts():
    from dify_agent.layers.ask_human import DifyAskHumanLayerConfig

    from core.workflow.nodes.agent_v2.runtime_request_builder import build_ask_human_layer_config

    # no human involvement configured -> tool stays off
    assert build_ask_human_layer_config(AgentSoulConfig()) is None

    soul = AgentSoulConfig.model_validate(
        {"human": {"contacts": [{"id": "c-1", "name": "David", "email": "d@acme.com", "channel": "email"}]}}
    )
    config = build_ask_human_layer_config(soul)
    assert isinstance(config, DifyAskHumanLayerConfig)
    assert config.enabled is True


def test_feature_manifest_marks_human_supported_when_configured():
    from core.workflow.nodes.agent_v2.runtime_feature_manifest import build_runtime_feature_manifest

    soul = AgentSoulConfig.model_validate(
        {"human": {"contacts": [{"id": "c-1", "name": "David", "email": "d@acme.com", "channel": "email"}]}}
    )
    manifest = build_runtime_feature_manifest(soul)
    assert "human" in manifest["supported"]
    assert "human" not in manifest["reserved"]
    assert manifest["reserved_status"]["human"] == "supported_by_ask_human_hitl"
    # configured human no longer produces a "not executed" warning
    assert all("human" not in w["section"] for w in manifest["unsupported_runtime_warnings"])


def test_feature_manifest_marks_knowledge_supported_without_warning_when_configured():
    from core.workflow.nodes.agent_v2.runtime_feature_manifest import build_runtime_feature_manifest

    soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [
                    {
                        "id": "product",
                        "name": "Product Docs",
                        "datasets": [{"id": "dataset-1", "name": "Product Docs"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ],
            }
        }
    )

    manifest = build_runtime_feature_manifest(soul)
    assert "knowledge" in manifest["supported"]
    assert "knowledge" not in manifest["reserved"]
    assert manifest["reserved_status"]["knowledge"] == "supported_by_knowledge_layer"
    assert all("knowledge" not in w["section"] for w in manifest["unsupported_runtime_warnings"])


def test_feature_manifest_treats_empty_knowledge_sets_as_not_configured():
    from core.workflow.nodes.agent_v2.runtime_feature_manifest import build_runtime_feature_manifest

    soul = AgentSoulConfig.model_validate(
        {
            "knowledge": {
                "sets": [],
            }
        }
    )

    manifest = build_runtime_feature_manifest(soul)
    assert manifest["reserved_status"]["knowledge"] == "not_configured"
